import { chromium } from 'playwright';

const raw = process.env.ENV_FILE || '';
const values = Object.fromEntries([...raw.matchAll(/^\s*(?:export\s+)?(WC_URL|WC_URL_CLIENT)\s*=\s*(.*)$/gm)]
  .map((m) => [m[1], m[2].trim().replace(/^['"]|['"]$/g, '')]));
const parseSite = (value) => {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
      url.pathname !== '/' || (url.port && url.port !== '443')) throw new Error('Invalid site URL');
  return url.origin;
};
const origin = parseSite(values.WC_URL_CLIENT);
if (origin === parseSite(values.WC_URL)) throw new Error('Frontend and CMS origins must differ');

const browser = await chromium.launch({ headless: true });
const scenarios = [
  { path: '/tim-kiem?q=PPS', lang: 'vi', action: '/tim-kiem', heading: 'Kết quả tìm kiếm', width: 1440 },
  { path: '/search?q=PPS', lang: 'en', action: '/search', heading: 'Search results', width: 1440 },
  { path: '/tim-kiem?lang=en&q=PPS', lang: 'vi', action: '/tim-kiem', heading: 'Kết quả tìm kiếm', width: 390 },
  { path: '/search?lang=vi&q=PPS', lang: 'en', action: '/search', heading: 'Search results', width: 390 },
];

try {
  for (const test of scenarios) {
    const page = await browser.newPage({ viewport: { width: test.width, height: 900 } });
    try {
      const response = await page.goto(origin + test.path, { waitUntil: 'domcontentloaded', timeout: 45000 });
      const status = response?.status();
      if (status !== 200) throw new Error(`${test.path}: expected HTTP 200, got ${status}`);
      const main = page.locator('main[data-news-search]');
      await main.waitFor({ state: 'attached', timeout: 15000 });
      const actualLang = await main.getAttribute('data-search-lang');
      if (actualLang !== test.lang) throw new Error(`${test.path}: expected ${test.lang}, got ${actualLang}`);
      const heading = (await main.locator('h1').textContent())?.trim();
      if (heading !== test.heading) throw new Error(`${test.path}: wrong heading ${heading}`);
      const formAction = await main.locator('form[role="search"]').getAttribute('action');
      if (formAction !== test.action) throw new Error(`${test.path}: form action ${formAction}`);
      if (await main.locator('input[name="lang"]').count()) throw new Error(`${test.path}: route still depends on hidden lang input`);
      const headers = await page.locator('[data-header-tools] form[role="search"]').evaluateAll(forms => forms.map(f => f.getAttribute('action')));
      if (headers.length === 0 || headers.some(action => action !== test.action)) throw new Error(`${test.path}: Header search action mismatch ${headers}`);
      const languages = await main.locator('[data-post-lang]').evaluateAll(nodes => nodes.map(n => n.getAttribute('data-post-lang')));
      if (languages.some(lang => lang !== test.lang)) throw new Error(`${test.path}: mixed-language results ${languages}`);
      const pagination = await main.locator('nav a[href*="page="]').evaluateAll(nodes => nodes.map(n => n.getAttribute('href')));
      if (pagination.some(href => !href.startsWith(test.action + '?q=PPS&') || href.includes('lang='))) throw new Error(`${test.path}: pagination is not route-based`);
      const swapUrl = test.lang === 'vi' ? '/search?q=PPS' : '/tim-kiem?q=PPS';
      const swapLinks = await page.locator('[data-header-tools] [data-header-language] a[href]').evaluateAll(nodes => nodes.map(n => n.getAttribute('href')));
      if (!swapLinks.includes(swapUrl)) throw new Error(`${test.path}: missing locale switch link ${swapUrl}, actual=${swapLinks}`);
      console.log('SEARCH_QA_PASS='+JSON.stringify({path:test.path,status,lang:actualLang,formAction,resultCards:languages.length,width:test.width}));
    } finally { await page.close(); }
  }
  console.log('PTSCPS_NEWS_SEARCH_QA=PASS');
} finally { await browser.close(); }
