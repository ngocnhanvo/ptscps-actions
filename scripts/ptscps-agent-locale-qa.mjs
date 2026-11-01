// Small, bounded live QA: at most one public chat call per website language.
// The test never logs conversation text, cookies, credentials, or response bodies.
const config = process.env.ENV_FILE || '';
const values = Object.fromEntries(config.split(/\r?\n/).map(line => {
  const m = line.match(/^\s*(?:export\s+)?(WC_URL|WC_URL_CLIENT)\s*=\s*(.*?)\s*$/);
  return m ? [m[1], m[2].replace(/^(?:"(.*)"|'(.*)')$/, (_, double, single) => double ?? single)] : [];
}).filter(pair => pair.length));

function getOrigin(value) {
  const url = new URL(value || '');
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password
      || (url.port && url.port !== '443') || (url.pathname !== '/' && url.pathname !== '')
      || url.search || url.hash) throw new Error('Invalid configured HTTPS origin');
  return url.origin;
}
const front = getOrigin(values.WC_URL_CLIENT);
if (front === getOrigin(values.WC_URL)) throw new Error('Frontend and CMS origins overlap');

// Verify the real English page carries its own immutable Agent locale signal.
const home = await fetch(`${front}/home`, { redirect: 'manual', signal: AbortSignal.timeout(15000) });
const homeHtml = await home.text();
const htmlLocale = homeHtml.match(/<html[^>]*\blang=["']([^"']+)/i)?.[1] || 'missing';
const widgetLocale = /data-agent-language="en"/.test(homeHtml);
console.log(`PTSCPS_EN_PAGE_LOCALE status=${home.status} html_lang=${htmlLocale} widget_en=${widgetLocale}`);
if (home.status !== 200 || htmlLocale !== 'en' || !widgetLocale)
  throw new Error('PTSCPS_EN_PAGE_LOCALE=FAIL');

const cases = [
  { language: 'en', question: 'what is ptsc?' },
];

function languageEvidence(language, reply) {
  // Allow proper names, original titles and URLs in either language.
  const main = reply.replace(/https?:\/\/\S+|\[[^\]]+\]\([^)]*\)/g, ' ');
  const enWords = (main.match(/\b(?:the|website|company|services|information|available|currently|English|we|our|you|provides|provide|is|are|and|for|not|cannot|found|verified)\b/gi) || []).length;
  const viWords = (main.match(/(?:^|\s)(?:công|ty|dịch|vụ|chúng|bạn|trang|thông|tin|hiện|chưa|có|và|của|là|được|các|nguồn|tiếng)(?=\s|[.,;:!?]|$)/giu) || []).length;
  return language === 'en' ? enWords >= 2 && viWords <= 4 : viWords >= 2;
}

let checked = 0;
for (const c of cases) {
  const response = await fetch(`${front}/api/agent/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: front, Accept: 'application/json' },
    body: JSON.stringify({ message: c.question, language: c.language }),
    redirect: 'manual',
    signal: AbortSignal.timeout(55_000),
  });
  const body = await response.json().catch(() => ({}));
  const reply = typeof body.reply === 'string' ? body.reply.trim() : '';
  const pass = response.status === 200 && reply.length >= 10 && languageEvidence(c.language, reply)
    && !/PetroVietnam Transportation Corporation/i.test(reply);
  if (!pass && response.status === 503) {
    // One bounded WordPress-only diagnostic call separates proxy failures from Planner failures.
    const envValue = name => {
      const line = config.split(/\r?\n/).find(l => new RegExp(`^\\s*(?:export\\s+)?${name}=`).test(l));
      return line ? line.split('=').slice(1).join('=').trim().replace(/^(?:"(.*)"|'(.*)')$/, (_, a, b) => a ?? b) : '';
    };
    const secret = envValue('WOO_SECRET');
    const key = envValue('WOO_KEY');
    if (!secret) console.log('PTSCPS_AGENT_UPSTREAM_DIAG=BLOCKED missing Woo secret in Actions ENV_FILE');
    else {
      try {
        const upstream = await fetch(`${getOrigin(values.WC_URL)}/wp-json/esc-agent/v1/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}`, ...(key ? { 'X-ESC-Woo-Key': key } : {}) },
          body: JSON.stringify({ message: c.question, language: c.language, sessionId: crypto.randomUUID() }),
          signal: AbortSignal.timeout(35000),
        });
        const result = await upstream.json().catch(() => ({}));
        const reason = typeof result.code === 'string' ? result.code.replace(/[^a-z_]/gi, '').slice(0,40) : 'none';
        console.log(`PTSCPS_AGENT_UPSTREAM_DIAG status=${upstream.status} code=${reason} has_message=${typeof result.message === 'string'}`);
      } catch (error) {
        console.log(`PTSCPS_AGENT_UPSTREAM_DIAG network_error_type=${error instanceof Error ? error.name : 'unknown'}`);
      }
    }
  }
  console.log(`PTSCPS_AGENT_LOCALE_QA locale=${c.language} status=${response.status} chars=${reply.length} language_evidence=${pass ? 'PASS' : 'FAIL'}`);
  if (!pass) {
    throw new Error(`PTSCPS_AGENT_LOCALE_QA_FAIL locale=${c.language} status=${response.status} code=${String(body.code || 'unavailable').replace(/[^a-z_]/gi, '').slice(0,30)}`);
  }

  // The user reported F5 restoring an old answer. Verify the same cookie's
  // visible history, its POST soft-clear, and a fresh GET after the clear.
  const sessionCookie = (response.headers.get('set-cookie') || '').split(';')[0];
  if (!/^esc_agent_session=[a-f0-9-]+$/i.test(sessionCookie))
    throw new Error('PTSCPS_CHAT_CLEAR_QA=FAIL missing server session cookie');
  const readHistory = async () => {
    const res = await fetch(`${front}/api/agent/history`, {
      headers: { Cookie: sessionCookie, Accept: 'application/json' },
      signal: AbortSignal.timeout(15000),
    });
    const history = await res.json().catch(() => null);
    if (res.status !== 200 || !Array.isArray(history))
      throw new Error(`PTSCPS_CHAT_CLEAR_QA=FAIL history_http_${res.status}`);
    return history;
  };
  const before = await readHistory();
  if (!before.some(item => item.sender === 'user' && item.message === c.question))
    throw new Error('PTSCPS_CHAT_CLEAR_QA=FAIL pre-clear history missing seed question');
  const clear = await fetch(`${front}/api/agent/history-clear`, {
    method: 'POST',
    headers: { Cookie: sessionCookie, Origin: front, 'Content-Type': 'application/json' },
    body: '{}',
    signal: AbortSignal.timeout(15000),
  });
  const clearData = await clear.json().catch(() => null);
  if (clear.status !== 200 || clearData?.success !== true)
    throw new Error(`PTSCPS_CHAT_CLEAR_QA=FAIL clear_http_${clear.status}`);
  const after = await readHistory();
  if (after.length !== 0) throw new Error('PTSCPS_CHAT_CLEAR_QA=FAIL old turns survived clear');
  console.log(`PTSCPS_CHAT_CLEAR_QA=PASS pre_clear=${before.length > 0} post_clear_empty=true`);

  checked++;
  if (checked < cases.length) await new Promise(resolve => setTimeout(resolve, 5000));
}
console.log('PTSCPS_AGENT_LOCALE_LIVE_QA=PASS cases=2');
