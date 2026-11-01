import { chromium } from 'playwright';

// Only authorized WordPress Admin can refresh EN knowledge. No credentials,
// cookies, post bodies, or chat text are written to GitHub Actions logs.
const env = process.env.ENV_FILE || '';
const line = env.split(/\r?\n/).find(value => /^\s*WC_URL\s*=/.test(value));
const rawOrigin = line?.split('=').slice(1).join('=').trim().replace(/^(?:"(.*)"|'(.*)')$/, (_, a, b) => a ?? b) || '';
const url = new URL(rawOrigin);
if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash || url.port)
  throw new Error('Invalid WordPress origin');
if (!process.env.WP_ADMIN_USERNAME || !process.env.WP_ADMIN_PASSWORD)
  throw new Error('WordPress admin credentials unavailable');

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
try {
  await page.goto(`${url.origin}/wp-login.php`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await page.locator('#user_login').fill(process.env.WP_ADMIN_USERNAME);
  await page.locator('#user_pass').fill(process.env.WP_ADMIN_PASSWORD);
  await Promise.all([
    page.waitForURL(href => href.origin === url.origin && href.pathname.startsWith('/wp-admin/'), { timeout: 45_000 }),
    page.locator('#wp-submit').click(),
  ]);

  await page.goto(`${url.origin}/wp-admin/tools.php?page=esc-agent-knowledge-index`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  const form = page.locator('form:has(input[name="action"][value="esc_agent_refresh_english_knowledge"])');
  await form.waitFor({ state: 'visible', timeout: 15_000 });
  await Promise.all([
    page.waitForURL(href => href.origin === url.origin && href.pathname === '/wp-admin/tools.php' && href.searchParams.get('refreshed') === '1', { timeout: 120_000 }),
    form.locator('input[type="submit"]').click(),
  ]);
  const sources = Number(new URL(page.url()).searchParams.get('sources'));
  if (!Number.isSafeInteger(sources) || sources < 1) throw new Error('No verified EN sources were reindexed');
  console.log(`PTSCPS_AGENT_EN_INDEX_REFRESH=PASS sources=${sources}`);
} finally {
  await browser.close();
}

// Two separate anonymous public sessions check grounded English answers,
// not merely an HTTP 200 or a canned missing-data message.
const frontLine = env.split(/\r?\n/).find(value => /^\s*WC_URL_CLIENT\s*=/.test(value));
const frontRaw = frontLine?.split('=').slice(1).join('=').trim().replace(/^(?:"(.*)"|'(.*)')$/, (_, a, b) => a ?? b) || '';
const front = new URL(frontRaw);
if (front.protocol !== 'https:' || front.username || front.password || front.pathname !== '/' || front.port)
  throw new Error('Invalid frontend origin');
for (const [question, expected] of [
  ['what is ptsc?', /PTSC/i],
  ['what is pps?', /PPS|Production Services/i],
]) {
  const result = await fetch(`${front.origin}/api/agent/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: front.origin, Accept: 'application/json' },
    body: JSON.stringify({ message: question, language: 'en' }),
    signal: AbortSignal.timeout(55_000),
  });
  const json = await result.json().catch(() => ({}));
  const answer = typeof json.reply === 'string' ? json.reply.trim() : '';
  const missing = /does not currently have verified English-language content|cannot answer this question/i.test(answer);
  const English = /\b(?:the|company|is|are|provides|service|services|corporation|website|part|technical)\b/i.test(answer);
  const valid = result.status === 200 && answer.length >= 25 && !missing && English && expected.test(answer)
    && !/PetroVietnam Transportation Corporation/i.test(answer);
  console.log(`PTSCPS_AGENT_EN_FACT_QA question=${question === 'what is ptsc?' ? 'ptsc' : 'pps'} status=${result.status} verified_answer=${valid ? 'PASS' : 'FAIL'}`);
  if (!valid) throw new Error('English company knowledge answer was not verified');
  await new Promise(resolve => setTimeout(resolve, 5000));
}
