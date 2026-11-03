import assert from 'node:assert/strict';

const wp = process.env.WP_ORIGIN;
const front = process.env.FRONT_ORIGIN;
assert.ok(wp && front, 'Configured origins missing');

const wantedSlugs = new Set([
  'thu-ngo',
  'gioi-thieu-cong-ty',
  'ban-lanh-dao',
  'qua-trinh-phat-trien',
  'dinh-huong-phat-trien',
]);
const fetchJson = async (url) => {
  const response = await fetch(url, { headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' } });
  if (!response.ok) throw new Error(`HTTP ${response.status} ${new URL(url).pathname}`);
  return response.json();
};
const compactItem = (item) => ({
  id: item?.id,
  label: item?.label,
  key: item?.key,
  slug: item?.slug,
  href: item?.href,
  linkType: item?.linkType,
  parent: item?.parent,
  children: Array.isArray(item?.children) ? item.children.map(compactItem) : [],
});

const pages = await fetchJson(`${wp}/wp-json/wp/v2/pages?status=publish&per_page=100&_fields=id,slug,title,parent,acf,link`);
const targetPages = pages
  .filter((p) => wantedSlugs.has(String(p?.slug || '')))
  .map((p) => ({
    id: p.id,
    slug: p.slug,
    title: String(p?.title?.rendered || '').replace(/<[^>]*>/g, '').trim(),
    parent: p.parent,
    key: p?.acf?.key || '',
    action: p?.acf?.action || '',
    lang: p?.acf?.product_lang?.value || p?.acf?.product_lang || '',
    link: p.link,
  }));
console.log('INTRO_AUDIT_TARGET_PAGES=' + JSON.stringify(targetPages));

const tables = await fetchJson(`${wp}/wp-json/tablepress/v1/tables/prefix/all?per_page=100&page=1`);
const introTables = (Array.isArray(tables) ? tables : [])
  .filter((t) => /^(?:about|intro)_/i.test(String(t?.id || '')))
  .map((t) => ({ id: t.id, name: t.name, rows: Array.isArray(t.items) ? t.items.length : null }));
console.log('INTRO_AUDIT_TABLES=' + JSON.stringify(introTables));

const menuPayload = await fetchJson(`${wp}/wp-json/esc-api/v1/menus?_intro_audit=${Date.now()}`);
assert.equal(menuPayload?.success, true, 'ESC menu API contract invalid');
const header = menuPayload?.menus?.Header?.vi || null;
console.log('INTRO_AUDIT_HEADER_VI=' + JSON.stringify(header ? {
  id: header.id,
  code: header.code,
  lang: header.lang,
  type: header.type,
  items: (header.items || []).map(compactItem),
} : null));

for (const slug of wantedSlugs) {
  const response = await fetch(`${front}/${slug}`, { redirect: 'manual' });
  console.log('INTRO_AUDIT_FRONT_ROUTE=' + JSON.stringify({ slug, status: response.status, location: response.headers.get('location') || '' }));
}
console.log('INTRO_AUDIT=PASS_READ_ONLY');
