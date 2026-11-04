import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';

const front = process.env.FRONT_ORIGIN;
assert.ok(front, 'FRONT_ORIGIN missing');
const dir = 'artifacts/ptscps-intro-pages';
await fs.mkdir(dir, { recursive: true });

const browser = await chromium.launch({ headless: true });
try {
  for (const viewport of [{ name: 'desktop', width: 1440, height: 1000 }, { name: 'mobile', width: 390, height: 844 }]) {
    const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
    const page = await context.newPage();
    const response = await page.goto(`${front}/qua-trinh-phat-trien?_history_qa=${Date.now()}`, { waitUntil: 'load', timeout: 50000 });
    assert.equal(response?.status(), 200, `${viewport.name} qua-trinh-phat-trien HTTP ${response?.status()}`);

    const years = page.locator('[data-about-history-year]');
    assert.equal(await years.count(), 16, `${viewport.name} history year count mismatch`);
    const triggers = page.locator('[data-about-history-image][data-gallery-trigger="about03-history"]');
    assert.equal(await triggers.count(), 16, `${viewport.name} history image trigger count mismatch`);
    const images = triggers.locator('img');
    for (let index = 0; index < 16; index++) {
      await triggers.nth(index).scrollIntoViewIfNeeded();
      await page.waitForFunction((imageIndex) => {
        const image = document.querySelectorAll('[data-about-history-image][data-gallery-trigger="about03-history"] img')[imageIndex];
        return image && image.complete && image.naturalWidth >= 200 && image.naturalHeight >= 120;
      }, index, { timeout: 8000 });
    }
    const imageState = await images.evaluateAll((nodes) => nodes.map((img) => ({
      src: img.getAttribute('src') || '',
      width: img.naturalWidth,
      height: img.naturalHeight,
      alt: img.getAttribute('alt') || '',
    })));
    assert.equal(imageState.length, 16, `${viewport.name} history image count mismatch`);
    assert.ok(imageState.every((item) => item.src.startsWith('/images/pages/') && item.width >= 200 && item.height >= 120 && item.alt), `${viewport.name} history images are not localized/loaded`);
    assert.equal(new Set(imageState.map((item) => item.src)).size, 13, `${viewport.name} history unique image count mismatch`);

    await triggers.first().click();
    const lightbox = page.locator('[data-gallery-lightbox="about03-history"]');
    await lightbox.waitFor({ state: 'visible', timeout: 8000 });
    assert.equal(await lightbox.locator('[data-gallery-current]').innerText(), '1', `${viewport.name} history lightbox initial index mismatch`);
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(220);
    assert.equal(await lightbox.locator('[data-gallery-current]').innerText(), '2', `${viewport.name} history lightbox next navigation failed`);
    await page.keyboard.press('Escape');
    await lightbox.waitFor({ state: 'hidden', timeout: 3000 });

    const overflow = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }));
    assert.ok(overflow.scrollWidth <= overflow.width + 2, `${viewport.name} history horizontal overflow ${JSON.stringify(overflow)}`);
    await page.screenshot({ path: `${dir}/${viewport.name}-qua-trinh-phat-trien-history.png`, fullPage: true });
    console.log(`INTRO_HISTORY_PRODUCTION_QA=${viewport.name} PASS years=16 images=16 unique_images=13 lightbox=PASS`);
    await context.close();
  }
  console.log('INTRO_HISTORY_PRODUCTION_QA=PASS desktop=PASS mobile=PASS cms_images=16 unique_images=13 lightbox=keyboard');
} finally {
  await browser.close();
}
