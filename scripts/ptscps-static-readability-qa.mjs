import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const front = String(process.env.FRONT_ORIGIN || '').replace(/\/$/, '');
assert(/^https:\/\/[^/]+$/.test(front), 'PTSCPS_STATIC_QA=BLOCKED invalid FRONT_ORIGIN');

const artifactDir = 'artifacts/ptscps-static-readability-qa';
await mkdir(artifactDir, { recursive: true });

const specs = [
  { slug: 'sitemap', title: 'Sitemap', requireList: true },
  { slug: 'dieu-khoan-dich-vu', title: 'Điều khoản dịch vụ', requireList: false },
  { slug: 'chinh-sach-bao-mat', title: 'Chính sách bảo mật', requireList: false },
];

const browser = await chromium.launch({ headless: true });

async function waitForReadable(page, spec, label) {
  let response = null;
  for (let attempt = 1; attempt <= 36; attempt++) {
    response = await page.goto(`${front}/${spec.slug}?_qa_static=${Date.now()}-${label}-${attempt}`, {
      waitUntil: 'load', timeout: 50000,
    }).catch(() => null);
    const marker = await page.locator('[data-ptscps-readable-page="1"]').count().catch(() => 0);
    if (response?.status() === 200 && marker === 1) {
      console.log(`PTSCPS_STATIC_QA_READY=${JSON.stringify({ route: `/${spec.slug}`, label, attempt })}`);
      return response;
    }
    if (attempt < 36) await page.waitForTimeout(5000);
  }
  throw new Error(`PTSCPS_STATIC_QA=FAIL readiness ${spec.slug} ${label} http=${response?.status?.() || 0}`);
}

async function inspect(page, spec, label) {
  await waitForReadable(page, spec, label);
  const title = (await page.locator('.ptscps-readable-page__title').innerText()).trim();
  assert.equal(title, spec.title, `PTSCPS_STATIC_QA=FAIL title ${spec.slug} ${label}`);
  const metrics = await page.evaluate(() => {
    const root = document.querySelector('[data-ptscps-readable-page="1"]');
    const body = root?.querySelector('.ptscps-readable-page__body');
    const h1 = root?.querySelector('.ptscps-readable-page__title');
    if (!root || !body || !h1) return null;
    const bodyRect = body.getBoundingClientRect();
    const bodyStyle = getComputedStyle(body);
    const h1Style = getComputedStyle(h1);
    const firstList = body.querySelector('ul,ol');
    const firstParagraph = body.querySelector('p');
    const firstLink = body.querySelector('a');
    const listStyle = firstList ? getComputedStyle(firstList).listStyleType : '';
    const paragraphStyle = firstParagraph ? getComputedStyle(firstParagraph) : null;
    const linkStyle = firstLink ? getComputedStyle(firstLink) : null;
    return {
      viewport: innerWidth,
      bodyLeft: bodyRect.left,
      bodyRight: bodyRect.right,
      bodyWidth: bodyRect.width,
      bodyFont: parseFloat(bodyStyle.fontSize),
      bodyLine: parseFloat(bodyStyle.lineHeight),
      h1Font: parseFloat(h1Style.fontSize),
      h1Weight: parseInt(h1Style.fontWeight, 10),
      textLength: (body.textContent || '').trim().length,
      listCount: body.querySelectorAll('ul,ol').length,
      listStyle,
      headingCount: body.querySelectorAll('h2,h3,h4').length,
      paragraphCount: body.querySelectorAll('p').length,
      paragraphMarginBottom: paragraphStyle ? parseFloat(paragraphStyle.marginBottom) : 0,
      linkCount: body.querySelectorAll('a').length,
      linkDecoration: linkStyle?.textDecorationLine || '',
      overflow: document.documentElement.scrollWidth - innerWidth,
    };
  });
  assert(metrics, `PTSCPS_STATIC_QA=FAIL missing readable DOM ${spec.slug} ${label}`);
  assert(metrics.textLength > 80, `PTSCPS_STATIC_QA=FAIL content too short ${spec.slug} ${label}`);
  assert(metrics.bodyLeft >= 12 && metrics.bodyRight <= metrics.viewport + 1,
    `PTSCPS_STATIC_QA=FAIL content touches viewport edge ${spec.slug} ${label}`);
  assert(metrics.bodyWidth > 250 && metrics.bodyWidth <= metrics.viewport - 24,
    `PTSCPS_STATIC_QA=FAIL body width ${spec.slug} ${label}`);
  assert(metrics.h1Font >= (label === 'mobile' ? 28 : 30) && metrics.h1Weight >= 600,
    `PTSCPS_STATIC_QA=FAIL H1 hierarchy ${spec.slug} ${label}`);
  assert(metrics.bodyFont >= 15 && metrics.bodyLine >= metrics.bodyFont * 1.45,
    `PTSCPS_STATIC_QA=FAIL body typography ${spec.slug} ${label}`);
  assert(metrics.overflow <= 2, `PTSCPS_STATIC_QA=FAIL horizontal overflow ${spec.slug} ${label}`);
  if (metrics.paragraphCount > 0) assert(metrics.paragraphMarginBottom >= 8,
    `PTSCPS_STATIC_QA=FAIL paragraph spacing ${spec.slug} ${label}`);
  if (metrics.listCount > 0) assert(metrics.listStyle && metrics.listStyle !== 'none',
    `PTSCPS_STATIC_QA=FAIL list markers reset ${spec.slug} ${label}`);
  if (spec.requireList) {
    assert(metrics.listCount > 0, `PTSCPS_STATIC_QA=FAIL sitemap has no semantic list ${label}`);
    assert(metrics.linkCount >= 5, `PTSCPS_STATIC_QA=FAIL sitemap links missing ${label}`);
  }
  await page.screenshot({ path: `${artifactDir}/${spec.slug}-${label}.png`, fullPage: true });
  console.log(`PTSCPS_STATIC_QA_PASS=${JSON.stringify({ route: `/${spec.slug}`, label, metrics })}`);
  return metrics;
}

try {
  const desktop = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  for (const spec of specs) await inspect(desktop, spec, 'desktop');
  await desktop.close();

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
  for (const spec of specs) await inspect(mobile, spec, 'mobile');
  await mobile.close();
  console.log('PTSCPS_STATIC_QA_RESULT=PASS');
} finally {
  await browser.close();
}
