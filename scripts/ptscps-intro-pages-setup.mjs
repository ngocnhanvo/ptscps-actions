import { chromium } from 'playwright';
import fs from 'node:fs/promises';

const wp = process.env.WP_ORIGIN;
const front = process.env.FRONT_ORIGIN;
const username = process.env.WP_ADMIN_USERNAME;
const password = process.env.WP_ADMIN_PASSWORD;
if (![wp, front, username, password].every(Boolean)) throw Error('Missing configured WordPress inputs');

const brochureUrl = 'https://ptscps.com.vn/wp-content/uploads/2024/12/PPS-update.pdf';
const tableFields = ['type', 'group', 'title', 'content', 'meta', 'href'];
const tableLabels = ['Loại nội dung', 'Nhóm', 'Tiêu đề', 'Nội dung', 'Thông tin phụ', 'Liên kết'];
const specs = [
  {
    id: 'about_00', slug: 'thu-ngo', title: 'Thư ngỏ', key: 'about-letter', description: 'GIỚI THIỆU',
    rows: [
      ['prose','','','Công ty Cổ phần Dịch vụ Khai thác Dầu khí PTSC (PTSC Production Services JSC) sau gần 25 năm xây dựng và phát triển gắn liền với Tổng Công ty Dịch vụ Kỹ thuật Dầu khí PTSC và Tập đoàn Công nghiệp Năng lượng Quốc gia Việt Nam đã và đang thực hiện thành công, an toàn và hiệu quả dịch vụ vận hành và bảo dưỡng các dự án FPSO/FSO tại Việt Nam và khu vực. Nhiệm vụ của chúng tôi là cung cấp dịch vụ vận hành và bảo dưỡng với chất lượng tốt nhất, đảm bảo an toàn và hiệu quả được khách hàng công nhận và đánh giá cao.','',''],
      ['prose','','','Đứng trước những khó khăn, thách thức của ngành dầu khí trong thời gian tới với dự báo nhu cầu năng lượng toàn cầu sẽ tiếp tục tăng, nhu cầu về việc sử dụng khí đốt tự nhiên là nguồn năng lượng sạch chính sẽ tiếp tục được phát triển mạnh, chúng tôi cam kết luôn kế thừa và phát huy những giá trị truyền thống và kinh nghiệm, tiếp tục phấn đấu giữ vững vị trí hàng đầu trong lĩnh vực cung cấp dịch vụ vận hành bảo dưỡng FPSO/FSO tại Việt Nam, đồng thời chú trọng và luôn nỗ lực không ngừng xây dựng mở rộng phát triển dịch vụ sang các lĩnh vực mới gắn liền với định hướng phát triển của Tổng Công ty PTSC và Tập đoàn Công nghiệp Năng lượng Quốc gia Việt Nam.','',''],
      ['award','','Bằng khen của Thủ tướng Chính phủ','','Năm 2010',''],
      ['award','','Huân chương lao động hạng Ba','','Năm 2012',''],
    ],
    snippet: 'sau gần 25 năm xây dựng và phát triển',
  },
  {
    id: 'about_01', slug: 'gioi-thieu-cong-ty', title: 'Giới thiệu công ty', key: 'about-company', description: 'GIỚI THIỆU',
    rows: [
      ['prose','','','Công ty Cổ phần Dịch vụ Khai thác Dầu khí PTSC, tiền thân là Xí nghiệp Dịch vụ Khai thác Dầu khí chính thức đi vào hoạt động từ 15/09/2002. Ngày 19/03/2007 Xí nghiệp được chuyển đổi thành Công ty TNHH MTV Dịch vụ Khai thác Dầu khí PTSC. Với sự phát triển ngày càng lớn mạnh, Công ty chính thức chuyển đổi sang hình thức Công ty cổ phần với tên gọi Công ty Cổ phần Dịch vụ Khai thác Dầu khí PTSC ngày 01/04/2011.','',''],
      ['section','','Các ngành nghề kinh doanh chính của Công ty hiện nay bao gồm:','','',''],
      ['service','','Vận hành và bảo dưỡng FPSO/FSO/MOPU.','','',''],
      ['service','','Cung ứng nhân lực kỹ thuật vận hành và bảo dưỡng.','','',''],
      ['service','','Dịch vụ thiết kế, mua sắm, gia công chế tạo và lắp đặt','','',''],
      ['service','','Dịch vụ sửa chữa bảo dưỡng các thiết bị và công trình công nghiệp.','','',''],
    ],
    snippet: 'chính thức đi vào hoạt động từ 15/09/2002',
  },
  {
    id: 'about_02', slug: 'ban-lanh-dao', title: 'Ban lãnh đạo', key: 'about-leadership', description: 'GIỚI THIỆU',
    rows: [
      ['leader','Hội đồng quản trị','Ông Nguyễn Viết Long','','Chủ tịch HĐQT',''],
      ['leader','Hội đồng quản trị','Ông Phạm Đình Kiên','','Thành viên HĐQT',''],
      ['leader','Hội đồng quản trị','Ông Nguyễn Văn Tùng','','Thành viên HĐQT',''],
      ['leader','Hội đồng quản trị','Ông Phạm Quốc Huy','','Thành viên HĐQT',''],
      ['leader','Hội đồng quản trị','Ông Lê Toàn Thắng','','Thành viên HĐQT chuyên trách',''],
      ['leader','Ban điều hành','Ông Nguyễn Quốc Hoàng','','Giám đốc',''],
      ['leader','Ban điều hành','Ông Nguyễn Văn Hải','','Phó Giám đốc',''],
      ['leader','Ban điều hành','Ông Thịnh Văn Thìn','','Phó Giám đốc',''],
    ],
    snippet: 'Ông Nguyễn Quốc Hoàng',
  },
  {
    id: 'about_03', slug: 'qua-trinh-phat-trien', title: 'Quá trình phát triển', key: 'about-history', description: 'GIỚI THIỆU',
    rows: [
      ['timeline','','','Thành lập Xí nghiệp Dịch vụ Khai thác Dầu khí.','2002',''],
      ['timeline','','','Tiếp nhận và cung cấp dịch vụ O&M cho kho nổi FPSO Ruby Princess từ Modec phục vụ khách hàng Petronas Carigali Vietnam (PCVL).','2002',''],
      ['timeline','','','Thực hiện dự án EPCI cho giàn WHP-A và đường ống dẫn dầu tại mỏ Sư Tử Đen cho khách hàng Cửu Long JOC.','2003',''],
      ['timeline','','','Thực hiện dự án vận chuyển, lắp đặt, đấu nối và chạy thử giàn RBDP-B cho PCVL.','2005',''],
      ['timeline','','','Thực hiện dự án vận chuyển, lắp đặt, đấu nối và chạy thử giàn Bunga Tulip A cho Talisman (Malaysia).','2006',''],
      ['timeline','','','Thực hiện dự án Vận chuyển, lắp đặt tuyến ống dẫn khí PM3-CAMAU cho PetroVietnam.','2006',''],
      ['timeline','','','Thực hiện dự án Vận chuyển và lắp đặt FSO Orkid cho MVOT/Talisman.','2008',''],
      ['timeline','','','Thực hiện hợp đồng cung cấp nhân sự O&M cho FSO Orkid của MVOT/Talisman Malaysia tại Malaysia.','2008',''],
      ['timeline','','','Thực hiện hợp đồng cung cấp nhân sự O&M cho FPSO Thai Binh VN cho Cửu Long JOC.','2008',''],
      ['timeline','','','Thực hiện dự án lắp đặt FPSO Ruby II cho VOFT/PCVL.','2010',''],
      ['timeline','','','Thực hiện hợp đồng cung cấp dịch vụ O&M cho FPSO Ruby II cho VOFT/PCVL.','2010',''],
      ['timeline','','','Thực hiện hợp đồng cung cấp dịch vụ O&M cho FSO PTSC Bach Ho cho Vietsovpetro (VSP).','2010',''],
      ['timeline','','','Thực hiện dự án tháo dỡ FPSO Ruby Princess cho PCVL.','2010',''],
      ['timeline','','','Chuyển đổi thành Công ty Cổ phần.','2011',''],
      ['timeline','','','Thực hiện hợp đồng cung cấp dịch vụ O&M cho FSO PTSC Bien Dong 01 cho PTSC/Bien Dong POC.','2013',''],
      ['timeline','','','Thực hiện dự án tháo dỡ FSO Queensway.','2013',''],
      ['timeline','','','Thực hiện hợp đồng cung cấp dịch vụ O&M cho FPSO PTSC Lam Son cho PTSC/Lam Son JOC.','2014',''],
      ['timeline','','','Thực hiện hợp đồng cung cấp dịch vụ bảo dưỡng & sửa chữa cho hệ thống tra nạp nhiên liệu sân bay Tân Sơn Nhất cho Tapetco.','2017',''],
      ['timeline','','','Thực hiện hợp đồng cung cấp dịch vụ O&M cho FSO Golden Star cho MVOT/Idemitsu Gas Production (Vietnam) Co., Ltd.','2018',''],
      ['timeline','','','Thực hiện hợp đồng cung cấp nhân sự O&M cho Thai Binh Platform cho khách hàng PETRONAS Carigali Overseas Sdn Bhd (PCOSB).','2019',''],
      ['timeline','','','Thực hiện dự án sửa chữa kéo dài tuổi thọ, gia hạn đăng kiểm cho FPSO Ruby II.','2019',''],
      ['timeline','','','Thực hiện dự án kiểm tra, hiện chỉnh, bảo dưỡng và sửa chữa van an toàn, van đường ống cho nhà máy Lọc hóa dầu Nghi Sơn.','2019',''],
      ['timeline','','','Thực hiện dự án bảo dưỡng sửa chữa van tại nhà máy lọc dầu Dung Quất của Công ty Lọc hóa dầu Bình Sơn.','2019',''],
      ['timeline','','','Nhận Chứng nhận Interim Document of Compliance đối với tàu vận chuyển khí Gas (Gas Carrier) theo tiêu chuẩn ISM Code.','2021',''],
      ['timeline','','','Thực hiện Hợp đồng cung cấp dịch vụ Vận hành và bảo dưỡng cho FPSO LEWEK EMAS và BLOCK 12W Offshore Vietnam cho PREMIER OIL VIETNAM.','2022',''],
      ['timeline','','','Triển khai cung cấp dịch vụ vận hành và bảo dưỡng khu vực thượng nguồn Dự án Long Sơn cho khách hàng Repco/LSP','2023',''],
      ['timeline','','','Chính thức tiếp nhận FSO MV12 với vai trò chủ tàu, đổi tên thành FSO PPS 01 và tiếp quản việc vận hành và bảo dưỡng FSO PPS 01 cho khách hàng ZNEP','2024',''],
    ],
    snippet: 'Chính thức tiếp nhận FSO MV12',
  },
  {
    id: 'about_04', slug: 'dinh-huong-phat-trien', title: 'Định hướng phát triển', key: 'about-direction', description: 'GIỚI THIỆU',
    rows: [
      ['prose','','','Công ty Cổ phần Dịch vụ Khai thác Dầu khí PTSC hướng tới mục tiêu trở thành đối tác chiến lược và tin cậy trong lĩnh vực cung cấp dịch vụ O&M cho các kho nổi FPSO / FSO / MOPU tại thị trường Việt Nam và khu vực; dịch vụ vận hành và bảo dưỡng các công trình công nghiệp, dầu khí, hóa dầu trên biển và trên bờ; cung cấp nhân sự vận hành bảo dưỡng và các dịch vụ liên quan như thiết kế, mua sắm, gia công, chế tạo, sửa chữa bảo dưỡng khác.','',''],
    ],
    snippet: 'trở thành đối tác chiến lược và tin cậy',
  },
];

