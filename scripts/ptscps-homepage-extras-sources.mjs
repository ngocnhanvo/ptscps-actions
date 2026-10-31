import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';

const legacy='https://ptscps.com.vn';
const output=process.env.PTSCPS_EXTRAS_MEDIA_JSON || '/tmp/ptscps-extras-media.json';
const logos=[
  ['Biển Đông POC','2024/04/2222221z5245174915163_4145568119040ed86e3b35d70f0b52ca-scaled.jpg'],
  ['Premier Oil','2022/09/premier-oil.png'],
  ['PetroVietnam','2024/04/333333z5245174082713_4252facd17ae73b1c1d1864970e283b0-scaled.jpg'],
  ['Murphy Oil','2020/03/Murphy.png'],
  ['VOFT','2020/03/VOFT.png'],
  ['Cửu Long JOC','2019/10/pps-doi-tac-1.jpg'],
  ['Hoàn Vũ JOC','2019/12/logo_Hoang-Vu.png'],
  ['Idemitsu','2025/04/idemitsu-logo.jpg'],
  ['Rosneft','2019/12/logo_Rosneft.png'],
  ['Hoàng Long JOC','2019/12/logo_Hoang-Long.png'],
  ['KNOC','2019/12/logo_Knoc.png'],
  ['MODEC','2019/10/pps-doi-tac-4.png'],
  ['PETRONAS','2019/10/pps-doi-tac-5.png'],
  ['Thăng Long JOC','2024/11/thang-long-logo.jpg'],
  ['NSRP','2019/12/logo_NSRP.png'],
  ['Harbour Energy','2024/11/harbour-logo.jpg'],
  ['enQuest','2025/09/z6979874551665_c8eb34aea9a83efe75c7d7f7eaf2c96e.jpg'],
  ['Long Sơn Petrochemicals','2025/09/z6979874281864_b62cc6399bb17ed6d2f7d64bcc059a17.jpg'],
  ['MVOT','2025/11/MVOT.jpg'],
];
const items=logos.map(([alt,route],row)=>({table:'home_15',row,url:`${legacy}/wp-content/uploads/${route}`,alt:`Logo ${alt}`}));
const thumbLinks=[
  ['Vận hành và bảo dưỡng FPSO/FSO/MOPU','/dich-vu/van-hanh-va-bao-duong-fpso-fso-mopu'],
  ['Thư viện PPS','/thu-vien-pps'],
  ['Chính sách HSEQ','/hseq/chinh-sach-skatmtcl'],
  ['Tuyển dụng','/c/tuyen-dung'],
];
const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage({viewport:{width:1280,height:900},deviceScaleFactor:1});
 await page.goto(legacy+'/',{waitUntil:'domcontentloaded',timeout:45000});
 await page.waitForTimeout(1200);
 const found=await page.evaluate(({thumbLinks})=>{
  const extract=(element)=>{
   if(!(element instanceof HTMLElement))return [];
   const results=[];
   const nodes=[element,...Array.from(element.querySelectorAll('img,[style],picture,div,span'))].slice(0,100);
   for(const node of nodes){
    if(node instanceof HTMLImageElement){
      const src=node.getAttribute('src')||node.getAttribute('data-src')||node.currentSrc;
      if(src)results.push(src);
    }
    const computed=getComputedStyle(node).backgroundImage;
    const match=computed.match(/url\(["']?(.*?)["']?\)/);
    if(match?.[1])results.push(match[1]);
    const dataBg=node.getAttribute('data-background')||node.getAttribute('data-bg');
    if(dataBg)results.push(dataBg);
   }
   return [...new Set(results)].map(url=>{try{return new URL(url,location.href).href}catch{return ''}}).filter(url=>url.startsWith(location.origin+'/') && /\.(png|jpg|jpeg|webp)(\?|$)/i.test(url));
  };
  return thumbLinks.map(([label,route])=>{
    const links=[...document.querySelectorAll('a[href]')].filter(el=>{
      try{return new URL(el.href).pathname.replace(/\/$/,'')===route.replace(/\/$/,'')}catch{return false}
    });
    const options=[];
    for(const link of links){
      let current=link;
      for(let level=0;level<4&&current;level++,current=current.parentElement){
        const images=extract(current);
        for(const src of images)options.push({src,level});
        if(images.length)break;
      }
    }
    const images=[...new Map(options.map(o=>[o.src,o])).values()].sort((a,b)=>a.level-b.level);
    return {label,route,url:images[0]?.src||'',candidateCount:images.length,links:links.length};
  });
 },{thumbLinks});
 for(let i=0;i<thumbLinks.length;i++){
   const f=found[i];
   console.log(`EXTRAS_QUICKLINK_SOURCE=${i} matches=${f.links} candidates=${f.candidateCount} found=${Boolean(f.url)}`);
   if(f.url)items.push({table:'home_14',row:i,url:f.url,alt:`${f.label} - PTSC PPS`});
 }
 const totalQuick=items.filter(x=>x.table==='home_14').length;
 if(totalQuick!==4)throw Error(`Cannot identify all four genuine quick-link thumbnails from the original website (found ${totalQuick}/4). Refusing substitute imagery.`);
 const mediaURLs=[...new Set(items.map(x=>x.url))];
 for(const url of mediaURLs){
  const response=await fetch(url,{method:'HEAD',redirect:'follow',signal:AbortSignal.timeout(20000)});
  if(!response.ok() || !String(response.headers.get('content-type')||'').startsWith('image/'))throw Error(`Invalid source image HTTP ${response.status} at ${new URL(url).pathname}`);
 }
 await writeFile(output,JSON.stringify(items,null,2),'utf8');
 console.log(`EXTRAS_SOURCE_PREFLIGHT=PASS logos=19 tiles=4 total=${items.length}`);
}finally{await browser.close();}
