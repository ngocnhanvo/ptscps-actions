import assert from 'node:assert/strict';

const wp = String(process.env.WP_ORIGIN || '').replace(/\/$/, '');
assert(wp, 'WP_ORIGIN missing');

async function getJson(path) {
  const response = await fetch(wp + path, { headers: { Accept:'application/json', 'Cache-Control':'no-cache' } });
  assert(response.ok, `${path} HTTP ${response.status}`);
  return { data: await response.json(), headers: response.headers };
}

async function pagedProducts() {
  const all=[];
  for(let page=1; page<=20; page++) {
    const {data,headers}=await getJson(`/wp-json/wp/v2/product?status=publish&per_page=50&page=${page}&_fields=id,slug,title,acf,product_categories,featured_media_url`);
    assert(Array.isArray(data), 'Product REST payload invalid');
    all.push(...data);
    const pages=Number(headers.get('x-wp-totalpages') || 1);
    if(page>=pages) break;
  }
  return all;
}

async function inspectLegacyServiceCards() {
  const legacy = 'https://ptscps.com.vn/dich-vu';
  const response = await fetch(legacy, { headers:{ 'User-Agent':'Mozilla/5.0 PTSCPS migration audit' } });
  assert(response.ok, `Legacy services HTTP ${response.status}`);
  const html = (await response.text()).replace(/%E2%80%8B/gi, '').replace(/\u200b/g, '');
  const slugs = [
    'van-hanh-va-bao-duong-fpso-fso-mopu',
    'dich-vu-thiet-ke-mua-sam-gia-cong-che-tao',
    'cung-ung-nhan-luc-ky-thuat-van-hanh-va-bao-duong',
    'dich-vu-sua-chua-bao-duong-cac-thiet-bi-va-cong-trinh-cong-nghiep',
  ];
  return slugs.map(slug => {
    const needle = `/dich-vu/${slug}`;
    const index = html.indexOf(needle);
    assert(index >= 0, `Legacy service link missing ${slug}`);
    const before = html.slice(Math.max(0, index - 1800), index);
    const after = html.slice(index, Math.min(html.length, index + 1200));
    const beforeImages = [...before.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)];
    const afterImages = [...after.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)];
    const image = beforeImages.at(-1)?.[1] || afterImages[0]?.[1] || '';
    assert(image, `Legacy service image missing ${slug}`);
    return { slug, href:new URL(needle, legacy).href, image:new URL(image, legacy).href };
  });
}

async function inspectLegacyRepairDetail() {
  const legacy = 'https://ptscps.com.vn/dich-vu/dich-vu-sua-chua-bao-duong-cac-thiet-bi-va-cong-trinh-cong-nghiep';
  const response = await fetch(legacy, { headers:{ 'User-Agent':'Mozilla/5.0 PTSCPS migration audit' } });
  assert(response.ok, `Legacy repair detail HTTP ${response.status}`);
  const html = await response.text();
  const images = [...html.matchAll(/<img\b[^>]*(?:src|data-src)=["']([^"']+)["'][^>]*>/gi)]
    .map((match) => new URL(match[1], legacy).href)
    .filter((url, index, rows) => rows.indexOf(url) === index);
  const contentStart = html.search(/5000m2|5000\s*m2|5000\s*SQM/i);
  const contentEnd = html.search(/Các dịch vụ sửa chữa bảo dưỡng được Công ty thực hiện bao gồm|We have been providing Maintenance and Repair services including/i);
  const content = contentStart >= 0
    ? html.slice(Math.max(0, contentStart - 2500), contentEnd > contentStart ? contentEnd + 2500 : contentStart + 12000)
    : html;
  const contentImages = [...content.matchAll(/<img\b[^>]*(?:src|data-src)=["']([^"']+)["'][^>]*>/gi)]
    .map((match) => new URL(match[1], legacy).href)
    .filter((url, index, rows) => rows.indexOf(url) === index);
  return { images, contentImages };
}

async function inspectProductCatRest() {
  const routeIndex = await fetch(wp + '/wp-json/', { headers:{Accept:'application/json'} });
  assert(routeIndex.ok, `REST index HTTP ${routeIndex.status}`);
  const routes = (await routeIndex.json())?.routes || {};
  const response = await fetch(wp + '/wp-json/wp/v2/product_cat?hide_empty=false&per_page=1', { headers:{Accept:'application/json'} });
  return { routeAvailable:Boolean(routes['/wp/v2/product_cat']), status:response.status };
}

const [{data: categories},{data: menus},{data: pages},products] = await Promise.all([
  getJson('/wp-json/astro/v1/get-product-categories'),
  getJson('/wp-json/esc-api/v1/menus?_service_inventory='+Date.now()),
  getJson('/wp-json/wp/v2/pages?status=publish&per_page=100&_fields=id,slug,title,acf'),
  pagedProducts(),
]);

const [legacyMedia, legacyRepair, productCatRest] = await Promise.all([inspectLegacyServiceCards(), inspectLegacyRepairDetail(), inspectProductCatRest()]);

assert(Array.isArray(categories), 'Product categories payload invalid');
assert(Array.isArray(pages), 'Pages payload invalid');

const pageRows=pages.map(p=>({
  id:p.id,
  slug:p.slug,
  title:String(p?.title?.rendered || ''),
  key:String(p?.acf?.key || ''),
  action:String(p?.acf?.action || ''),
  lang:String(p?.acf?.product_lang?.value || p?.acf?.product_lang || ''),
})).filter(p=>/dich-vu|service|product/i.test([p.slug,p.title,p.key,p.action].join(' ')));

const productRows=products.map(p=>({
  id:p.id,
  slug:p.slug,
  title:String(p?.title?.rendered || ''),
  lang:String(p?.acf?.product_lang?.value || p?.acf?.product_lang || ''),
  origin:Number(p?.acf?.origin_product_id || 0),
  categories:Array.isArray(p?.product_categories) ? p.product_categories.map(c=>({id:Number(c.id||0),slug:String(c.slug||''),name:String(c.name||'')})) : [],
  image:String(p?.featured_media_url || ''),
}));

const viMenu=menus?.menus?.Header?.vi || null;
console.log('SERVICE_INVENTORY_CATEGORIES='+JSON.stringify(categories));
console.log('SERVICE_INVENTORY_PRODUCTS='+JSON.stringify(productRows));
console.log('SERVICE_INVENTORY_PAGES='+JSON.stringify(pageRows));
console.log('SERVICE_INVENTORY_HEADER_VI='+JSON.stringify(viMenu));
console.log('SERVICE_INVENTORY_LEGACY_MEDIA='+JSON.stringify(legacyMedia));
console.log('SERVICE_INVENTORY_LEGACY_REPAIR='+JSON.stringify(legacyRepair));
console.log('SERVICE_INVENTORY_PRODUCT_CAT_REST='+JSON.stringify(productCatRest));
console.log(`SERVICE_INVENTORY_SUMMARY=${JSON.stringify({categories:categories.length,products:productRows.length,pages:pageRows.length,menuItems:Array.isArray(viMenu?.items)?viMenu.items.length:0})}`);
