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
    const response = await page.goto(`${front}/thu-ngo?_award_qa=${Date.now()}`, { waitUntil: 'load', timeout: 50000 });
    assert.equal(response?.status(), 200, `${viewport.name} thu-ngo HTTP ${response?.status()}`);

    const triggers = page.locator('[data-about-award-image][data-gallery-trigger="about00-awards"]');
    assert.equal(await triggers.count(), 2, `${viewport.name} award trigger count mismatch`);
    const images = triggers.locator('img');
    assert.equal(await images.count(), 2, `${viewport.name} award image count mismatch`);
    for (let index = 0; index < 2; index++) {
      await triggers.nth(index).scrollIntoViewIfNeeded();
      await page.waitForFunction((imageIndex) => {
        const image = document.querySelectorAll('[data-about-award-image][data-gallery-trigger="about00-awards"] img')[imageIndex];
        return image && image.complete && image.naturalWidth > 200 && image.naturalHeight > 120;
      }, index, { timeout: 8000 });
    }
    const imageState = await images.evaluateAll((nodes) => nodes.map((img) => ({
      src: img.getAttribute('src') || '',
      width: img.naturalWidth,
      height: img.naturalHeight,
      alt: img.getAttribute('alt') || '',
    })));
    assert.ok(imageState.every((item) => item.src && !item.src.startsWith('data:') && item.width > 200 && item.height > 120 && item.alt), `${viewport.name} award images are not fully loaded`);

    await triggers.first().click();
    const lightbox = page.locator('[data-gallery-lightbox="about00-awards"]');
    await lightbox.waitFor({ state: 'visible', timeout: 8000 });
    const mainImage = lightbox.locator('[data-gallery-main-image]');
    await page.waitForFunction(() => {
      const image = document.querySelector('[data-gallery-lightbox="about00-awards"] [data-gallery-main-image]');
      return image && image.getAttribute('src') && !image.getAttribute('src').startsWith('data:') && image.naturalWidth > 200;
    }, null, { timeout: 8000 });
    assert.ok(await mainImage.getAttribute('alt'), `${viewport.name} lightbox image missing alt`);

    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(220);
    assert.equal(await lightbox.locator('[data-gallery-current]').innerText(), '2', `${viewport.name} lightbox next navigation failed`);
    await page.keyboard.press('Escape');
    await lightbox.waitFor({ state: 'hidden', timeout: 3000 });

    const overflow = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }));
    assert.ok(overflow.scrollWidth <= overflow.width + 2, `${viewport.name} horizontal overflow ${JSON.stringify(overflow)}`);
    await page.screenshot({ path: `${dir}/${viewport.name}-thu-ngo-awards.png`, fullPage: true });
    console.log(`INTRO_AWARD_PRODUCTION_QA=${viewport.name} PASS images=2 lightbox=PASS`);
    await context.close();
  }
  console.log('INTRO_AWARD_PRODUCTION_QA=PASS desktop=PASS mobile=PASS cms_images=2 lightbox=keyboard');
} finally {
  await browser.close();
}
