import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';

const front = String(process.env.FRONT_ORIGIN || '').replace(/\/$/, '');
const wp = String(process.env.WP_ORIGIN || '').replace(/\/$/, '');
assert.match(front, /^https:\/\/[^/]+$/, 'FRONT_ORIGIN missing/invalid');
assert.match(wp, /^https:\/\/[^/]+$/, 'WP_ORIGIN missing/invalid');
assert.notEqual(new URL(front).hostname, new URL(wp).hostname, 'frontend and WordPress hosts must differ');

const pdfPath = '/wp-content/uploads/2026/11/PPS-update.pdf';
const publicPdf = front + pdfPath;
const wpHost = new URL(wp).hostname;
const frontHost = new URL(front).hostname;
const artifactDir = 'artifacts/ptscps-public-upload-proxy';
await fs.mkdir(artifactDir, { recursive: true });

function assertPdfHeaders(response, expectedStatus, label) {
  assert.equal(response.status, expectedStatus, `${label} HTTP ${response.status}`);
  assert.equal(response.headers.get('location'), null, `${label} unexpectedly redirects`);
  assert.match(response.headers.get('content-type') || '', /^application\/pdf(?:;|$)/i, `${label} MIME is not PDF`);
  assert.equal(new URL(response.url).hostname, frontHost, `${label} left frontend origin`);
  assert.ok(!response.url.includes(wpHost), `${label} leaks WordPress host`);
}

// Ordinary GET must return PDF bytes from the public origin, not Astro 404 HTML.
const full = await fetch(publicPdf, { redirect: 'manual', headers: { 'Cache-Control': 'no-cache' } });
assertPdfHeaders(full, 200, 'public PDF GET');
const fullReader = full.body?.getReader();
assert.ok(fullReader, 'public PDF GET has no body');
const first = await fullReader.read();
assert.ok(first.value && first.value.length >= 5, 'public PDF GET body too short');
assert.equal(Buffer.from(first.value.subarray(0, 5)).toString('ascii'), '%PDF-', 'public PDF GET missing PDF signature');
await fullReader.cancel();

// HEAD must remain same-origin and report the real upstream MIME.
const head = await fetch(publicPdf, { method: 'HEAD', redirect: 'manual', headers: { 'Cache-Control': 'no-cache' } });
assertPdfHeaders(head, 200, 'public PDF HEAD');

// Chrome's PDF viewer relies on byte-range requests for seeking/loading pages.
const range = await fetch(publicPdf, {
  redirect: 'manual',
  headers: { Range: 'bytes=0-1023', 'Cache-Control': 'no-cache' },
});
assertPdfHeaders(range, 206, 'public PDF range');
assert.match(range.headers.get('content-range') || '', /^bytes 0-\d+\/\d+$/i, 'missing/invalid Content-Range');
assert.match(range.headers.get('accept-ranges') || '', /bytes/i, 'missing Accept-Ranges: bytes');
const rangeBytes = Buffer.from(await range.arrayBuffer());
assert.ok(rangeBytes.length > 5 && rangeBytes.length <= 1024, `unexpected range length ${rangeBytes.length}`);
assert.equal(rangeBytes.subarray(0, 5).toString('ascii'), '%PDF-', 'range response missing PDF signature');

// Browser-level check: the public menu must not expose the admin hostname.
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const response = await page.goto(front + '/?_upload_proxy_qa=' + Date.now(), { waitUntil: 'load', timeout: 50000 });
  assert.equal(response?.status(), 200, `homepage HTTP ${response?.status()}`);

  const introTrigger = page.locator('[data-menu-trigger]').filter({ hasText: 'Giới thiệu' }).first();
  await introTrigger.waitFor({ state: 'visible', timeout: 10000 });
  await introTrigger.click();
  const brochure = page.getByRole('link', { name: 'Company Brochure', exact: true }).first();
  await brochure.waitFor({ state: 'visible', timeout: 10000 });
  const rawHref = String(await brochure.getAttribute('href') || '');
  const absoluteHref = await brochure.evaluate((node) => node.href);
  assert.ok(rawHref, 'Company Brochure href missing');
  assert.ok(!rawHref.includes(wpHost), 'Company Brochure raw href leaks WordPress host');
  assert.ok(!absoluteHref.includes(wpHost), 'Company Brochure absolute href leaks WordPress host');
  await page.screenshot({ path: `${artifactDir}/desktop-menu-company-brochure.png`, fullPage: true });
  console.log(`PTSCPS_PUBLIC_UPLOAD_MENU=PASS href=${rawHref} resolved_host=${new URL(absoluteHref).hostname}`);
} finally {
  await browser.close();
}

console.log(`PTSCPS_PUBLIC_UPLOAD_PROXY_QA=PASS pdf=${pdfPath} get=200 head=200 range=206 mime=application/pdf public_host=${frontHost} admin_hidden=YES`);