const assert = (condition, message) => { if (!condition) throw Error(message); };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const uri = (path) => wp + path;

async function readTable(id) {
  const response = await page.request.get(uri('/wp-json/tablepress/v1/table/' + id), { timeout: 25000, headers: { 'Cache-Control': 'no-cache' } });
  if (response.status() === 404) return null;
  assert(response.ok(), `Unable to read ESC Table ${id}: HTTP ${response.status()}`);
  return response.json();
}

async function listTablesForRecovery() {
  const collected = [];
  for (let pageNo = 1; pageNo <= 20; pageNo++) {
    const response = await page.request.get(uri(`/wp-json/tablepress/v1/tables/prefix/all?per_page=50&page=${pageNo}`), {
      timeout: 25000,
      headers: { 'Cache-Control': 'no-cache' },
    });
    if (!response.ok()) return collected;
    const rows = await response.json();
    if (!Array.isArray(rows)) return collected;
    collected.push(...rows);
    const totalPages = Number(response.headers()['x-wp-totalpages'] || 1);
    if (pageNo >= totalPages) break;
  }
  return collected;
}

async function renameOpenTable(currentId, spec) {
  const idInput = page.locator('#table-id');
  assert(await idInput.count() === 1, 'Native ESC Table ID field unavailable');
  const beforeId = await idInput.inputValue();
  assert(String(beforeId) === String(currentId), `Unexpected native ESC Table ID: ${beforeId}`);
  let confirmationSeen = false;
  page.once('dialog', async (dialog) => {
    assert(dialog.type() === 'confirm', 'Unexpected dialog while renaming ESC Table');
    confirmationSeen = true;
    await dialog.accept();
  });
  await idInput.fill(spec.id);
  // TablePress 3.x only commits an edited ID from the React field on blur,
  // after the native confirmation dialog is accepted.
  await page.locator('#table-name').click();
  for (let i = 0; i < 10 && !confirmationSeen; i++) await sleep(100);
  assert(confirmationSeen, 'Native ESC Table ID confirmation was not shown');
  assert(await idInput.inputValue() === spec.id, 'Native ESC Table ID did not update after confirmation');
  const save = page.getByRole('button', { name: /^(Save Changes|Lưu thay đổi)$/i });
  assert(await save.count() > 0, 'Native ESC Table Save Changes unavailable');
  await save.last().click();
  for (let i = 0; i < 12; i++) {
    await sleep(700);
    const created = await readTable(spec.id).catch(() => null);
    if (created?.id === spec.id) return created;
  }
  throw Error('Native ESC Table rename did not persist ' + spec.id);
}

