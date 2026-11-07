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
  const layoutChecks=[];
  for(const width of [1440,390]){
    await page.setViewportSize({width,height:900});
    const english=await page.goto(`${front}/contact?_layout_smoke=${Date.now()}`,{waitUntil:'domcontentloaded',timeout:45000});
    assert(english?.status()===200,`English Contact HTTP ${english?.status()} at ${width}px`);
    const root=page.locator('[data-tablepress-preview="contact_00_en"] > main');
    await root.waitFor({state:'visible',timeout:15000});
    const panel=root.locator(':scope > .glass-panel');
    assert(await panel.count()===1,`English Contact form card missing at ${width}px`);
    const metrics=await root.evaluate((el)=>{
      const panel=el.querySelector('.glass-panel');
      const rootStyle=getComputedStyle(el);
      const panelStyle=panel?getComputedStyle(panel):null;
      const rect=el.getBoundingClientRect();
      return {
        maxWidth:rootStyle.maxWidth,
        paddingLeft:rootStyle.paddingLeft,
        paddingRight:rootStyle.paddingRight,
        paddingBottom:rootStyle.paddingBottom,
        marginLeft:rootStyle.marginLeft,
        marginRight:rootStyle.marginRight,
        panelPadding:panelStyle?.padding||'',
        panelRadius:panelStyle?.borderRadius||'',
        left:rect.left,right:rect.right,width:rect.width,
        viewport:window.innerWidth,
        scrollWidth:document.documentElement.scrollWidth,
      };
    });
    assert(metrics.maxWidth==='1200px',`English Contact max-width mismatch at ${width}px: ${metrics.maxWidth}`);
    assert(parseFloat(metrics.paddingLeft)>=19&&parseFloat(metrics.paddingRight)>=19,
      `English Contact wrapper padding missing at ${width}px: ${JSON.stringify(metrics)}`);
    assert(parseFloat(metrics.panelPadding)>=31,
      `English Contact card padding missing at ${width}px: ${metrics.panelPadding}`);
    assert(metrics.scrollWidth<=metrics.viewport+2,
      `English Contact horizontal overflow at ${width}px: ${JSON.stringify(metrics)}`);
    await page.screenshot({path:`${artifact}/contact-en-${width}.png`,fullPage:true,timeout:20000});
    layoutChecks.push({width,...metrics});
  }
  console.log('PTSCPS_CONTACT_EN_FORM_LAYOUT='+JSON.stringify(layoutChecks));
  await context.close();
}finally{await browser.close();}
