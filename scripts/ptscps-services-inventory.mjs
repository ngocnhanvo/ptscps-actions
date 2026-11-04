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

const [{data: categories},{data: menus},{data: pages},products] = await Promise.all([
  getJson('/wp-json/astro/v1/get-product-categories'),
  getJson('/wp-json/esc-api/v1/menus?_service_inventory='+Date.now()),
  getJson('/wp-json/wp/v2/pages?status=publish&per_page=100&_fields=id,slug,title,acf'),
  pagedProducts(),
]);

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
console.log(`SERVICE_INVENTORY_SUMMARY=${JSON.stringify({categories:categories.length,products:productRows.length,pages:pageRows.length,menuItems:Array.isArray(viMenu?.items)?viMenu.items.length:0})}`);
