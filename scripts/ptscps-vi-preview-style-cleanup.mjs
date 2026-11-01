import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';

// This is intentionally limited to the published Vietnamese home Page.
// Do not alter the English page, the ESC Tables, or any user-authored styles.
const IDS = ['home_00','home_01','home_02','home_03','home_04','home_05','home_14','home_15'];
const PAGE_ID = 82467;
const sha = value => createHash('sha256').update(value).digest('hex');
const normalizeStyle = text => Object.fromEntries(text.split(';').map(s => s.trim()).filter(Boolean).map(s => {
  const i = s.indexOf(':');
  assert(i > 0, 'Malformed inline CSS; refusing cleanup');
  return [s.slice(0,i).trim().toLowerCase(), s.slice(i+1).trim().toLowerCase()];
}));
const styles = {
  div: {position:'relative',display:'block',width:'100%','max-width':'100%','margin-top':'10px',overflow:'hidden',background:'#f6f7f7','aspect-ratio':'300/200'},
  img: {display:'block',width:'100%','max-width':'100%',height:'100%','object-fit':'contain'}
};
function cleanContent(html) {
  let removed = 0;
  const counts = Object.fromEntries(IDS.map(id => [id, {div:0,img:0}]));
  const result = html.replace(/<(div|img)\b[^>]*>/gi, (tag, originalKind) => {
    const kind=originalKind.toLowerCase();
    const id=tag.match(/\bdata-table-id\s*=\s*(["'])([^"']+)\1/i)?.[2];
    if (!id || !IDS.includes(id)) return tag;
    const cls=tag.match(/\bclass\s*=\s*(["'])(.*?)\1/i)?.[2] || '';
    if (!cls.split(/\s+/).includes(kind==='div'?'tablepress-preview-wrap':'tablepress-attached-image')) return tag;
    counts[id][kind]++;
    const style=tag.match(/\sstyle\s*=\s*(["'])(.*?)\1/i);
    if (!style) return tag;
    assert.deepEqual(normalizeStyle(style[2]), styles[kind], `${id}: unexpected ${kind} style; refusing to remove custom formatting`);
    removed++;
    return tag.replace(style[0], '');
  });
  for (const id of IDS) {
    assert.deepEqual(counts[id], {div:1,img:1}, `Expected exactly one preview div and img for ${id}`);
    assert(result.includes(`[table id=${id} /]`), `Missing original native shortcode badge ${id}`);
    assert(result.includes(`/wp-json/api/image/tablepress?id=${id}`), `Missing original image ${id}`);
  }
  return {result,removed};
}
if (process.argv.includes('--self-test')) {
  const sample=IDS.map(id=>`<div class="tablepress-preview-wrap mceNonEditable" style="position: relative; display: block; width: 100%; max-width: 100%; margin-top: 10px; overflow: hidden; background: #f6f7f7; aspect-ratio: 300/200;" data-table-id="${id}"><img class="tablepress-attached-image mceNonEditable" style="display: block; width: 100%; max-width: 100%; height: 100%; object-fit: contain;" src="/wp-json/api/image/tablepress?id=${id}" data-table-id="${id}"/><span class="tablepress-preview-badge">[table id=${id} /]</span></div>`).join('');
  const {result,removed}=cleanContent(sample);
  assert.equal(removed,16);
  assert.equal(cleanContent(result).removed,0);
  assert(!result.includes('style='));
  assert.throws(()=>cleanContent(sample.replace('aspect-ratio: 300/200','aspect-ratio: 3/2')), /unexpected div style/);
  console.log('VI_PREVIEW_CLEANUP_SELF_TEST=PASS');
  process.exit(0);
}

const origin=process.env.WP_ORIGIN;
const user=process.env.WP_ADMIN_USERNAME;
const password=process.env.WP_ADMIN_PASSWORD;
assert(origin && user && password,'Missing WordPress admin configuration');
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1440,height:950}});
try {
  await page.goto(`${origin}/wp-login.php`,{waitUntil:'domcontentloaded',timeout:45000});
  await page.locator('#user_login').fill(user);
  await page.locator('#user_pass').fill(password);
  await Promise.all([page.waitForURL(/\/wp-admin\//,{timeout:45000}),page.locator('#wp-submit').click()]);
  const editUrl=`${origin}/wp-admin/post.php?post=${PAGE_ID}&action=edit`;
  const response=await page.goto(editUrl,{waitUntil:'domcontentloaded',timeout:45000});
  assert.equal(response?.status(),200,'Unable to read WordPress editor');
  const meta=await page.evaluate(()=>({
    id:document.querySelector('#post_ID')?.value,
    title:document.querySelector('#title')?.value,
    status:document.querySelector('#post_status')?.value,
    key:document.querySelector('[data-name="key"] input')?.value,
    action:document.querySelector('[data-name="action"] input')?.value,
    lang:document.querySelector('[data-name="product_lang"] select')?.value,
    origin:document.querySelector('[data-name="origin_page_id"] select')?.value || document.querySelector('[data-name="origin_page_id"] input')?.value
  }));
  assert.equal(meta.id,String(PAGE_ID));
  assert.equal(meta.title,'Trang chủ');
  assert.equal(meta.status,'publish');
  assert.equal(meta.key,'home');
  assert.equal(meta.action,'HomePage');
  assert.equal(meta.lang,'vi');
  assert(!meta.origin || meta.origin==='0','Original VI page must not be linked as a translation');
  await page.locator('#content-html').click();
  const before=await page.locator('#content').inputValue();
  assert(before.length>1000,'Vietnamese home content is unexpectedly short');
  const {result,removed}=cleanContent(before);
  mkdirSync('artifacts',{recursive:true});
  writeFileSync('artifacts/vi-home-82467-before.html',before,{mode:0o600});
  console.log(`VI_PREVIEW_BACKUP=PASS page=${PAGE_ID} before_sha256=${sha(before)} original_length=${before.length} styles_to_remove=${removed}`);
  if (removed===0) {
    console.log('VI_PREVIEW_CLEANUP=PASS already_clean=yes cms_writes=0');
  } else {
    assert.equal(removed,16,'Partial legacy formatting detected; inspect before rewriting');
    await page.locator('#content').fill(result);
    assert.equal(await page.locator('#content').inputValue(),result,'Textarea mismatch before save');
    await page.locator('#publish').click();
    await page.waitForTimeout(1000);
    // WordPress may already be navigating after Update: do not start
    // another navigation until the first one settles. Never click Update twice.
    let loaded=false;
    for (let attempt=0;attempt<3&&!loaded;attempt++) {
      try {
        const r=await page.goto(editUrl,{waitUntil:'domcontentloaded',timeout:45000});
        assert.equal(r?.status(),200,'Reloaded editor did not return HTTP 200');
        loaded=true;
      } catch (error) {
        if (attempt===2 || !String(error).includes('ERR_ABORTED')) throw error;
        await page.waitForTimeout(900);
      }
    }
    await page.locator('#content-html').click();
    const after=await page.locator('#content').inputValue();
    assert.equal(cleanContent(after).removed,0,'Inline styles remain after save');
    assert.equal(after.trim(),result.trim(),'WordPress changed content beyond the expected inline styles; inspect the backup');
    console.log(`VI_PREVIEW_CLEANUP=PASS page=${PAGE_ID} removed=${removed} blocks=${IDS.length} after_sha256=${sha(after)} preserved_exact_content=yes`);
  }
} finally {await browser.close();}
