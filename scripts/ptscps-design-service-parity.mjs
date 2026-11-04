import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const wp = String(process.env.WP_ORIGIN || '').replace(/\/$/, '');
const user = process.env.WP_ADMIN_USERNAME;
const pass = process.env.WP_ADMIN_PASSWORD;
assert(wp && user && pass, 'Missing WordPress origin/admin credentials');

const service = {
  slug: 'dich-vu-thiet-ke-mua-sam-gia-cong-che-tao',
  intro: `<p>Công ty cung cấp các dịch vụ EPCI (engineering, procurement, construction and installation) cho các cấu kiện như:</p><ul><li>Skid fabrication (including valve, pump, process skid…);</li><li>Piping and structural fabrication;</li><li>Pressure vessel, tank fabrication;</li><li>E&amp;I system (Metering, ICSS, cathodic protection).</li></ul>`,
  introImages: [
    ['epci-1', 'Thi công và lắp đặt cấu kiện EPCI', 'https://ptscps.com.vn/wp-content/uploads/2019/12/EPC1.jpg'],
    ['epci-2', 'Gia công thiết bị công nghiệp', 'https://ptscps.com.vn/wp-content/uploads/2019/10/muasamgiacong3.jpg'],
    ['epci-3', 'Skid và hệ thống thiết bị EPCI', 'https://ptscps.com.vn/wp-content/uploads/2019/12/EPC2.jpg'],
    ['epci-4', 'Cụm thiết bị và đường ống công nghiệp', 'https://ptscps.com.vn/wp-content/uploads/2019/10/muasamgiacong1.jpg'],
  ],
  projects: [
    {
      title: 'Dự án Trạm Thu gom và phân phối khí Thái Bình – Hàm Rồng',
      slug: 'tram-thu-gom-va-phan-phoi-khi-thai-binh-ham-rong',
      scope: 'Thiết kế, mua sắm, thi công chế tạo chạy thử cho 18 gói cụm, hệ thống thiết bị cho dự án trạm thu gom và phân phối khí Thái Bình – Hàm Rồng bao gồm hệ thống Corrosion Inhibitor Skid, Pig Launcher – Pig Receiver, Piping system of platform, Hot tap flange, Piping on GDC-LFS, Valve skid, Fire fighting system, Hydrate system, Separator, Heat Exchanger, Flare, Truck Loading System, Oil Water Treatment, ICSS, Metering System, Electrical System và Cathodic Protection.',
      images: [
        ['thai-binh-ham-rong-1', 'Các gói thiết bị dự án Thái Bình – Hàm Rồng', 'https://ptscps.com.vn/wp-content/uploads/2019/12/pro.png'],
      ],
    },
    {
      title: 'Dự án Metering Skid – Thu gom khí Đại Hùng',
      slug: 'metering-skid-thu-gom-khi-dai-hung',
      scope: 'Thiết kế, mua sắm, chế tạo và chạy thử 01 hệ thống Gas Custody Metering (Tag. No 36A001).',
      images: [
        ['dai-hung-1', 'Metering Skid dự án thu gom khí Đại Hùng', 'https://ptscps.com.vn/wp-content/uploads/2019/12/DAI-HUNG-1.jpg'],
        ['dai-hung-2', 'Thiết bị Metering Skid dự án Đại Hùng', 'https://ptscps.com.vn/wp-content/uploads/2019/12/DAI-HUNG-2.jpg'],
      ],
    },
    {
      title: 'Dự án Chemical Injection Skid – Giàn Đông Đô',
      slug: 'chemical-injection-skid-gian-dong-do',
      scope: 'Thiết kế, mua sắm, chế tạo, lắp đặt chạy thử 01 hệ thống bơm H2 Scavenger Injection Pump trên giàn Đông Đô.',
      images: [
        ['dong-do-1', 'Chemical Injection Skid cho giàn Đông Đô', 'https://ptscps.com.vn/wp-content/uploads/2019/12/SKID-1.jpg'],
        ['dong-do-2', 'Kiểm tra hệ thống Chemical Injection Skid Đông Đô', 'https://ptscps.com.vn/wp-content/uploads/2019/12/SKID-2.jpg'],
      ],
    },
    {
      title: 'Dự án Condensate Tank TK-8040 for NPK Project',
      slug: 'condensate-tank-tk-8040-npk-project',
      scope: 'Thiết kế, mua sắm, chế tạo 01 condensate tank (TK-8040).',
      images: [
        ['npk-1', 'Gia công Condensate Tank TK-8040', 'https://ptscps.com.vn/wp-content/uploads/2019/12/FA1.jpg'],
        ['npk-2', 'Condensate Tank TK-8040 trong quá trình chế tạo', 'https://ptscps.com.vn/wp-content/uploads/2019/12/hinh-6.png'],
        ['npk-3', 'Condensate Tank TK-8040 hoàn thiện kết cấu', 'https://ptscps.com.vn/wp-content/uploads/2019/12/Hinh-7.jpg'],
      ],
    },
    {
      title: 'Dự án cung cấp năng lượng sạch và chiếu sáng cho Quần đảo Trường Sa',
      slug: 'nang-luong-sach-chieu-sang-quan-dao-truong-sa',
      scope: 'Mua sắm, chế tạo, lắp đặt các kết cấu thép cho dự án cấp năng lượng và chiếu sáng cho Quần đảo Trường Sa.',
      images: [
        ['truong-sa-1', 'Kết cấu cấp năng lượng và chiếu sáng tại Trường Sa', 'https://ptscps.com.vn/wp-content/uploads/2019/12/Hinh-8.jpg'],
        ['truong-sa-2', 'Hệ thống kết cấu thép tại Trường Sa', 'https://ptscps.com.vn/wp-content/uploads/2019/12/Hinh-9.jpg'],
        ['truong-sa-3', 'Hệ thống chiếu sáng năng lượng sạch tại Trường Sa', 'https://ptscps.com.vn/wp-content/uploads/2019/12/Hinh-10.jpg'],
      ],
    },
  ],
};

