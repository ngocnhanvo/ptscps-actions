import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '../.qa/node_modules/playwright/index.mjs';

const wp = 'https://admin-ptscps.thegioihosting.io.vn';
const client = 'https://ptscps.thegioihosting.io.vn';
const browser = await chromium.launch({ headless:true });
const page = await browser.newPage({viewport:{width:1440,height:960}});
const decode = async (html) => page.evaluate(value => {
  const node = document.createElement('div');
  node.innerHTML = value;
  return (node.textContent || '').replace(/\s+/g,' ').trim();
},html);
try {
  const evidence = {};
  for (const [id, lang] of [['home_05','vi'],['home_05_en','en']]) {
    const t=await page.request.get(`${wp}/wp-json/tablepress/v1/table/${id}`,{timeout:25000});
    assert(t.ok(),`ESC table ${id}: HTTP ${t.status()}`);
    const table=await t.json();
    assert.equal(String(table.id),id);
    const api=String(table?.meta?.api||'');
    assert(api.startsWith('/wp-json/wp/v2/posts?'),`${id}: not configured through custom API`);
    assert(api.includes(`lang=${lang}`),`${id}: wrong locale in API source`);
    const response=await page.request.get(`${wp}${api}`,{timeout:25000});
    assert(response.ok(),`${id} configured API HTTP ${response.status()}`);
    const posts=await response.json();
    assert(Array.isArray(posts)&&posts.length>0,`${id}: empty news API`);
    for(const item of posts){
      assert(item.id && item.slug && item.title?.rendered,`${id}: malformed WordPress post`);
      const locale=item?.acf?.product_lang?.value || item?.acf?.product_lang || item?.product_lang;
      if (locale) assert.equal(locale,lang,`${id}: mixed content locale`);
    }
    for(let i=1;i<posts.length;i++)assert(Date.parse(posts[i-1].date)>=Date.parse(posts[i].date),`${id}: news order not descending`);
    evidence[id]={api,posts:posts.map(p=>({id:p.id,title:p.title.rendered,slug:p.slug,date:p.date}))};
  }
  await page.goto(client+'/',{waitUntil:'domcontentloaded',timeout:60000});
  const region=page.locator('section[data-pps-section="news"][data-tablepress-preview="home_05"]');
  await region.locator('article h3').first().waitFor({timeout:30000});
  const titles=await region.locator('article h3').allTextContents();
  const actual=titles.map(s=>s.replace(/\s+/g,' ').trim());
  const expected=[];
  for(const post of evidence.home_05.posts) expected.push(await decode(post.title));
  assert.deepEqual(actual,expected,'Production news cards differ from configured WordPress API');
  const hrefs=await region.locator('article > a[href]').evaluateAll(els=>els.map(el=>el.getAttribute('href')));
  assert.equal(hrefs.length,expected.length,'News card link count mismatch');
  for(let i=0;i<hrefs.length;i++)assert.equal(hrefs[i],`/${evidence.home_05.posts[i].slug}`,'News article slug mismatch');
  assert(await region.locator('h2[data-esc-builder-cell-field="section_title"]').count(),'ESC Table heading source mapping missing');
  evidence.production={titles:actual,links:hrefs,source:'home_05',url:client+'/'};
  await mkdir('artifacts/home05',{recursive:true});
  await page.screenshot({path:'artifacts/home05/home05-desktop.png',fullPage:true});
  await writeFile('artifacts/home05/report.json',JSON.stringify(evidence,null,2)+'\n');
  console.log(`PTSCPS_HOME05_LIVE_QA_PASS=1 count_vi=${expected.length} count_en=${evidence.home_05_en.posts.length} api_source=ESC_TABLE`);
} finally {await browser.close();}
