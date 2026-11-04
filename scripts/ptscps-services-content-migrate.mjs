import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const wp = String(process.env.WP_ORIGIN || '').replace(/\/$/, '');
const user = process.env.WP_ADMIN_USERNAME;
const pass = process.env.WP_ADMIN_PASSWORD;
assert(wp && user && pass, 'Missing WordPress origin/admin credentials');

const services = [
  {
    slug:'van-hanh-va-bao-duong-fpso-fso-mopu',
    description:`<h4>Chúng tôi tự hào là đơn vị dẫn đầu về công nghệ quản lý, vận hành, bảo dưỡng tàu FSO/FPSO tại Việt Nam.</h4><p>Công ty Cổ phần Dịch vụ Khai thác Dầu khí PTSC được Tổng Công ty CP Dịch vụ Kỹ thuật Dầu khí Việt Nam (PTSC) và Tập đoàn Dầu khí Việt Nam (PetroVietnam) định hướng phát triển dịch vụ cung ứng, quản lý, vận hành, bảo dưỡng các kho chứa nổi, xử lý và xuất dầu thô FPSO/FSO. Kể từ khi thành lập đến nay, Công ty đã và đang cung cấp dịch vụ vận hành và bảo dưỡng cho 10 tàu chứa FPSO/FSO.</p><p>Công ty Cổ phần Dịch vụ Khai thác Dầu khí PTSC tự hào trở thành nhà thầu hàng đầu cung cấp dịch vụ vận hành và bảo dưỡng cho các tàu chứa dầu thô FPSO/FSO tại thị trường Việt Nam. Công ty đang từng bước đẩy mạnh hợp tác với các đối tác chiến lược, tích cực phát triển và giữ vững thị trường dịch vụ vận hành và bảo dưỡng FPSO/FSO tại Việt Nam đồng thời mở rộng dịch vụ ra thị trường trong khu vực.</p><p>Công ty Cổ phần Dịch vụ Khai thác Dầu khí PTSC tự hào trở thành một thương hiệu hàng đầu trong lĩnh vực cung cấp dịch vụ vận hành và bảo dưỡng cho các tàu chứa FPSO/FSO tại thị trường Việt Nam. Công ty chúng tôi đang từng bước đẩy mạnh hợp tác với các đối tác chiến lược, tiến đến chiếm lĩnh toàn bộ thị trường cung cấp dịch vụ vận hành và bảo dưỡng FPSO/FSO tại Việt Nam đồng thời mở rộng thị trường ra khu vực và thế giới.</p>`,
    projects:[
      {title:'FSO PPS 01',slug:'fso-pps-01',image:'https://ptscps.com.vn/wp-content/uploads/2024/12/12-2024-002.jpg',details:[['Loại tàu','FSO'],['Khách hàng','ZARUBEZHNEFT EP VIETNAM B.V.'],['Vị trí mỏ','Rong Doi'],['Sức chứa','314,562 bbl'],['Phạm vi dịch vụ','Chủ tàu']]},
      {title:'FSO GOLDEN STAR',slug:'fso-golden-star',image:'https://ptscps.com.vn/wp-content/uploads/2019/10/saovangdainguyet-300x200.jpg',details:[['Ngày nhận dòng dầu đầu tiên','16/11/2020'],['Loại tàu','FSO'],['Khách hàng','Idemitsu Gas Production Viet Nam Co.ltd'],['Vị trí mỏ','Lô 05-1b & 05-1c'],['Sức chứa','800,000 bbls'],['Phạm vi dịch vụ','Vận hành và bảo dưỡng']]},
      {title:'FPSO PTSC LAM SON',slug:'fpso-ptsc-lam-son',image:'https://ptscps.com.vn/wp-content/uploads/2019/10/FPSO-PTSC-LAM-SON-300x200.jpg',details:[['Ngày nhận dòng dầu đầu tiên','06/06/2014'],['Loại tàu','FPSO'],['Khách hàng','PetroVietNam – Blocks 01/97 & 02/97'],['Vị trí mỏ','Lô 01/97 & 02/97'],['Sức chứa','650,000 bbls'],['Oil production','18,000 bopd'],['Phạm vi dịch vụ','Vận hành và bảo dưỡng']]},
      {title:'FSO PTSC BIEN DONG 01',slug:'fso-ptsc-bien-dong-01',image:'https://ptscps.com.vn/wp-content/uploads/2019/10/FSO-PTSC-BIEN-DONG-01-300x200.jpg',details:[['Ngày nhận dòng dầu đầu tiên','07/08/2013'],['Loại tàu','FSO'],['Khách hàng','Biển Đông POC (BDPOC)'],['Vị trí mỏ','Lô 05-2 & 05-3'],['Sức chứa','350,000 bbls'],['Phạm vi dịch vụ','Vận hành và bảo dưỡng']]},
      {title:'FPSO RUBY II',slug:'fpso-ruby-ii',image:'https://ptscps.com.vn/wp-content/uploads/2019/10/ruby2-300x200.jpg',details:[['Ngày nhận dòng dầu đầu tiên','09/06/2010'],['Loại tàu','FPSO'],['Khách hàng','PETRONAS/PVEP/PVN'],['Vị trí mỏ','Lô 01 & 02'],['Sức chứa','600,000 bbls'],['Total liquid production','45,000 bopd'],['Phạm vi dịch vụ','Vận hành và bảo dưỡng']]},
      {title:'FSO PTSC BACH HO',slug:'fso-ptsc-bach-ho',image:'https://ptscps.com.vn/wp-content/uploads/2019/10/FSO-PTSC-BACH-HO-300x200.jpg',details:[['Ngày nhận dòng dầu đầu tiên','08/11/2010'],['Loại tàu','FSO'],['Khách hàng','Vietsovpetro Joint Venture (VSP)'],['Vị trí mỏ','Lô 09-1'],['Sức chứa','1,000,000 bbls'],['Phạm vi dịch vụ','Vận hành và bảo dưỡng (Đã bàn giao cho VSP vào Tháng 9 năm 2011)']]},
      {title:'FPSO RUBY PRINCESS',slug:'fpso-ruby-princess',image:'https://ptscps.com.vn/wp-content/uploads/2019/10/FPSO-RUBY-PRINCESS-300x200.jpg',details:[['Loại tàu','FPSO'],['Khách hàng','Petronas Carigali Vietnam Limited (PCVL)'],['Vị trí mỏ','Blocks 01 & 02'],['Sức chứa','1,000,000 bbls'],['Max throughput','35,000 bopd'],['Phạm vi dịch vụ','Full O&M services']]},
    ],
  },
  {
    slug:'cung-ung-nhan-luc-ky-thuat-van-hanh-va-bao-duong',
    description:`<p>Chúng tôi cung cấp đội ngũ nhân lực kỹ thuật có năng lực, trình độ chuyên môn cao và nhiều kinh nghiệm hoạt động trên các công trình dầu khí trên biển và trên bờ, phục vụ cho các kho nổi FPSO / FSO, các giàn khai thác dầu khí, các nhà máy hóa dầu. Bao gồm:</p><ul><li>Tất cả các chức danh vận hành bảo dưỡng FPSO / FSO / MOPU;</li><li>Các chức danh vận hành bảo dưỡng các giàn cố định, nhà máy công nghiệp hóa dầu và các công trình dầu khí khác.</li></ul><p>Công ty hiện đang cung cấp đội ngũ nhân sự kỹ thuật cao phục vụ công tác vận hành và bảo dưỡng cho các dự án sau:</p><ul><li>FPSO Lewek Emas cho khách hàng EnQuest Vietnam</li><li>FPSO Thai Binh VN cho khách hàng Cửu Long JOC</li><li>FSO Orkid cho khách hàng Repsol Malaysia</li><li>Thái Bình Platform cho khách hàng Petronas Carigali Overseas SDN.BHD.(PCOSB)</li><li>Khu vực thượng nguồn (Upstream Plant) cho nhà máy hóa dầu Long Sơn</li></ul>`,
    projects:[
      {title:'FPSO LEWEK EMAS',slug:'fpso-lewek-emas',image:'https://ptscps.com.vn/wp-content/uploads/2024/01/PTS09-2025-001.jpg',details:[['Ngày nhận dòng dầu đầu tiên','10/10/2011'],['Loại tàu','FPSO Converted'],['Khách hàng','Harbour Energy'],['Vị trí mỏ','Block 12W'],['Sức chứa','670,000 bbls'],['Phạm vi dịch vụ','Vận hành và bảo dưỡng']]},
      {title:'FPSO THAI BINH VN',slug:'fpso-thai-binh-vn',image:'https://ptscps.com.vn/wp-content/uploads/2019/10/FPSO-Thai-Binh-300x200.jpg',details:[['Loại tàu','FPSO'],['Khách hàng','Cuu Long JOC'],['Vị trí mỏ','Sư Tử Đen, Lô 15-1'],['Sức chứa','1,000,000 bbls'],['Công suất xử lý tối đa','65,000 bopd'],['Phạm vi dịch vụ','Cung cấp nhân lực vận hành và bảo dưỡng']]},
      {title:'FSO ORKID',slug:'fso-orkid',image:'https://ptscps.com.vn/wp-content/uploads/2019/10/FSO-ORKID-1-300x200.jpg',details:[['Loại tàu','FSO'],['Khách hàng','Talisman Malaysia Limited (TML) / Repsol'],['Vị trí mỏ','PM-3 CAA Northern Field, Offshore Malaysia'],['Sức chứa','745,000 bbls'],['Phạm vi dịch vụ','Cung cấp nhân lực vận hành và bảo dưỡng']]},
      {title:'Khu vực thượng nguồn – Nhà máy hóa dầu Long Sơn',slug:'khu-vuc-thuong-nguon-nha-may-hoa-dau-long-son',image:'https://ptscps.com.vn/wp-content/uploads/2025/09/PTS09-2025-002.jpg',details:[['Khách hàng','Công ty TNHH Lọc Hóa Dầu Long Sơn'],['Vị trí','Xã Long Sơn, Thành phố Hồ Chí Minh'],['Phạm vi dịch vụ','Cung cấp nhân lực vận hành và bảo dưỡng']]},
    ],
  },
  {
    slug:'dich-vu-thiet-ke-mua-sam-gia-cong-che-tao',
    description:`<p>Công ty cung cấp các dịch vụ EPCI (engineering, procurement, construction and installation) cho các cấu kiện như:</p><ul><li>Skid fabrication (including valve, pump, process skid…);</li><li>Piping and structural fabrication;</li><li>Pressure vessel, tank fabrication;</li><li>E&amp;I system (Metering, ICSS, cathodic protection).</li></ul><h3>Các dự án đã thực hiện</h3><p><strong>1. Dự án thiết kế, mua sắm, thi công chế tạo chạy thử hệ thống, cụm thiết bị thuộc dự án Trạm Thu gom và phân phối khí Thái Bình – Hàm Rồng</strong></p><p>Phạm vi công việc: Thiết kế, mua sắm, thi công chế tạo chạy thử cho 18 gói cụm, hệ thống thiết bị cho dự án trạm thu gom và phân phối khí Thái Bình – Hàm Rồng bao gồm hệ thống Corrosion Inhibitor Skid, Pig Launcher – Pig Receiver, Piping system of platform, Hot tap flange, Piping on GDC-LFS, Valve skid, Fire fighting system, Hydrate system, Separator, Heat Exchanger, Flare, Truck Loading System, Oil Water Treatment, ICSS, Metering System, Electrical System và Cathodic Protection.</p><p><strong>2. Dự án thiết kế, mua sắm, thi công chế tạo chạy thử hệ thống Metering Skid thuộc Dự án thu gom khí Đại Hùng</strong></p><p>Phạm vi công việc: Thiết kế, mua sắm, chế tạo và chạy thử 01 hệ thống Gas Custody Metering (Tag. No 36A001).</p><p><strong>3. Dự án thiết kế, mua sắm, thi công chế tạo chạy thử hệ thống Chemical injection Skid cho giàn Đông Đô – PVEP Block 01/97 &amp; 02/97</strong></p><p>Phạm vi công việc: Thiết kế, mua sắm, chế tạo, lắp đặt chạy thử 01 hệ thống bơm H2 Scavenger Injection Pump trên giàn Đông Đô.</p><p><strong>4. Dự án chế tạo Condensate Tank TK-8040 for NPK Project</strong></p><p>Phạm vi công việc: Thiết kế, mua sắm, chế tạo 01 condensate tank (TK-8040).</p><p><strong>5. Dự án cung cấp năng lượng sạch và chiếu sáng cho Quần đảo Trường Sa</strong></p><p>Phạm vi công việc: Mua sắm, chế tạo, lắp đặt các kết cấu thép cho dự án cấp năng lượng và chiếu sáng cho Quần đảo Trường Sa.</p>`,
    projects:[],
  },
  {
    slug:'dich-vu-sua-chua-bao-duong-cac-thiet-bi-va-cong-trinh-cong-nghiep',
    description:`<p>Công ty đã đầu tư xây dựng khu nhà xưởng để thực hiện dịch vụ sửa chữa bảo dưỡng trên diện tích 5000m2 nằm trong khu vực Cảng hạ lưu PTSC, đồng thời cũng đã đầu tư đầy đủ trang thiết bị nhằm phục vụ công tác bảo dưỡng, sửa chữa trên các tàu FPSO/FSO và thực hiện các dịch vụ khác cho khách hàng.</p><p>Công ty đã được cấp chứng chỉ ASME (American Society of Mechanical Engineers) về thiết kế, sản xuất chế tạo và sửa chữa nồi hơi và bình chịu áp lực.</p><p>Các dịch vụ sửa chữa bảo dưỡng được Công ty thực hiện bao gồm:</p><ul><li>Dịch vụ Bảo dưỡng, sửa chữa thiết bị bao gồm các thiết bị tĩnh, thiết bị quay, thiết bị điện và tự động hóa.</li><li>Vận hành và bảo dưỡng sửa chữa các nhà máy, các công trình công nghiệp.</li><li>Các dịch vụ liên quan khác.</li></ul>`,
    projects:[],
  },
];

