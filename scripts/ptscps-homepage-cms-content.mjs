import {chromium} from 'playwright';
const origin=process.env.WP_ORIGIN;
const username=process.env.WP_ADMIN_USERNAME;
const password=process.env.WP_ADMIN_PASSWORD;
if(!origin||!username||!password)throw Error('WordPress configuration missing');
// Only homepage copy approved in the owner's visual reference or directly verified on the legacy site.
// This is not article/media migration; image fields remain empty until Insert Image + ALT can be verified.
const specs=[
{id:'home_00',name:'Trang chủ — Banner chính',description:'BANNER CHÍNH',keys:['eyebrow','title','description','image','primary_label','primary_href','secondary_label','secondary_href'],rows:[
['PTSC PRODUCTION SERVICES JSC (PPS)','Vững vàng trên mọi hành trình năng lượng','Chuyên vận hành và bảo dưỡng các công trình dầu khí trên biển như FPSO/FSO/MOPU, đồng hành cùng sự phát triển bền vững của ngành năng lượng Việt Nam.','','Khám phá dịch vụ','https://ptscps.com.vn/dich-vu','Về chúng tôi','https://ptscps.com.vn/thu-ngo.htm']]},
{id:'home_01',name:'Giải pháp toàn diện cho công trình dầu khí trên biển',description:'LĨNH VỰC HOẠT ĐỘNG',keys:['title','description','image','icon','link','label'],rows:[
['Vận hành & bảo dưỡng FPSO/FSO/MOPU','Đảm bảo vận hành an toàn, liên tục và hiệu quả cho các công trình dầu khí trên biển.','','ship','https://ptscps.com.vn/dich-vu/van-hanh-va-bao-duong-fpso-fso-mopu','Dịch vụ vận hành'],
['Cung ứng nhân lực kỹ thuật','Đội ngũ nhân sự chất lượng cao, giàu kinh nghiệm, đáp ứng các tiêu chuẩn quốc tế.','','users','https://ptscps.com.vn/dich-vu/cung-ung-nhan-luc-ky-thuat-van-hanh-va-bao-duong','Nhân lực kỹ thuật'],
['Thiết kế, mua sắm & gia công chế tạo','Cung cấp giải pháp kỹ thuật tổng thể, tối ưu và hiệu quả cho các dự án dầu khí.','','settings','https://ptscps.com.vn/dich-vu/dich-vu-thiet-ke-mua-sam-gia-cong-che-tao%E2%80%8B','Kỹ thuật và chế tạo'],
['Sửa chữa bảo dưỡng công nghiệp','Thực hiện sửa chữa, bảo dưỡng định kỳ và đột xuất, đảm bảo tính sẵn sàng của thiết bị.','','wrench','https://ptscps.com.vn/dich-vu/dich-vu-sua-chua-bao-duong-cac-thiet-bi-va-cong-trinh-cong-nghiep','Bảo dưỡng thiết bị']]},
{id:'home_02',name:'Đồng hành cùng ngành năng lượng Việt Nam từ năm 2002',description:'VỀ PPS',keys:['title','description','image','button_text','href'],rows:[
['Công ty Cổ phần Dịch vụ Khai thác Dầu khí PTSC (PPS)','PPS là đơn vị thành viên của Tổng công ty Dịch vụ Kỹ thuật Dầu khí Việt Nam (PTSC), chuyên cung cấp các dịch vụ vận hành, bảo dưỡng và giải pháp kỹ thuật cho công trình dầu khí trên biển.','','Tìm hiểu thêm','https://ptscps.com.vn/thu-ngo.htm']]},
{id:'home_03',name:'Giá trị hoạt động',description:'Bốn giá trị đồng hành cùng khách hàng',keys:['title','description','icon'],rows:[
['An toàn là giá trị cốt lõi','Đặt con người, môi trường và tài sản lên hàng đầu.','gem'],
['Chuyên nghiệp trong hành động','Đội ngũ giàu kinh nghiệm, đáp ứng tiêu chuẩn quốc tế.','users'],
['Hiệu quả trong giải pháp','Tối ưu chi phí, nâng cao độ tin cậy và tính sẵn sàng.','chart-no-axes-combined'],
['Bền vững cùng phát triển','Đồng hành lâu dài với khách hàng, đối tác và cộng đồng.','leaf']]},
{id:'home_04',name:'Những công trình khẳng định năng lực PPS',description:'DỰ ÁN TIÊU BIỂU',keys:['title','description','image','link','date'],rows:[
['FPSO PTSC LAM SON','Vận hành và bảo dưỡng an toàn, hiệu quả, đóng góp quan trọng cho nguồn cung năng lượng quốc gia.','','',''],
['FSO PPS 01','Cung cấp các dịch vụ vận hành, bảo dưỡng toàn diện, đảm bảo công trình hoạt động ổn định, liên tục.','','',''],
['FPSO LEWEK EMAS','Đồng hành cùng khách hàng trong công tác vận hành và bảo dưỡng, nâng cao hiệu quả khai thác mỏ.','','','']]},
{id:'home_05',name:'Cập nhật hoạt động và sự kiện nổi bật',description:'TIN TỨC',keys:['title','description','image','link','date'],rows:[
['Công ty PPS “Hành trình tri ân năm 2026” tại TP. Hồ Chí Minh','','','https://ptscps.com.vn/cong-ty-pps-hanh-trinh-tri-an-nam-2026-tai-tp-ho-chi-minh.htm','27/07/2026'],
['ASD & UWILD 2026 Mỏ Chim Sáo: Hoàn thành an toàn, vượt tiến độ','','','https://ptscps.com.vn/asd-uwild-2026-mo-chim-sao-hoan-thanh-an-toan-vuot-tien-do-va-thiet-lap-nhieu-dau-moc-quan-trong.htm','23/06/2026'],
['PPS tổ chức thành công Đại hội đồng cổ đông thường niên 2026','','','https://ptscps.com.vn/pps-to-chuc-thanh-cong-dai-hoi-dong-co-dong-thuong-nien-2026.htm','18/06/2026']]}
];
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1440,height:960}});
const assert= (condition,msg)=>{if(!condition)throw Error(msg)};
try{
 await page.goto(origin+'/wp-login.php',{waitUntil:'domcontentloaded',timeout:45000});
 await page.locator('#user_login').fill(username);
 await page.locator('#user_pass').fill(password);
 await Promise.all([page.waitForURL(/\/wp-admin\//,{timeout:45000}),page.locator('#wp-submit').click()]);
 console.log('CMS_CONTENT_ADMIN_AUTH=PASS');
 for(const spec of specs){
  const api=origin+'/wp-json/tablepress/v1/table/'+spec.id;
  const beforeRes=await page.request.get(api);
  assert(beforeRes.ok(),'Missing existing table '+spec.id);
  const before=await beforeRes.json();
  assert(before.id===spec.id,'Wrong table ID '+spec.id);
  if(before.items?.length){
   const keys=(before.fields||[]).map(f=>f.key);
   assert(spec.keys.every((k,i)=>keys[i]===k),'Existing nonempty table schema differs from expected '+spec.id);
   console.log('CMS_CONTENT_TABLE='+spec.id+' ALREADY_POPULATED; SKIP_WRITE items='+before.items.length);
   continue;
  }
  const actualKeys=(before.fields||[]).map(f=>String(f.key||'').trim()).filter(Boolean);
  assert(actualKeys.length===0,'Refusing to overwrite configured but empty columns '+spec.id);
  await page.goto(origin+'/wp-admin/admin.php?page=tablepress&action=edit&table_id='+spec.id,{waitUntil:'domcontentloaded',timeout:45000});
  await page.waitForFunction(()=>Boolean(window.tp?.editor?.options?.data && window.tp?.callbacks?.append),null,{timeout:30000});
  const existing=await page.evaluate(()=>({rows:window.tp.editor.options.data.length,cols:window.tp.editor.options.columns.length,allEmpty:window.tp.editor.options.data.every(row=>row.every(cell=>String(cell||'').trim()===''))}));
  assert(existing.rows===2&&existing.cols===spec.keys.length&&existing.allEmpty,`Unexpected native grid for ${spec.id}: ${JSON.stringify(existing)}`);
  await page.locator('#table-name').fill(spec.name);
  await page.locator('#table-description').fill(spec.description);
  const labels=spec.keys.map(k=>({eyebrow:'Nhãn',title:'Tiêu đề',description:'Mô tả',image:'Hình ảnh',primary_label:'CTA chính',primary_href:'Liên kết CTA chính',secondary_label:'CTA phụ',secondary_href:'Liên kết CTA phụ',icon:'Biểu tượng',link:'Liên kết',label:'Nhãn truy cập',button_text:'Nút',href:'Đường dẫn',date:'Ngày'}[k]||k));
  await page.evaluate(({keys,labels,rows})=>{
   const editor=window.tp.editor;
   window.tp.callbacks.append('rows',rows.length);
   for(let c=0;c<keys.length;c++){
    editor.setValueFromCoords(c,0,keys[c]);
    editor.setValueFromCoords(c,1,labels[c]);
   }
   for(let r=0;r<rows.length;r++)for(let c=0;c<keys.length;c++){
    if(rows[r][c]!=='')editor.setValueFromCoords(c,r+2,rows[r][c]);
   }
   window.tp.helpers.unsaved_changes.set();
  },{keys:spec.keys,labels,rows:spec.rows});
  const save=page.getByRole('button',{name:/^(Save Changes|Lưu thay đổi)$/i});
  assert(await save.count()>0,'Missing native Save Changes '+spec.id);
  await save.last().click();
  let reread;
  for(let i=0;i<8;i++){
   await page.waitForTimeout(850);
   const response=await page.request.get(api);
   if(response.ok()){
    const data=await response.json();
    if(data.items?.length===spec.rows.length){reread=data;break;}
   }
  }
  assert(reread,'Save/read-after-write failed '+spec.id);
  assert(spec.keys.every((k,i)=>reread.fields[i]?.key===k),'Field mapping failed '+spec.id);
  for(let i=0;i<spec.rows.length;i++)for(let j=0;j<spec.keys.length;j++){
   assert(String(reread.items[i]?.[spec.keys[j]]||'')===spec.rows[i][j],`Value mismatch ${spec.id} row ${i}, key ${spec.keys[j]}`);
  }
  console.log('CMS_CONTENT_TABLE='+spec.id+' NATIVE_SAVE_READBACK=PASS items='+reread.items.length);
 }
 console.log('CMS_CONTENT=PASS; TABLE_COUNT=6; PAGE_PUBLICATION=NO; MIGRATION_IMPORT=NO; IMAGE_IMPORT=NO');
}finally{await browser.close();}