async function findRecoverableEmptyTable(spec) {
  const tables = await listTablesForRecovery();
  const candidates = tables.filter((table) => {
    const fields = Array.isArray(table?.fields) ? table.fields : [];
    const items = Array.isArray(table?.items) ? table.items : [];
    const noConfiguredFields = fields.every((field) => !String(field?.key || '').trim());
    return String(table?.id || '') !== spec.id
      && String(table?.name || '').trim() === spec.title
      && String(table?.description || '').trim() === spec.description
      && noConfiguredFields
      && items.length === 0;
  });
  assert(candidates.length <= 1, `Ambiguous recoverable ESC Tables for ${spec.id}: ${candidates.length}`);
  return candidates[0] || null;
}

async function createEmptyTable(spec) {
  const recoverable = await findRecoverableEmptyTable(spec);
  if (recoverable) {
    console.log(`INTRO_TABLE=${spec.id} RECOVER_EXISTING_EMPTY source_id=${recoverable.id}`);
    await page.goto(uri(`/wp-admin/admin.php?page=tablepress&action=edit&table_id=${recoverable.id}`), { waitUntil: 'domcontentloaded', timeout: 45000 });
    return renameOpenTable(recoverable.id, spec);
  }

  await page.goto(uri('/wp-admin/admin.php?page=tablepress&action=add'), { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.locator('input[name="table[name]"]').fill(spec.title);
  await page.locator('textarea[name="table[description]"]').fill(spec.description);
  await page.locator('input[name="table[rows]"]').fill('2');
  await page.locator('input[name="table[columns]"]').fill(String(tableFields.length));
  await page.getByRole('button', { name: /^(Add Table|Thêm bảng)$/i }).click();
  await page.waitForURL(/page=tablepress.*action=edit|action=edit.*page=tablepress/, { timeout: 45000 });
  const currentId = new URL(page.url()).searchParams.get('table_id') || await page.locator('#table-id').inputValue();
  assert(currentId, 'Native ESC Table creation did not expose generated ID');
  return renameOpenTable(currentId, spec);
}

function rowObject(row) {
  return Object.fromEntries(tableFields.map((key, index) => [key, String(row[index] ?? '')]));
}
function desiredItems(spec) { return spec.rows.map(rowObject); }
function assertTableExact(spec, table) {
  const keys = (table?.fields || []).map((field) => String(field?.key || ''));
  assert(table?.id === spec.id, 'ESC Table ID changed: ' + spec.id);
  assert(tableFields.every((key, index) => keys[index] === key), 'ESC Table schema differs: ' + spec.id);
  const items = table?.items || [];
  assert(items.length === spec.rows.length, `ESC Table row count differs ${spec.id}: ${items.length}`);
  const wanted = desiredItems(spec);
  for (let r = 0; r < wanted.length; r++) {
    for (const key of tableFields) {
      assert(String(items[r]?.[key] ?? '') === wanted[r][key], `ESC Table value mismatch ${spec.id} row=${r} key=${key}`);
    }
  }
}

async function ensureTable(spec) {
  let table = await readTable(spec.id);
  if (table?.items?.length) {
    assertTableExact(spec, table);
    console.log(`INTRO_TABLE=${spec.id} ALREADY_COMPLETE items=${table.items.length}`);
    return;
  }
  if (!table) {
    table = await createEmptyTable(spec);
    console.log(`INTRO_TABLE=${spec.id} CREATED_EMPTY`);
  }
  const existingKeys = (table?.fields || []).map((field) => String(field?.key || '').trim()).filter(Boolean);
  assert(existingKeys.length === 0 || tableFields.every((key, i) => existingKeys[i] === key), 'Refusing conflicting existing ESC Table schema ' + spec.id);
  assert(!(table?.items || []).length, 'Refusing to overwrite populated ESC Table ' + spec.id);

  await page.goto(uri(`/wp-admin/admin.php?page=tablepress&action=edit&table_id=${spec.id}`), { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForFunction(() => Boolean(window.tp?.editor?.options?.data && window.tp?.callbacks?.append), null, { timeout: 30000 });
  const grid = await page.evaluate(() => ({ rows: window.tp.editor.options.data.length, cols: window.tp.editor.options.columns.length }));
  assert(grid.cols === tableFields.length, `Unexpected ESC Table column count ${spec.id}: ${grid.cols}`);
  await page.locator('#table-name').fill(spec.title);
  await page.locator('#table-description').fill(spec.description);
  await page.evaluate(({ fields, labels, rows }) => {
    const editor = window.tp.editor;
    const required = rows.length + 2;
    if (editor.options.data.length < required) window.tp.callbacks.append('rows', required - editor.options.data.length);
    if (editor.options.data.length > required) throw Error('Unexpected extra native ESC Table rows; refusing destructive shrink');
    for (let c = 0; c < fields.length; c++) {
      editor.setValueFromCoords(c, 0, fields[c]);
      editor.setValueFromCoords(c, 1, labels[c]);
    }
    for (let r = 0; r < rows.length; r++) {
      for (let c = 0; c < fields.length; c++) editor.setValueFromCoords(c, r + 2, String(rows[r][c] ?? ''));
    }
    window.tp.helpers.unsaved_changes.set();
  }, { fields: tableFields, labels: tableLabels, rows: spec.rows });
  const save = page.getByRole('button', { name: /^(Save Changes|Lưu thay đổi)$/i });
  await save.last().click();
  let saved = null;
  for (let i = 0; i < 12; i++) {
    await sleep(850);
    saved = await readTable(spec.id).catch(() => null);
    if (saved?.items?.length === spec.rows.length) break;
  }
  assert(saved, 'ESC Table read-after-write failed ' + spec.id);
  assertTableExact(spec, saved);
  console.log(`INTRO_TABLE=${spec.id} NATIVE_SAVE_READBACK=PASS items=${saved.items.length}`);
}

async function submitClassicEditorControl(control, label) {
  const navigation = page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 45000 });
  await control.click();
  await navigation;
  assert(/\/wp-admin\/post\.php/.test(page.url()), `${label} did not return to the Classic Editor`);
}

async function setAcf(name, value, { optional = false } = {}) {
  const field = page.locator(`.acf-field[data-name="${name}"]`).first();
  if (await field.count() === 0) {
    if (optional) return;
    throw Error('Missing required ACF field ' + name);
  }
  const select = field.locator('select').first();
  if (await select.count()) { await select.selectOption(String(value)); return; }
  const exact = field.locator(`input[type="radio"][value="${String(value).replaceAll('"', '\\"')}"],input[type="checkbox"][value="${String(value).replaceAll('"', '\\"')}"]`).first();
  if (await exact.count()) { await exact.check(); return; }
  const text = field.locator('input[type="text"],input[type="number"]').first();
  if (await text.count()) { await text.fill(String(value)); return; }
  if (!optional) throw Error('Unsupported ACF field UI ' + name);
}

async function findExistingPage(spec) {
  const published = await page.request.get(uri(`/wp-json/wp/v2/pages?slug=${encodeURIComponent(spec.slug)}&status=publish&per_page=20&_fields=id,slug,title,status`), { timeout: 25000 });
  assert(published.ok(), 'Cannot query published Page ' + spec.slug);
  const rows = await published.json();
  assert(rows.length <= 1, 'Duplicate published Pages for slug ' + spec.slug);
  if (rows[0]?.id) return Number(rows[0].id);

  await page.goto(uri(`/wp-admin/edit.php?post_type=page&post_status=all&s=${encodeURIComponent(spec.title)}`), { waitUntil: 'domcontentloaded', timeout: 45000 });
  const matches = await page.locator('tr').evaluateAll((trs, title) => trs.map((tr) => {
    const link = tr.querySelector('a.row-title');
    return { title: (link?.textContent || '').trim(), href: link?.getAttribute('href') || '' };
  }).filter((row) => row.title === title), spec.title);
  assert(matches.length <= 1, 'Ambiguous draft/private Page title ' + spec.title);
  if (!matches.length) return null;
  const id = /[?&]post=(\d+)/.exec(matches[0].href)?.[1];
  assert(id, 'Cannot parse existing Page ID for ' + spec.title);
  return Number(id);
}

async function setPageSlug(spec) {
  const current = await page.locator('#editable-post-name-full').textContent().catch(() => '');
  if (String(current || '').trim() === spec.slug) return;
  const edit = page.locator('#edit-slug-buttons .edit-slug');
  if (await edit.count() && await edit.isVisible()) {
    await edit.click();
    const field = page.locator('#new-post-slug');
    await field.fill(spec.slug);
    await page.locator('#edit-slug-buttons .save').click();
    await sleep(500);
    return;
  }
  const raw = page.locator('#post_name');
  if (await raw.count()) { await raw.fill(spec.slug); return; }
  throw Error('Cannot set Page slug ' + spec.slug);
}

async function replaceWithNativeShortcode(spec) {
  const visual = page.locator('#content-tmce');
  if (await visual.count()) await visual.click();
  await page.waitForFunction(() => Boolean(window.tinymce?.get('content')?.initialized && !window.tinymce?.get('content')?.isHidden()), null, { timeout: 25000 });
  await page.evaluate(() => {
    const editor = window.tinymce.get('content');
    editor.setContent('');
    editor.focus();
    if (document.querySelector('#TB_window') && window.tb_remove) window.tb_remove();
  });
  await page.evaluate(() => {
    if (typeof window.tablepress_open_shortcode_thickbox !== 'function') throw Error('Native ESC Table Insert Code picker unavailable');
    window.tablepress_open_shortcode_thickbox();
  });
  const picker = page.frameLocator('#TB_iframeContent');
  const choose = picker.locator(`input.insert-shortcode[title*="${spec.id}"],a.insert-shortcode[title*="${spec.id}"]`).first();
  await choose.waitFor({ state: 'visible', timeout: 22000 });
  await choose.click();
  let inserted = false;
  for (let i = 0; i < 10; i++) {
    await sleep(350);
    const value = await page.evaluate(() => window.tinymce?.get('content')?.getContent?.() || document.querySelector('#content')?.value || '');
    if (value.includes(spec.id)) { inserted = true; break; }
  }
  assert(inserted, 'Native ESC Table Insert Code failed ' + spec.id);
  const html = page.locator('#content-html');
  if (await html.count()) await html.click();
  const raw = await page.locator('#content').inputValue();
  assert(raw.includes(`[table id=${spec.id} /]`) || raw.includes(spec.id), 'Page content does not contain native shortcode ' + spec.id);
  console.log(`INTRO_PAGE=${spec.slug} NATIVE_INSERT_CODE=${spec.id} PASS`);
}

async function ensurePage(spec) {
  let pageId = await findExistingPage(spec);
  if (pageId) {
    await page.goto(uri(`/wp-admin/post.php?post=${pageId}&action=edit`), { waitUntil: 'domcontentloaded', timeout: 45000 });
  } else {
    await page.goto(uri('/wp-admin/post-new.php?post_type=page'), { waitUntil: 'domcontentloaded', timeout: 45000 });
  }
  await page.locator('#title').fill(spec.title);
  await setAcf('key', spec.key);
  await setAcf('action', 'IntroPage');
  await setAcf('product_lang', 'vi');
  await setAcf('origin_page_id', '', { optional: true });
  await replaceWithNativeShortcode(spec);

  const wasPublished = await page.locator('#post_status').inputValue().then((v) => v === 'publish').catch(() => false);
  if (!pageId) {
    await page.locator('#save-post').click();
    await page.waitForURL(/post\.php\?post=\d+&action=edit/, { timeout: 45000 });
    pageId = Number(await page.locator('#post_ID').inputValue());
    assert(pageId > 0, 'Cannot identify new Page ID ' + spec.slug);
  } else {
    const control = wasPublished ? page.locator('#publish') : page.locator('#save-post');
    await submitClassicEditorControl(control, `Save existing Page ${spec.slug}`);
  }

  await page.goto(uri(`/wp-admin/post.php?post=${pageId}&action=edit`), { waitUntil: 'domcontentloaded', timeout: 45000 });
  await setPageSlug(spec);
  const publish = page.locator('#publish');
  assert(await publish.count(), 'Publish/Update control unavailable ' + spec.slug);
  await submitClassicEditorControl(publish, `Publish Page ${spec.slug}`);
  await page.goto(uri(`/wp-admin/post.php?post=${pageId}&action=edit`), { waitUntil: 'domcontentloaded', timeout: 45000 });
  const readback = await page.evaluate(() => ({
    status: document.querySelector('#post_status')?.value || '',
    slug: document.querySelector('#editable-post-name-full')?.textContent?.trim() || document.querySelector('#post_name')?.value || '',
    key: document.querySelector('.acf-field[data-name="key"] input')?.value || '',
    action: document.querySelector('.acf-field[data-name="action"] input')?.value || '',
    lang: document.querySelector('.acf-field[data-name="product_lang"] select')?.value || document.querySelector('.acf-field[data-name="product_lang"] input:checked')?.value || '',
    content: document.querySelector('#content')?.value || '',
  }));
  assert(readback.status === 'publish', 'Page not published ' + spec.slug);
  assert(readback.slug === spec.slug, `Page slug mismatch ${spec.slug}: ${readback.slug}`);
  assert(readback.key === spec.key && readback.action === 'IntroPage' && readback.lang === 'vi', 'Page ACF mismatch ' + spec.slug);
  assert(readback.content.includes(spec.id), 'Page native ESC Table shortcode missing after publish ' + spec.slug);
  console.log(`INTRO_PAGE=${spec.slug} PUBLISHED_READBACK=PASS id=${pageId}`);
  return pageId;
}

async function getRestNonce() {
  // WordPress core exposes the REST nonce to authenticated Admin pages.
  // Use that native value instead of the site-specific admin-ajax rest-nonce
  // action, which is not registered on this installation.
  await page.goto(uri('/wp-admin/nav-menus.php'), { waitUntil: 'domcontentloaded', timeout: 45000 });
  const nonce = await page.evaluate(() => {
    const value = globalThis.wpApiSettings?.nonce;
    return typeof value === 'string' ? value.trim() : '';
  });
  assert(/^[A-Za-z0-9_-]{8,32}$/.test(nonce), `WordPress native REST nonce unavailable: length=${nonce.length}`);
  console.log('INTRO_REST_NONCE=PASS source=wpApiSettings');
  return nonce;
}
function menuTitle(item) {
  const value = item?.title;
  return String(typeof value === 'object' ? value.raw || value.rendered || '' : value || '').replace(/<[^>]*>/g, '').trim();
}
async function ensureMenu() {
  const escResponse = await page.request.get(uri(`/wp-json/esc-api/v1/menus?_intro_write=${Date.now()}`), {
    timeout: 25000,
    headers: { 'Cache-Control': 'no-cache' },
  });
  assert(escResponse.ok(), 'ESC menu endpoint unavailable');
  const esc = await escResponse.json();
  const header = esc?.menus?.Header?.vi;
  assert(header?.id && Array.isArray(header.items), 'Header.vi WordPress menu missing');
  const menuId = Number(header.id);
  const desired = [
    ...specs.map((spec) => ({ title: spec.title, url: `/${spec.slug}`, target: '' })),
    { title: 'Company Brochure', url: brochureUrl, target: '_blank' },
  ];

  const currentParents = (header.items || []).filter((item) => item.label === 'Giới thiệu');
  assert(currentParents.length <= 1, 'Duplicate top-level Giới thiệu items; refusing write');
  if (currentParents.length === 1) {
    const intro = currentParents[0];
    const children = Array.isArray(intro.children) ? intro.children : [];
    const exact = desired.every((entry) => children.some((child) =>
      child.label === entry.title
      && String(child.href || '') === entry.url
      && !(child.children || []).length
    ));
    if (exact && children.length === desired.length) {
      console.log('INTRO_MENU=ALREADY_CORRECT_SKIP_WRITE children=' + children.length);
      return;
    }
    throw Error('Existing Giới thiệu menu is partial or differs; refusing duplicate native creation');
  }

  // Use the authenticated WordPress Menu Manager itself. This avoids depending
  // on a custom REST nonce endpoint and preserves native nav-menu save hooks/logs.
  await page.goto(uri(`/wp-admin/nav-menus.php?action=edit&menu=${menuId}`), {
    waitUntil: 'domcontentloaded',
    timeout: 45000,
  });
  assert(new URL(page.url()).origin === wp, 'Native Menu Manager escaped configured WordPress origin');
  const menuForm = page.locator('#update-nav-menu');
  assert(await menuForm.count() === 1, 'Native WordPress menu form unavailable');

  const urlInput = page.locator('#custom-menu-item-url');
  const nameInput = page.locator('#custom-menu-item-name');
  const addButton = page.locator('#submit-customlinkdiv');
  assert(await urlInput.count() === 1 && await nameInput.count() === 1 && await addButton.count() === 1,
    'Native Custom Links controls unavailable');

  // WordPress persists each administrator's postbox collapsed state. Open the
  // native Custom Links box when needed instead of assuming it is expanded.
  if (!(await urlInput.isVisible())) {
    const customLinksBox = page.locator('#add-custom-links');
    assert(await customLinksBox.count() === 1, 'Native Custom Links postbox unavailable');
    const toggle = customLinksBox.locator('.postbox-header .hndle, .handlediv').first();
    if (await toggle.count() > 0 && await toggle.isVisible().catch(() => false)) {
      await toggle.click();
    } else {
      // Lightweight wp-admin profiles can keep the native postbox content but
      // omit the normal toggle chrome. Reveal that existing content only.
      const revealed = await page.evaluate(() => {
        const box = document.querySelector('#add-custom-links');
        const inside = box?.querySelector('.inside');
        if (!box || !inside) return false;
        box.classList.remove('closed', 'hide-if-js');
        inside.removeAttribute('hidden');
        inside.style.display = 'block';
        return true;
      });
      assert(revealed, 'Native Custom Links postbox content unavailable');
    }
    await urlInput.waitFor({ state: 'visible', timeout: 8000 });
    console.log('INTRO_MENU_CUSTOM_LINKS_BOX=OPENED');
  }

  async function nativeItems() {
    return page.evaluate(() => Array.from(document.querySelectorAll('#menu-to-edit > li.menu-item')).map((li) => ({
      id: Number(String(li.id || '').replace(/^menu-item-/, '')),
      title: String(li.querySelector('.edit-menu-item-title')?.value || '').trim(),
      url: String(li.querySelector('.edit-menu-item-url')?.value || '').trim(),
      parent: Number(li.querySelector('.menu-item-data-parent-id')?.value || 0),
    })));
  }

  async function addCustomLink(title, url) {
    const before = await nativeItems();
    assert(!before.some((item) => item.title === title), 'Native menu already contains unexpected duplicate title ' + title);
    await urlInput.fill(url);
    await nameInput.fill(title);
    await addButton.click();
    for (let attempt = 0; attempt < 20; attempt++) {
      await sleep(250);
      const items = await nativeItems();
      const matches = items.filter((item) => item.title === title);
      if (matches.length === 1 && items.length === before.length + 1) {
        console.log(`INTRO_MENU_NATIVE_ADD=${title} id=${matches[0].id}`);
        return matches[0].id;
      }
    }
    throw Error('Native WordPress Add to Menu did not create ' + title);
  }

  const parentId = await addCustomLink('Giới thiệu', '#');
  const created = [];
  for (const child of desired) {
    const id = await addCustomLink(child.title, child.url);
    created.push({ ...child, id });
  }

  const parentApplied = await page.evaluate(({ parentId, children }) => {
    const root = document.querySelector('#menu-to-edit');
    if (!root) return { ok: false, reason: 'menu-root-missing' };
    for (const child of children) {
      const li = document.querySelector(`#menu-item-${child.id}`);
      const parent = li?.querySelector('.menu-item-data-parent-id');
      if (!li || !parent) return { ok: false, reason: 'menu-item-missing', child };
      parent.value = String(parentId);
      li.className = String(li.className || '').replace(/menu-item-depth-\\d+/g, 'menu-item-depth-1');
      const target = li.querySelector('.edit-menu-item-target');
      if (target && child.target === '_blank') target.checked = true;
    }
    return { ok: true };
  }, { parentId, children: created });
  assert(parentApplied?.ok, 'Unable to assign native submenu hierarchy: ' + JSON.stringify(parentApplied));

  const save = page.locator('#save_menu_header');
  const saveFallback = page.locator('#save_menu_footer');
  const saveControl = await save.count() ? save : saveFallback;
  assert(await saveControl.count() > 0, 'Native Save Menu control unavailable');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 45000 }),
    saveControl.click(),
  ]);
  console.log('INTRO_MENU_NATIVE_SAVE=PASS');

  let verified = null;
  for (let i = 0; i < 12; i++) {
    await sleep(900);
    const response = await page.request.get(uri(`/wp-json/esc-api/v1/menus?_intro_verify=${Date.now()}`), {
      headers: { 'Cache-Control': 'no-cache' },
      timeout: 25000,
    });
    if (!response.ok()) continue;
    const current = (await response.json())?.menus?.Header?.vi;
    const intro = current?.items?.find((item) => item.label === 'Giới thiệu');
    const children = intro?.children || [];
    const exact = desired.every((entry) => children.some((child) =>
      child.label === entry.title
      && String(child.href || '') === entry.url
      && !(child.children || []).length
    ));
    if (exact && children.length === desired.length) {
      verified = { current, intro };
      break;
    }
  }
  assert(verified, 'Header.vi did not expose the requested 2-level Giới thiệu menu after native save');
  const brochure = verified.intro.children.find((child) => child.label === 'Company Brochure');
  assert(String(brochure?.href || '') === brochureUrl, 'Company Brochure URL changed');
  console.log('INTRO_MENU=PASS_TWO_LEVEL children=' + verified.intro.children.length);
}
async function triggerNativeWordPressBuild() {
  await page.goto(uri('/wp-admin/admin.php?page=vcs-build-trigger'), { waitUntil: 'domcontentloaded', timeout: 45000 });
  assert(new URL(page.url()).origin === wp, 'Build dashboard redirected outside WordPress');
  const heading = page.locator('.wrap h1').filter({ hasText: /Build Website/i });
  const button = page.locator('#vcs-build-btn-main');
  assert(await heading.count() > 0 && await button.count() > 0, 'WordPress Build Website tool unavailable');
  assert(!(await button.isDisabled()), 'WordPress Build Website button is disabled before request');
  const triggerResponse = page.waitForResponse((response) => {
    try {
      const url = new URL(response.url());
      if (url.origin !== wp || !url.pathname.endsWith('/wp-admin/admin-ajax.php')) return false;
      const form = new URLSearchParams(response.request().postData() || '');
      const action = String(form.get('action') || '');
      return action.startsWith('vcs_') && action !== 'vcs_check_build_status';
    } catch { return false; }
  }, { timeout: 15000 }).catch(() => null);
  await button.click();
  const response = await triggerResponse;
  await sleep(1800);
  const disabledAfter = await button.isDisabled().catch(() => false);
  if (response) {
    assert(response.ok(), `WordPress Build Website trigger returned HTTP ${response.status()}`);
    const payload = await response.json().catch(() => null);
    if (payload && payload.success === false) throw Error('WordPress Build Website trigger rejected request');
  } else {
    assert(disabledAfter, 'No build-trigger network acknowledgement and button remained enabled');
  }
  console.log('INTRO_BUILD_TRIGGER=PASS source=WordPress_Build_Website');
}