const taxonomySafeDescription = (service) => {
  if (service.slug !== 'dich-vu-thiet-ke-mua-sam-gia-cong-che-tao') return service.description;
  return `Công ty cung cấp các dịch vụ EPCI (engineering, procurement, construction and installation) cho các cấu kiện như:

• Skid fabrication (including valve, pump, process skid…);
• Piping and structural fabrication;
• Pressure vessel, tank fabrication;
• E&I system (Metering, ICSS, cathodic protection).

<strong>Các dự án đã thực hiện</strong>

<strong>1. Dự án thiết kế, mua sắm, thi công chế tạo chạy thử hệ thống, cụm thiết bị thuộc dự án Trạm Thu gom và phân phối khí Thái Bình – Hàm Rồng</strong>
Phạm vi công việc: Thiết kế, mua sắm, thi công chế tạo chạy thử cho 18 gói cụm, hệ thống thiết bị cho dự án trạm thu gom và phân phối khí Thái Bình – Hàm Rồng bao gồm hệ thống Corrosion Inhibitor Skid, Pig Launcher – Pig Receiver, Piping system of platform, Hot tap flange, Piping on GDC-LFS, Valve skid, Fire fighting system, Hydrate system, Separator, Heat Exchanger, Flare, Truck Loading System, Oil Water Treatment, ICSS, Metering System, Electrical System và Cathodic Protection.

<strong>2. Dự án thiết kế, mua sắm, thi công chế tạo chạy thử hệ thống Metering Skid thuộc Dự án thu gom khí Đại Hùng</strong>
Phạm vi công việc: Thiết kế, mua sắm, chế tạo và chạy thử 01 hệ thống Gas Custody Metering (Tag. No 36A001).

<strong>3. Dự án thiết kế, mua sắm, thi công chế tạo chạy thử hệ thống Chemical injection Skid cho giàn Đông Đô – PVEP Block 01/97 & 02/97</strong>
Phạm vi công việc: Thiết kế, mua sắm, chế tạo, lắp đặt chạy thử 01 hệ thống bơm H2 Scavenger Injection Pump trên giàn Đông Đô.

<strong>4. Dự án chế tạo Condensate Tank TK-8040 for NPK Project</strong>
Phạm vi công việc: Thiết kế, mua sắm, chế tạo 01 condensate tank (TK-8040).

<strong>5. Dự án cung cấp năng lượng sạch và chiếu sáng cho Quần đảo Trường Sa</strong>
Phạm vi công việc: Mua sắm, chế tạo, lắp đặt các kết cấu thép cho dự án cấp năng lượng và chiếu sáng cho Quần đảo Trường Sa.`;
};

