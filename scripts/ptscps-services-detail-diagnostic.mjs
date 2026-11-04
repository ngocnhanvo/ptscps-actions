import assert from 'node:assert/strict';

const front = String(process.env.FRONT_ORIGIN || '').replace(/\/$/, '');
const wp = String(process.env.WP_ORIGIN || '').replace(/\/$/, '');
assert(front && wp, 'FRONT_ORIGIN/WP_ORIGIN missing');

const slug = 'cung-ung-nhan-luc-ky-thuat-van-hanh-va-bao-duong';
const projects = [
  'FPSO LEWEK EMAS',
  'FPSO THAI BINH VN',
  'FSO ORKID',
  'Khu vực thượng nguồn – Nhà máy hóa dầu Long Sơn',
];

async function getText(url) {
  const res = await fetch(url, {
    headers: {
      'Cache-Control': 'no-cache, no-store, max-age=0',
      Pragma: 'no-cache',
    },
  });
  return { status: res.status, text: await res.text() };
}

const landing = await getText(`${front}/dich-vu?_services_diag=${Date.now()}`);
const detail = await getText(`${front}/dich-vu/${slug}?_services_diag=${Date.now()}`);
const categoriesRes = await fetch(`${wp}/wp-json/astro/v1/get-product-categories?_services_diag=${Date.now()}`, {
  headers: { 'Cache-Control': 'no-cache' },
});
const categories = categoriesRes.ok ? await categoriesRes.json() : [];
const category = Array.isArray(categories) ? categories.find((x) => x?.slug === slug) : null;
const designSlug = 'dich-vu-thiet-ke-mua-sam-gia-cong-che-tao';
const designCategory = Array.isArray(categories) ? categories.find((x) => x?.slug === designSlug) : null;

const productsRes = await fetch(`${wp}/wp-json/wp/v2/product?status=publish&per_page=100&_fields=id,slug,title,product_categories&_services_diag=${Date.now()}`, {
  headers: { 'Cache-Control': 'no-cache' },
});
const products = productsRes.ok ? await productsRes.json() : [];

const result = {
  landing: {
    status: landing.status,
    grid: landing.text.includes('data-services-category-grid'),
    source: landing.text.includes('data-services-source="ProductCategory"'),
  },
  detail: {
    status: detail.status,
    gridAbsent: !detail.text.includes('data-services-category-grid'),
    description: detail.text.includes('data-service-category-description'),
    projectsHeading: detail.text.includes('data-service-projects-heading'),
    projects: Object.fromEntries(projects.map((title) => [title, detail.text.includes(title)])),
  },
  wordpress: {
    categoriesStatus: categoriesRes.status,
    categoryFound: Boolean(category),
    categoryDescriptionLength: String(category?.description || '').length,
    productsStatus: productsRes.status,
    projectProducts: Object.fromEntries(projects.map((title) => [
      title,
      Array.isArray(products) && products.some((p) => String(p?.title?.rendered || p?.title || '').includes(title)),
    ])),
  },
};

console.log('SERVICES_DETAIL_DIAGNOSTIC=' + JSON.stringify(result));
console.log('SERVICES_DETAIL_DIAGNOSTIC_DESIGN_DESCRIPTION=' + JSON.stringify(String(designCategory?.description || '')));
assert.equal(landing.status, 200, 'Landing HTTP not 200');
assert.equal(detail.status, 200, 'Detail HTTP not 200');
assert(result.landing.grid && result.landing.source, 'Landing ProductCategory grid not ready');
assert(result.detail.gridAbsent, 'Detail still leaks services landing grid');
assert(result.detail.description, 'Detail intro marker missing');
assert(result.detail.projectsHeading, 'Detail featured-project heading missing');
for (const title of projects) assert(result.detail.projects[title], `Detail project missing: ${title}`);
console.log('SERVICES_DETAIL_DIAGNOSTIC_RESULT=PASS');