async function waitForProduction() {
  const probe = specs[0];
  for (let attempt = 1; attempt <= 36; attempt++) {
    try {
      const response = await context.request.get(`${front}/${probe.slug}?_intro_qa=${Date.now()}`, { timeout: 25000, headers: { 'Cache-Control': 'no-cache' } });
      const text = response.ok() ? await response.text() : '';
      if (response.status() === 200 && text.includes(probe.title) && text.includes(probe.snippet)) {
        console.log(`INTRO_BUILD_DEPLOYED=PASS attempt=${attempt}`);
        return;
      }
      console.log(`INTRO_BUILD_WAIT attempt=${attempt} status=${response.status()}`);
    } catch (error) {
      console.log(`INTRO_BUILD_WAIT attempt=${attempt} transient=${error?.name || 'error'}`);
    }
    await sleep(15000);
  }
  throw Error('Production introduction page did not appear after WordPress build trigger');
}

async function productionQA() {
  const dir = 'artifacts/ptscps-intro-pages';
  await fs.mkdir(dir, { recursive: true });
  const desktop = await context.newPage();
  await desktop.setViewportSize({ width: 1440, height: 1000 });
  for (const spec of specs) {
    const response = await desktop.goto(`${front}/${spec.slug}`, { waitUntil: 'load', timeout: 50000 });
    assert(response?.status() === 200, `Production route HTTP ${response?.status()} ${spec.slug}`);
    const h1 = desktop.locator('main h1');
    await h1.waitFor({ state: 'visible', timeout: 12000 });
    assert((await h1.innerText()).trim() === spec.title, `Production h1 mismatch ${spec.slug}`);
    const mainText = await desktop.locator('main').innerText();
    assert(mainText.includes(spec.snippet), `Production content snippet missing ${spec.slug}`);
    assert(await desktop.locator('main aside').count() === 0, `Side menu/aside leaked into ${spec.slug}`);
    await desktop.screenshot({ path: `${dir}/desktop-${spec.slug}.png`, fullPage: true });
    console.log(`INTRO_DESKTOP_QA=${spec.slug} PASS`);
  }

  await desktop.goto(`${front}/${specs[0].slug}`, { waitUntil: 'load', timeout: 50000 });
  const introButton = desktop.locator('#desktop-menu button').filter({ hasText: /^Giới thiệu$/ }).first();
  await introButton.waitFor({ state: 'visible', timeout: 12000 });
  await introButton.click();
  const panelId = await introButton.getAttribute('aria-controls');
  assert(panelId, 'Desktop Giới thiệu menu has no submenu panel');
  const panel = desktop.locator('#' + panelId);
  await panel.waitFor({ state: 'visible', timeout: 8000 });
  for (const spec of specs) assert(await panel.getByRole('link', { name: spec.title, exact: true }).count() === 1, 'Desktop submenu missing ' + spec.title);
  const brochure = panel.getByRole('link', { name: 'Company Brochure', exact: true });
  assert(await brochure.count() === 1, 'Desktop submenu missing Company Brochure');
  assert(await brochure.getAttribute('href') === brochureUrl, 'Desktop brochure href changed');
  console.log('INTRO_DESKTOP_MENU_QA=PASS');
  await desktop.close();

  const mobile = await context.newPage({ viewport: { width: 390, height: 844 } });
  for (const spec of [specs[0], specs[2], specs[3]]) {
    const response = await mobile.goto(`${front}/${spec.slug}`, { waitUntil: 'load', timeout: 50000 });
    assert(response?.status() === 200, `Mobile route HTTP ${response?.status()} ${spec.slug}`);
    assert(await mobile.locator('main aside').count() === 0, `Mobile side menu/aside leaked into ${spec.slug}`);
    await mobile.screenshot({ path: `${dir}/mobile-${spec.slug}.png`, fullPage: true });
    console.log(`INTRO_MOBILE_QA=${spec.slug} PASS`);
  }
  await mobile.goto(`${front}/${specs[0].slug}`, { waitUntil: 'load', timeout: 50000 });
  const hamburger = mobile.locator('#hamburger-btn');
  await hamburger.waitFor({ state: 'visible', timeout: 12000 });
  await hamburger.click();
  const mobileMenu = mobile.locator('#mobile-menu-container');
  await mobileMenu.waitFor({ state: 'visible', timeout: 8000 });
  const mobileIntro = mobileMenu.locator('button').filter({ hasText: /^Giới thiệu$/ }).first();
  await mobileIntro.click();
  const mobilePanelId = await mobileIntro.getAttribute('aria-controls');
  assert(mobilePanelId, 'Mobile Giới thiệu menu has no branch panel');
  const mobilePanel = mobile.locator('#' + mobilePanelId);
  await mobilePanel.waitFor({ state: 'visible', timeout: 8000 });
  for (const spec of specs) assert(await mobilePanel.getByRole('link', { name: spec.title, exact: true }).count() === 1, 'Mobile submenu missing ' + spec.title);
  assert(await mobilePanel.getByRole('link', { name: 'Company Brochure', exact: true }).count() === 1, 'Mobile submenu missing Company Brochure');
  console.log('INTRO_MOBILE_MENU_QA=PASS');
  await mobile.close();
}