const clean = (v) => String(v ?? '').replace(/<[^>]+>/g,'').replace(/\s+/g,' ').trim();
const cleanDescription = (v) => String(v ?? '').replace(/<[^>]+>/g,'').replace(/\r\n?/g,'\n').split('\n').map(line=>line.replace(/[ \t]+/g,' ').trim()).join('\n').replace(/\n{3,}/g,'\n\n').trim();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const report = (k,v) => console.log(`SERVICES_CONTENT_${k}=${typeof v==='string'?v:JSON.stringify(v)}`);
const browser = await chromium.launch({headless:true});
const context = await browser.newContext({viewport:{width:1440,height:1000}});
const page = await context.newPage();

async function login(){
  await page.goto(`${wp}/wp-login.php`,{waitUntil:'domcontentloaded',timeout:50000});
  await page.locator('#user_login').fill(user);
  await page.locator('#user_pass').fill(pass);
  await Promise.all([page.waitForURL(/\/wp-admin\//,{timeout:50000}),page.locator('#wp-submit').click()]);
  report('ADMIN_AUTH','PASS');
}
async function restNonce(){
  const candidates=['/wp-admin/nav-menus.php?esc_full_admin=1','/wp-admin/edit-tags.php?taxonomy=product_cat&post_type=product&esc_full_admin=1'];
  for(const path of candidates){
    await page.goto(`${wp}${path}`,{waitUntil:'domcontentloaded',timeout:50000});
    const nonce=await page.evaluate(()=>String(globalThis.wpApiSettings?.nonce||'').trim());
    if(/^[A-Za-z0-9_-]{8,32}$/.test(nonce))return nonce;
  }
  const res=await page.request.post(`${wp}/wp-admin/admin-ajax.php`,{form:{action:'rest-nonce'},timeout:30000});
  if(res.ok()){
    const nonce=(await res.text()).trim();
    if(/^[A-Za-z0-9_-]{8,32}$/.test(nonce))return nonce;
  }
  throw Error('WordPress REST nonce unavailable');
}
async function jsonRequest(method,path,nonce,data){
  const opts={method,headers:{'X-WP-Nonce':nonce,'Cache-Control':'no-cache'},timeout:45000};
  if(data!==undefined)opts.data=data;
  const res=await page.request.fetch(`${wp}${path}`,opts); const body=await res.json().catch(()=>({}));
  return {res,body};
}
async function findCategory(nonce,slug){
  const {res,body}=await jsonRequest('GET',`/wp-json/wp/v2/product_cat?context=edit&hide_empty=false&slug=${encodeURIComponent(slug)}&per_page=20`,nonce);
  assert(res.ok(),`Category lookup HTTP ${res.status()} ${slug}`); assert(body.length===1,`Category lookup mismatch ${slug}`); return body[0];
}
async function ensureDescription(nonce,category,html){
  const current=String(category.description?.raw ?? category.description ?? '');
  if(cleanDescription(current)===cleanDescription(html)){report('DESCRIPTION',{slug:category.slug,state:'ALREADY_CORRECT_SKIP_WRITE'});return false;}
  const {res,body}=await jsonRequest('POST',`/wp-json/wp/v2/product_cat/${category.id}`,nonce,{description:html});
  assert(res.ok(),`Category description update HTTP ${res.status()} ${category.slug}`);
  assert(cleanDescription(body.description?.raw ?? body.description ?? '')===cleanDescription(html),`Category description readback mismatch ${category.slug}`);
  report('DESCRIPTION',{slug:category.slug,state:'UPDATED_VERIFIED'}); return true;
}
async function findMedia(nonce,file){
  const slug=file.replace(/\.[^.]+$/,'');
  const {res,body}=await jsonRequest('GET',`/wp-json/wp/v2/media?context=edit&slug=${encodeURIComponent(slug)}&per_page=20&_fields=id,slug,source_url,alt_text,title`,nonce);
  assert(res.ok(),`Media lookup HTTP ${res.status()}`); assert(body.length<=1,`Duplicate media ${slug}`); return body[0]||null;
}
async function ensureMedia(nonce,project){
  const file=`ptscps-project-${project.slug}.jpg`;
  let existing=await findMedia(nonce,file); if(existing){report('MEDIA',{slug:project.slug,id:existing.id,state:'ALREADY_PRESENT_SKIP_WRITE'});return existing;}
  const source=await fetch(project.image,{headers:{'User-Agent':'PTSCPS migration'}}); assert(source.ok,`Legacy image HTTP ${source.status} ${project.slug}`);
  const bytes=Buffer.from(await source.arrayBuffer()); assert(bytes.length>3000,`Legacy image too small ${project.slug}`);
  const contentType=source.headers.get('content-type')?.split(';')[0]||'image/jpeg';
  let created=null;
  for(let attempt=1;attempt<=3&&!created;attempt++){
    try{
      const upload=await page.request.post(`${wp}/wp-json/wp/v2/media`,{headers:{'X-WP-Nonce':nonce,'Content-Type':contentType,'Content-Disposition':`attachment; filename="${file}"`},data:bytes,timeout:60000});
      const body=await upload.json().catch(()=>({}));
      if(upload.ok()&&Number(body?.id)>0){created=body;break;}
      report('MEDIA_UPLOAD_RETRY',{slug:project.slug,attempt,http:upload.status()});
    }catch(error){
      report('MEDIA_UPLOAD_RETRY',{slug:project.slug,attempt,transport:error?.message||'error'});
    }
    for(let readAttempt=1;readAttempt<=4&&!created;readAttempt++){
      await sleep(700*readAttempt);
      const recovered=await findMedia(nonce,file).catch(()=>null);
      if(recovered){created=recovered;report('MEDIA_UPLOAD_READBACK_RECOVERED',{slug:project.slug,id:recovered.id,attempt,readAttempt});}
    }
  }
  assert(created&&Number(created.id)>0,`Media upload failed ${project.slug} after retries`);
  let metadataUpdated=false;
  for(let attempt=1;attempt<=3&&!metadataUpdated;attempt++){
    try{
      const meta=await jsonRequest('POST',`/wp-json/wp/v2/media/${created.id}`,nonce,{alt_text:project.title,title:project.title,caption:''});
      if(meta.res.ok()){metadataUpdated=true;break;}
      report('MEDIA_META_RETRY',{slug:project.slug,attempt,http:meta.res.status()});
    }catch(error){report('MEDIA_META_RETRY',{slug:project.slug,attempt,transport:error?.message||'error'});}
    await sleep(700*attempt);
  }
  assert(metadataUpdated,`Media metadata failed ${project.slug}`);
  existing=await findMedia(nonce,file); assert(existing&&Number(existing.id)===Number(created.id),`Media readback failed ${project.slug}`);
  report('MEDIA',{slug:project.slug,id:existing.id,state:'CREATED'}); return existing;
}
const detailHtml=(project)=>`<table><tbody>${project.details.map(([k,v])=>`<tr><th>${k}</th><td>${v}</td></tr>`).join('')}</tbody></table>`;
async function productBySlug(nonce,slug){
  const {res,body}=await jsonRequest('GET',`/wp-json/wp/v2/product?context=edit&status=publish,draft,pending,private&slug=${encodeURIComponent(slug)}&per_page=20&_fields=id,slug,status,title,acf,content,featured_media,product_categories`,nonce);
  assert(res.ok(),`Product lookup HTTP ${res.status()} ${slug}`); assert(body.length<=1,`Duplicate product slug ${slug}`); return body[0]||null;
}
async function setProductLang(id){
  await page.goto(`${wp}/wp-admin/post.php?post=${id}&action=edit&esc_full_admin=1`,{waitUntil:'domcontentloaded',timeout:50000});
  const row=page.locator('[data-name="product_lang"]').first(); assert(await row.count()===1,`product_lang ACF missing product ${id}`);
  const select=row.locator('select').first();
  if(await select.count()) await select.selectOption('vi'); else {const input=row.locator('input[type="text"],input:not([type])').first();assert(await input.count(),`product_lang input missing ${id}`);await input.fill('vi');}
  const publish=page.locator('#publish'); assert(await publish.count(),`Product update button missing ${id}`);
  await Promise.all([page.waitForNavigation({waitUntil:'domcontentloaded',timeout:45000}).catch(()=>null),publish.click()]);
}
async function ensureProduct(nonce,category,project){
  const media=await ensureMedia(nonce,project); const content=detailHtml(project); let product=await productBySlug(nonce,project.slug);
  const payload={title:project.title,slug:project.slug,status:'publish',content,featured_media:Number(media.id),product_cat:[Number(category.id)]};
  let state='UPDATED_VERIFIED';
  if(product){
    const currentCats=Array.isArray(product.product_categories)?product.product_categories.map(x=>Number(x.id)):[];
    const lang=product.acf?.product_lang?.value??product.acf?.product_lang;
    if(clean(product.title?.raw??product.title?.rendered)===project.title&&clean(product.content?.raw??product.content?.rendered)===clean(content)&&Number(product.featured_media)===Number(media.id)&&currentCats.includes(Number(category.id))&&lang==='vi'){
      report('PRODUCT',{slug:project.slug,id:product.id,state:'ALREADY_CORRECT_SKIP_WRITE'}); return false;
    }
    const update=await jsonRequest('POST',`/wp-json/wp/v2/product/${product.id}`,nonce,payload); assert(update.res.ok(),`Product update HTTP ${update.res.status()} ${project.slug}`);
  }else{
    const create=await jsonRequest('POST','/wp-json/wp/v2/product',nonce,payload); assert(create.res.ok()&&create.body.id,`Product create HTTP ${create.res.status()} ${project.slug}`); product=create.body; state='CREATED_VERIFIED';
  }
  await setProductLang(Number(product.id));
  product=await productBySlug(nonce,project.slug); assert(product&&product.status==='publish',`Product readback missing ${project.slug}`);
  const cats=(product.product_categories||[]).map(x=>Number(x.id)); const lang=product.acf?.product_lang?.value??product.acf?.product_lang;
  assert(cats.includes(Number(category.id)),`Product category mismatch ${project.slug}`); assert(lang==='vi',`Product lang mismatch ${project.slug}`);
  report('PRODUCT',{slug:project.slug,id:product.id,state}); return true;
}

try{
  await login(); const nonce=await restNonce(); let changed=false; let projectCount=0;
  for(const service of services){
    const category=await findCategory(nonce,service.slug); const description=taxonomySafeDescription(service);
    changed=(await ensureDescription(nonce,category,description))||changed;
    for(const project of service.projects){changed=(await ensureProduct(nonce,category,project))||changed; projectCount++;}
  }
  report('RESULT',{status:'PASS',categories:services.length,projects:projectCount,changed});
} finally {await browser.close();}
