import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {chromium} from 'playwright';

const front='https://ptscps.thegioihosting.io.vn';
const artifact='artifacts/ptscps-contact-map-smoke';
await mkdir(artifact,{recursive:true});
const browser=await chromium.launch({headless:true});
try{
  const context=await browser.newContext({viewport:{width:1440,height:960}});
  const page=await context.newPage();
  const failures=[];
  const consoleErrors=[];
  const mapsResponses=[];
  page.on('requestfailed',req=>{
    if(/google\.com|gstatic\.com|googleapis\.com/.test(req.url()))failures.push({url:req.url().slice(0,230),error:req.failure()});
  });
  page.on('console',msg=>{if(msg.type()==='error')consoleErrors.push(msg.text().slice(0,320));});
  page.on('response',res=>{
    if(/maps\.google\.com|google\.com\/maps/.test(res.url()))mapsResponses.push({url:res.url().slice(0,250),status:res.status()});
  });
  const response=await page.goto(`${front}/lien-he?_iframe_smoke=${Date.now()}`,{waitUntil:'domcontentloaded',timeout:45000});
  assert(response?.status()===200,`Contact HTTP ${response?.status()}`);
  const iframe=page.locator('[data-contact-map] iframe');
  await iframe.waitFor({state:'attached',timeout:15000});
  await iframe.scrollIntoViewIfNeeded();
  const source=await iframe.getAttribute('src');
  const credentialless=await iframe.getAttribute('credentialless')!==null;
  const loading=await iframe.getAttribute('loading');
  // Give Google Maps time to load instead of assuming DOMContentLoaded means iframe is ready.
  await page.waitForTimeout(9000);
  const handle=await iframe.elementHandle();
  const frame=await handle?.contentFrame();
  const frameUrl=frame?.url()||'';
  const body=frame?await frame.locator('body').innerText({timeout:4500}).catch(()=>null):null;
  const mapImages=frame?await frame.locator('img').count().catch(()=>-1):-1;
  await iframe.screenshot({path:`${artifact}/iframe-after-9s.png`,timeout:20000}).catch(e=>console.log('IFRAME_SCREENSHOT_ERROR='+String(e.message)));
  await page.screenshot({path:`${artifact}/contact-after-9s.png`,fullPage:true,timeout:20000});
  console.log('PTSCPS_CONTACT_MAP_SMOKE='+JSON.stringify({status:response?.status(),source,credentialless,loading,frameUrl,mapImages,bodyLength:body?.length||0,bodyPreview:body?.slice(0,350)||'',mapsResponses:mapsResponses.slice(-12),failures:failures.slice(-12),consoleErrors:consoleErrors.slice(-12)}));
  assert(credentialless&&loading==='eager'&&source,'Iframe configuration missing');
  await context.close();
}finally{await browser.close();}