async function verifyCompletedCmsCheckpoint() {
  for (const spec of specs) {
    const table = await readTable(spec.id);
    assert(table, 'Completed ESC Table checkpoint missing ' + spec.id);
    assertTableExact(spec, table);
  }

  const response = await page.request.get(uri('/wp-json/wp/v2/pages?status=publish&per_page=100&_fields=id,slug,acf,content'), {
    timeout: 25000,
    headers: { 'Cache-Control': 'no-cache' },
  });
  assert(response.ok(), `Cannot verify completed Page checkpoint: HTTP ${response.status()}`);
  const pages = await response.json();
  const ids = [];
  for (const spec of specs) {
    const matches = pages.filter((item) => String(item?.slug || '') === spec.slug);
    assert(matches.length === 1, `Completed Page checkpoint mismatch ${spec.slug}: count=${matches.length}`);
    const item = matches[0];
    const lang = item?.acf?.product_lang?.value || item?.acf?.product_lang || '';
    const rendered = String(item?.content?.rendered || '');
    assert(item?.acf?.key === spec.key, 'Completed Page key mismatch ' + spec.slug);
    assert(item?.acf?.action === 'IntroPage', 'Completed Page action mismatch ' + spec.slug);
    assert(lang === 'vi', 'Completed Page language mismatch ' + spec.slug);
    assert(rendered.includes(spec.id), 'Completed Page shortcode checkpoint missing ' + spec.id);
    ids.push(Number(item.id));
  }
  assert(new Set(ids).size === specs.length, 'Completed introduction Page IDs are not unique');
  console.log('INTRO_CMS_CHECKPOINT=PASS_SKIP_WRITES tables=5 pages=5');
}

try {
  await page.goto(uri('/wp-login.php'), { waitUntil: 'domcontentloaded', timeout: 50000 });
  await page.locator('#user_login').fill(username);
  await page.locator('#user_pass').fill(password);
  await Promise.all([page.waitForURL(/\/wp-admin\//, { timeout: 50000 }), page.locator('#wp-submit').click()]);
  assert(new URL(page.url()).origin === wp, 'WordPress authentication escaped configured origin');
  console.log('INTRO_SETUP_ADMIN_AUTH=PASS');

  // Runs through 41696055202 already completed and read back all five tables
  // and all five published Pages. Verify that durable checkpoint and continue
  // at the first unfinished stage instead of replaying successful CMS writes.
  await verifyCompletedCmsCheckpoint();
  await ensureMenu();
  console.log('INTRO_CMS_SETUP=PASS pages=5 tables=5 menu=two-level brochure=external');

  await triggerNativeWordPressBuild();
  await waitForProduction();
  await productionQA();
  console.log('INTRO_PRODUCTION_QA=PASS desktop=5 mobile=3 side_menu=absent');
} finally {
  await browser.close();
}
