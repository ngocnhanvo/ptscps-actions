import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';

const front=process.env.FRONT_ORIGIN;
assert.ok(front,'FRONT_ORIGIN missing');
const brochureUrl='https://ptscps.com.vn/wp-content/uploads/2024/12/PPS-update.pdf';
const specs=[
  {slug:'thu-ngo',title:'Thư ngỏ',snippet:'sau gần 25 năm xây dựng và phát triển'},
  {slug:'gioi-thieu-cong-ty',title:'Giới thiệu công ty',snippet:'chính thức đi vào hoạt động từ 15/09/2002'},
  {slug:'ban-lanh-dao',title:'Ban lãnh đạo',snippet:'Ông Nguyễn Quốc Hoàng'},
  {slug:'qua-trinh-phat-trien',title:'Quá trình phát triển',snippet:'Chính thức tiếp nhận FSO MV12'},
  {slug:'dinh-huong-phat-trien',title:'Định hướng phát triển',snippet:'trở thành đối tác chiến lược và tin cậy'},
];
const dir='artifacts/ptscps-intro-pages-final';
await fs.mkdir(dir,{recursive:true});

const browser=await chromium.launch({headless:true});
const overflow=async(page)=>page.evaluate(()=>({
  width:document.documentElement.clientWidth,
  scrollWidth:document.documentElement.scrollWidth,
}));

try{
  const desktopContext=await browser.newContext({viewport:{width:1440,height:1000}});
  const desktop=await desktopContext.newPage();
  for(const spec of specs){
    const response=await desktop.goto(`${front}/${spec.slug}`,{waitUntil:'load',timeout:50000});
    assert.equal(response?.status(),200,`Desktop HTTP ${response?.status()} ${spec.slug}`);
    const h1=desktop.locator('main h1');
    await h1.waitFor({state:'visible',timeout:12000});
    assert.equal((await h1.innerText()).trim(),spec.title,`Desktop h1 mismatch ${spec.slug}`);
    const text=await desktop.locator('main').innerText();
    assert.ok(text.includes(spec.snippet),`Desktop content missing ${spec.slug}`);
    assert.equal(await desktop.locator('main aside').count(),0,`Old side menu leaked ${spec.slug}`);
    const size=await overflow(desktop);
    assert.ok(size.scrollWidth<=size.width+2,`Desktop horizontal overflow ${spec.slug}: ${JSON.stringify(size)}`);
    await desktop.screenshot({path:`${dir}/desktop-${spec.slug}.png`,fullPage:true});
    console.log(`INTRO_FINAL_DESKTOP=${spec.slug} PASS`);
  }

  await desktop.goto(`${front}/${specs[0].slug}`,{waitUntil:'load',timeout:50000});
  const intro=desktop.locator('#desktop-menu button').filter({hasText:/^Giới thiệu$/}).first();
  await intro.waitFor({state:'visible',timeout:12000});
  await intro.click();
  const panelId=await intro.getAttribute('aria-controls');
  assert.ok(panelId,'Desktop Giới thiệu missing aria-controls');
  const panel=desktop.locator('#'+panelId);
  await panel.waitFor({state:'visible',timeout:8000});
  for(const spec of specs){
    const link=panel.getByRole('link',{name:spec.title,exact:true});
    assert.equal(await link.count(),1,'Desktop submenu missing '+spec.title);
  }
  const brochure=panel.getByRole('link',{name:'Company Brochure',exact:true});
  assert.equal(await brochure.count(),1,'Desktop brochure missing');
  assert.equal(await brochure.getAttribute('href'),brochureUrl,'Desktop brochure href changed');
  assert.equal(await brochure.getAttribute('target'),'_blank','Desktop brochure target changed');
  console.log('INTRO_FINAL_DESKTOP_MENU=PASS');
  await desktopContext.close();

  const mobileContext=await browser.newContext({viewport:{width:390,height:844}});
  const mobile=await mobileContext.newPage();
  for(const spec of specs){
    const response=await mobile.goto(`${front}/${spec.slug}`,{waitUntil:'load',timeout:50000});
    assert.equal(response?.status(),200,`Mobile HTTP ${response?.status()} ${spec.slug}`);
    const h1=mobile.locator('main h1');
    await h1.waitFor({state:'visible',timeout:12000});
    assert.equal((await h1.innerText()).trim(),spec.title,`Mobile h1 mismatch ${spec.slug}`);
    assert.equal(await mobile.locator('main aside').count(),0,`Mobile old side menu leaked ${spec.slug}`);
    const size=await overflow(mobile);
    assert.ok(size.scrollWidth<=size.width+2,`Mobile horizontal overflow ${spec.slug}: ${JSON.stringify(size)}`);
    await mobile.screenshot({path:`${dir}/mobile-${spec.slug}.png`,fullPage:true});
    console.log(`INTRO_FINAL_MOBILE=${spec.slug} PASS`);
  }

  await mobile.goto(`${front}/${specs[0].slug}`,{waitUntil:'load',timeout:50000});
  const hamburger=mobile.locator('#hamburger-btn');
  await hamburger.waitFor({state:'visible',timeout:12000});
  await hamburger.click();
  assert.equal(await hamburger.getAttribute('aria-expanded'),'true','Mobile hamburger aria-expanded not true');
  const mobileMenu=mobile.locator('#mobile-menu-container');
  await mobileMenu.waitFor({state:'visible',timeout:8000});
  const mobileIntro=mobileMenu.locator('button').filter({hasText:/^Giới thiệu$/}).first();
  await mobileIntro.waitFor({state:'visible',timeout:8000});
  await mobileIntro.click();
  const mobilePanelId=await mobileIntro.getAttribute('aria-controls');
  assert.ok(mobilePanelId,'Mobile Giới thiệu missing aria-controls');
  const mobilePanel=mobile.locator('#'+mobilePanelId);
  await mobilePanel.waitFor({state:'visible',timeout:8000});
  for(const spec of specs){
    const link=mobilePanel.getByRole('link',{name:spec.title,exact:true});
    assert.equal(await link.count(),1,'Mobile submenu missing '+spec.title);
  }
  const mobileBrochure=mobilePanel.getByRole('link',{name:'Company Brochure',exact:true});
  assert.equal(await mobileBrochure.count(),1,'Mobile brochure missing');
  assert.equal(await mobileBrochure.getAttribute('href'),brochureUrl,'Mobile brochure href changed');
  assert.equal(await mobileBrochure.getAttribute('target'),'_blank','Mobile brochure target changed');
  await mobile.screenshot({path:`${dir}/mobile-menu-open.png`,fullPage:true});
  console.log('INTRO_FINAL_MOBILE_MENU=PASS');
  await mobileContext.close();

  console.log('INTRO_FINAL_PRODUCTION_QA=PASS desktop=5 mobile=5 menu=two-level side_menu=absent brochure=exact');
} finally {
  await browser.close();
}
