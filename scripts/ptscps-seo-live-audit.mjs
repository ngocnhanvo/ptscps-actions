const wpOrigin=process.env.WP_ORIGIN;
const clientOrigin=process.env.CLIENT_ORIGIN;
if(!wpOrigin||!clientOrigin||!/^https:\/\/[^/]+$/.test(wpOrigin)||!/^https:\/\/[^/]+$/.test(clientOrigin))throw new Error('Missing/invalid SEO origins');
const response=await fetch(wpOrigin+'/wp-json/esc-seo-files/v1/public',{headers:{Accept:'application/json','Cache-Control':'no-cache'},signal:AbortSignal.timeout(20000)});
console.log('SEO_API_STATUS='+response.status);
if(!response.ok())throw new Error('SEO API unavailable');
const data=await response.json();
const arrays=['extra','exclude'];
const result={site:data.site,expectedSite:clientOrigin,revision:data.sitemap?.revision,mode:data.sitemap?.mode,robotsSitemapReferences:[...String(data.robots||'').matchAll(/^Sitemap:\s*(.+)$/gmi)].map(x=>x[1]),llmsOriginMatches:String(data.llms||'').includes(']('+clientOrigin+'/')};
for(const p of arrays){const a=data.sitemap?.[p]||[];result[p]={count:a.length,offSite:a.filter(u=>{try{return new URL(u).origin!==clientOrigin}catch{return true}}).slice(0,20),sample:a.slice(0,6)};}
const xml=String(data.sitemap?.xml||'');const urls=[...xml.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/g)].map(m=>m[1].trim());result.xml={length:xml.length,urlCount:urls.length,offSite:urls.filter(u=>{try{return new URL(u).origin!==clientOrigin}catch{return true}}).slice(0,20),sample:urls.slice(0,6)};
console.log('SEO_PUBLIC_DIAG='+JSON.stringify(result));
if(data.site!==clientOrigin)throw new Error('SEO_SITE_MISMATCH');
console.log('SEO_AUDIT=PASS_READ_ONLY');