const clean = (value) => String(value ?? '').replace(/<[^>]+>/g, ' ').replace(/&amp;|&#0?38;|&#x26;/gi, '&').replace(/&nbsp;|&#160;|&#xa0;/gi, ' ').replace(/\s+/g, ' ').trim();
const report = (key, value) => console.log(`DESIGN_PARITY_${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();

async function login() {
  await page.goto(`${wp}/wp-login.php`, { waitUntil: 'domcontentloaded', timeout: 50000 });
  await page.locator('#user_login').fill(user);
  await page.locator('#user_pass').fill(pass);
  await Promise.all([page.waitForLoadState('domcontentloaded'), page.locator('#wp-submit').click()]);
  if (new URL(page.url()).searchParams.get('action') === 'confirm_admin_email') {
    const skip = page.locator('a.skip-confirmation-button').first();
    const confirm = page.locator('#correct-admin-email').first();
    if (await skip.count()) await Promise.all([page.waitForURL(/\/wp-admin\//, { timeout: 50000 }), skip.click()]);
    else if (await confirm.count()) await Promise.all([page.waitForURL(/\/wp-admin\//, { timeout: 50000 }), confirm.click()]);
    else throw Error('WordPress admin email confirmation controls unavailable');
  } else if (!/\/wp-admin\//.test(page.url())) {
    await page.waitForURL(/\/wp-admin\//, { timeout: 50000 });
  }
  assert(new URL(page.url()).origin === wp && /\/wp-admin\//.test(page.url()), 'WordPress admin login did not reach configured admin');
  report('ADMIN_AUTH', 'PASS');
}

async function restNonce() {
  for (const path of ['/wp-admin/nav-menus.php?esc_full_admin=1', '/wp-admin/edit-tags.php?taxonomy=product_cat&post_type=product&esc_full_admin=1']) {
    await page.goto(`${wp}${path}`, { waitUntil: 'domcontentloaded', timeout: 50000 });
    const nonce = await page.evaluate(() => String(globalThis.wpApiSettings?.nonce || '').trim());
    if (/^[A-Za-z0-9_-]{8,32}$/.test(nonce)) return nonce;
  }
  const res = await page.request.post(`${wp}/wp-admin/admin-ajax.php`, { form: { action: 'rest-nonce' }, timeout: 30000 });
  if (res.ok()) {
    const nonce = (await res.text()).trim();
    if (/^[A-Za-z0-9_-]{8,32}$/.test(nonce)) return nonce;
  }
  throw Error('WordPress REST nonce unavailable');
}

async function jsonRequest(method, path, nonce, data) {
  const opts = { method, headers: { 'X-WP-Nonce': nonce, 'Cache-Control': 'no-cache' }, timeout: 45000 };
  if (data !== undefined) opts.data = data;
  const res = await page.request.fetch(`${wp}${path}`, opts);
  const body = await res.json().catch(() => ({}));
  return { res, body };
}

async function findCategory(nonce, slug) {
  const { res, body } = await jsonRequest('GET', `/wp-json/wp/v2/product_cat?context=edit&hide_empty=false&slug=${encodeURIComponent(slug)}&per_page=20`, nonce);
  assert(res.ok(), `Category lookup HTTP ${res.status()} ${slug}`);
  assert(Array.isArray(body) && body.length === 1, `Category lookup mismatch ${slug}`);
  return body[0];
}

function extensionFrom(url, contentType = '') {
  const pathname = new URL(url).pathname;
  const raw = pathname.split('.').pop()?.toLowerCase() || '';
  if (/^(png|jpe?g|webp|gif)$/.test(raw)) return raw === 'jpeg' ? 'jpg' : raw;
  if (contentType.includes('png')) return 'png';
  if (contentType.includes('webp')) return 'webp';
  if (contentType.includes('gif')) return 'gif';
  return 'jpg';
}

async function findMedia(nonce, baseSlug) {
  const { res, body } = await jsonRequest('GET', `/wp-json/wp/v2/media?context=edit&slug=${encodeURIComponent(baseSlug)}&per_page=20&_fields=id,slug,source_url,alt_text,title`, nonce);
  assert(res.ok(), `Media lookup HTTP ${res.status()} ${baseSlug}`);
  assert(Array.isArray(body) && body.length <= 1, `Duplicate media ${baseSlug}`);
  return body[0] || null;
}

async function ensureMedia(nonce, key, title, sourceUrl) {
  const baseSlug = `ptscps-design-${key}`;
  let existing = await findMedia(nonce, baseSlug);
  if (existing) {
    report('MEDIA', { key, id: existing.id, state: 'ALREADY_PRESENT_SKIP_WRITE' });
    return existing;
  }
  const source = await fetch(sourceUrl, { headers: { 'User-Agent': 'PTSCPS migration' } });
  assert(source.ok, `Legacy image HTTP ${source.status} ${key}`);
  const bytes = Buffer.from(await source.arrayBuffer());
  assert(bytes.length > 2500, `Legacy image too small ${key}`);
  const contentType = source.headers.get('content-type')?.split(';')[0] || 'image/jpeg';
  const ext = extensionFrom(sourceUrl, contentType);
  const file = `${baseSlug}.${ext}`;
  let created = null;
  for (let attempt = 1; attempt <= 3 && !created; attempt++) {
    try {
      const upload = await page.request.post(`${wp}/wp-json/wp/v2/media`, {
        headers: { 'X-WP-Nonce': nonce, 'Content-Type': contentType, 'Content-Disposition': `attachment; filename="${file}"` },
        data: bytes,
        timeout: 60000,
      });
      const body = await upload.json().catch(() => ({}));
      if (upload.ok() && Number(body?.id) > 0) created = body;
      else report('MEDIA_UPLOAD_RETRY', { key, attempt, http: upload.status() });
    } catch (error) {
      report('MEDIA_UPLOAD_RETRY', { key, attempt, transport: error?.message || 'error' });
    }
    if (!created) {
      await sleep(900 * attempt);
      created = await findMedia(nonce, baseSlug).catch(() => null);
    }
  }
  assert(created && Number(created.id) > 0, `Media upload failed ${key}`);
  const meta = await jsonRequest('POST', `/wp-json/wp/v2/media/${created.id}`, nonce, { alt_text: title, title, caption: '' });
  assert(meta.res.ok(), `Media metadata failed ${key}`);
  existing = await findMedia(nonce, baseSlug);
  assert(existing && Number(existing.id) === Number(created.id), `Media readback failed ${key}`);
  report('MEDIA', { key, id: existing.id, state: 'CREATED_VERIFIED' });
  return existing;
}

function relativeMediaPath(media) {
  const source = String(media?.source_url || '');
  assert(source, `Media source URL missing id=${media?.id}`);
  const parsed = new URL(source, wp);
  return parsed.origin === new URL(wp).origin ? `${parsed.pathname}${parsed.search}` : parsed.href;
}

function designDescription() {
  // Product-category descriptions are sanitized by WordPress. Use the same
  // taxonomy-safe formatting already verified by the service migration.
  return `Công ty cung cấp các dịch vụ EPCI (engineering, procurement, construction and installation) cho các cấu kiện như:

• Skid fabrication (including valve, pump, process skid…);
• Piping and structural fabrication;
• Pressure vessel, tank fabrication;
• E&I system (Metering, ICSS, cathodic protection).`;
}

function normalizeDescription(value) {
  return clean(String(value ?? ''));
}

async function ensureDescription(nonce, category, html) {
  const current = String(category.description?.raw ?? category.description ?? '');
  if (normalizeDescription(current) === normalizeDescription(html)) {
    report('DESCRIPTION', { state: 'ALREADY_CORRECT_SKIP_WRITE' });
    return false;
  }
  const { res, body } = await jsonRequest('POST', `/wp-json/wp/v2/product_cat/${category.id}`, nonce, { description: html });
  assert(res.ok(), `Category description update HTTP ${res.status()}`);
  assert(normalizeDescription(body.description?.raw ?? body.description ?? '') === normalizeDescription(html), 'Category description readback mismatch');
  report('DESCRIPTION', { state: 'UPDATED_VERIFIED' });
  return true;
}

async function productBySlug(nonce, slug) {
  const { res, body } = await jsonRequest('GET', `/wp-json/wp/v2/product?context=edit&status=publish,draft,pending,private&slug=${encodeURIComponent(slug)}&per_page=20&_fields=id,slug,status,title,acf,content,excerpt,featured_media,product_categories`, nonce);
  assert(res.ok(), `Product lookup HTTP ${res.status()} ${slug}`);
  assert(Array.isArray(body) && body.length <= 1, `Duplicate product slug ${slug}`);
  return body[0] || null;
}

async function readGalleryIds(productId) {
  await page.goto(`${wp}/wp-admin/post.php?post=${productId}&action=edit&esc_full_admin=1`, { waitUntil: 'domcontentloaded', timeout: 50000 });
  const input = page.locator('#product_image_gallery, input[name="product_image_gallery"]').first();
  assert(await input.count() === 1, `WooCommerce product gallery input missing product ${productId}`);
  const raw = await input.inputValue();
  return raw.split(',').map((v) => Number(v.trim())).filter((v) => v > 0);
}

async function setProductAdminFields(productId, galleryIds) {
  await page.goto(`${wp}/wp-admin/post.php?post=${productId}&action=edit&esc_full_admin=1`, { waitUntil: 'domcontentloaded', timeout: 50000 });
  const row = page.locator('[data-name="product_lang"]').first();
  assert(await row.count() === 1, `product_lang ACF missing product ${productId}`);
  const select = row.locator('select').first();
  if (await select.count()) await select.selectOption('vi');
  else {
    const input = row.locator('input[type="text"],input:not([type])').first();
    assert(await input.count(), `product_lang input missing ${productId}`);
    await input.fill('vi');
  }
  const galleryInput = page.locator('#product_image_gallery, input[name="product_image_gallery"]').first();
  assert(await galleryInput.count() === 1, `WooCommerce product gallery input missing product ${productId}`);
  await galleryInput.evaluate((el, value) => {
    el.value = String(value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, galleryIds.join(','));
  const publish = page.locator('#publish');
  assert(await publish.count(), `Product update button missing ${productId}`);
  await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => null), publish.click()]);
  const savedGallery = page.locator('#product_image_gallery, input[name="product_image_gallery"]').first();
  assert(await savedGallery.count() === 1, `Saved gallery input missing product ${productId}`);
  const savedIds = (await savedGallery.inputValue()).split(',').map((v) => Number(v.trim())).filter((v) => v > 0);
  assert.deepEqual(savedIds, galleryIds, `Product gallery readback mismatch ${productId}`);
}

async function ensureProject(nonce, category, project) {
  const media = [];
  for (const [key, alt, sourceUrl] of project.images) media.push(await ensureMedia(nonce, key, alt, sourceUrl));
  const featuredId = Number(media[0].id);
  const galleryIds = media.slice(1).map((item) => Number(item.id));
  const content = `<p><strong>Phạm vi công việc:</strong> ${project.scope}</p>`;
  const excerpt = `<p>${project.scope}</p>`;
  let product = await productBySlug(nonce, project.slug);
  let currentGallery = [];
  if (product) currentGallery = await readGalleryIds(Number(product.id));
  const currentCats = Array.isArray(product?.product_categories) ? product.product_categories.map((x) => Number(x.id)) : [];
  const lang = product?.acf?.product_lang?.value ?? product?.acf?.product_lang;
  const correct = Boolean(product)
    && clean(product.title?.raw ?? product.title?.rendered) === project.title
    && clean(product.content?.raw ?? product.content?.rendered) === clean(content)
    && clean(product.excerpt?.raw ?? product.excerpt?.rendered) === clean(excerpt)
    && Number(product.featured_media) === featuredId
    && currentCats.includes(Number(category.id))
    && lang === 'vi'
    && JSON.stringify(currentGallery) === JSON.stringify(galleryIds);
  if (correct) {
    report('PRODUCT', { slug: project.slug, id: product.id, state: 'ALREADY_CORRECT_SKIP_WRITE', gallery: galleryIds.length });
    return false;
  }
  const payload = { title: project.title, slug: project.slug, status: 'publish', content, excerpt, featured_media: featuredId, product_cat: [Number(category.id)] };
  let state = 'UPDATED_VERIFIED';
  if (product) {
    const update = await jsonRequest('POST', `/wp-json/wp/v2/product/${product.id}`, nonce, payload);
    assert(update.res.ok(), `Product update HTTP ${update.res.status()} ${project.slug}`);
  } else {
    const create = await jsonRequest('POST', '/wp-json/wp/v2/product', nonce, payload);
    assert(create.res.ok() && create.body.id, `Product create HTTP ${create.res.status()} ${project.slug}`);
    product = create.body;
    state = 'CREATED_VERIFIED';
  }
  await setProductAdminFields(Number(product.id), galleryIds);
  const readback = await productBySlug(nonce, project.slug);
  assert(readback && readback.status === 'publish', `Product readback missing ${project.slug}`);
  const cats = (readback.product_categories || []).map((x) => Number(x.id));
  const readbackLang = readback.acf?.product_lang?.value ?? readback.acf?.product_lang;
  assert(cats.includes(Number(category.id)), `Product category mismatch ${project.slug}`);
  assert(readbackLang === 'vi', `Product lang mismatch ${project.slug}`);
  assert.deepEqual(await readGalleryIds(Number(readback.id)), galleryIds, `Product gallery final mismatch ${project.slug}`);
  report('PRODUCT', { slug: project.slug, id: readback.id, state, gallery: galleryIds.length });
  return true;
}

try {
  await login();
  const nonce = await restNonce();
  const category = await findCategory(nonce, service.slug);
  let changed = false;
  const introMedia = [];
  for (const [key, alt, sourceUrl] of service.introImages) introMedia.push(await ensureMedia(nonce, key, alt, sourceUrl));
  changed = (await ensureDescription(nonce, category, designDescription())) || changed;
  for (const project of service.projects) changed = (await ensureProject(nonce, category, project)) || changed;
  report('RESULT', { status: 'PASS', introImages: introMedia.length, projects: service.projects.length, projectImages: service.projects.reduce((sum, p) => sum + p.images.length, 0), changed });
} finally {
  await browser.close();
}
