import { mkdir, writeFile } from 'node:fs/promises';

// No authentication, modifications or content-body output. Only aggregate facts
// from the same public WordPress TablePress endpoint used by Astro are retained.
const envFile = process.env.ENV_FILE || '';
const matching = envFile.split(/\r?\n/).filter(s => /^\s*WC_URL\s*=/.test(s));
if (matching.length !== 1) throw new Error('Expected exactly one WC_URL in ENV_FILE');
const raw = matching[0].split('=').slice(1).join('=').trim().replace(/^(?:"(.*)"|'(.*)')$/, (_, a, b) => a ?? b);
const origin = new URL(raw);
if (origin.protocol !== 'https:' || origin.hostname !== 'admin-ptscps.thegioihosting.io.vn'
    || (origin.pathname !== '/' && origin.pathname !== '') || origin.search || origin.hash
    || origin.username || origin.password || origin.port) {
  throw new Error('Refusing non-PTSCPS WordPress production HTTPS origin');
}

// Pinned to the authenticated inventory emitted in Actions run #41341229462.
const ids = [
  'home_00', 'home_01', 'home_02', 'home_03', 'home_04', 'home_05', 'home_14', 'home_15',
  'home_00_en', 'home_01_en', 'home_02_en', 'home_03_en', 'home_04_en', 'home_05_en', 'home_14_en', 'home_15_en',
];
const cleanText = value => String(value ?? '')
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]*>/g, ' ')
  .replace(/&(?:nbsp|amp|lt|gt|quot|#\d+);/gi, ' ')
  .replace(/\s+/g, ' ').trim();
const rows = [];
for (const id of ids) {
  const url = `${origin.origin}/wp-json/tablepress/v1/table/${encodeURIComponent(id)}`;
  const response = await fetch(url, {
    redirect: 'manual',
    signal: AbortSignal.timeout(25_000),
    headers: { 'Accept': 'application/json' },
  });
  if (response.status !== 200) throw new Error(`TablePress ${id}: HTTP ${response.status}`);
  const table = await response.json();
  if (table?.success !== true || table.id !== id || !Array.isArray(table.fields) || !Array.isArray(table.items))
    throw new Error(`Unexpected TablePress JSON schema for ${id}`);
  let nonemptyTextCells = 0, nonemptyTextRows = 0, imageCells = 0, visibleChars = 0;
  for (const item of table.items) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(`Invalid row in ${id}`);
    let hasText = false;
    for (const value of Object.values(item)) {
      if (typeof value !== 'string' && typeof value !== 'number' && value !== null) continue;
      const content = String(value ?? '');
      if (/<img\b/i.test(content)) imageCells++;
      const plain = cleanText(content);
      if (!plain) continue;
      hasText = true;
      nonemptyTextCells++;
      visibleChars += [...plain].length;
    }
    if (hasText) nonemptyTextRows++;
  }
  const api = String(table.meta?.api ?? '').trim();
  const dynamicSource = api === 'Product' || api === 'Page' || api === 'ProductCategory'
    ? api : api ? 'other' : 'none';
  rows.push({ table_id: id, locale: id.endsWith('_en') ? 'en' : 'vi',
    item_count: table.items.length, field_count: table.fields.length,
    nonempty_text_rows: nonemptyTextRows, nonempty_text_cells: nonemptyTextCells,
    image_cells: imageCells, visible_character_count: visibleChars, dynamic_source: dynamicSource,
  });
  console.log(`PTSCPS_TABLEPRESS_AUDIT table=${id} items=${table.items.length} text_rows=${nonemptyTextRows} image_cells=${imageCells} dynamic_source=${dynamicSource}`);
}
const summary = {
  tables: rows.length,
  with_text: rows.filter(row => row.nonempty_text_rows > 0).length,
  visual_or_empty: rows.filter(row => row.nonempty_text_rows === 0).length,
  dynamic: rows.filter(row => row.dynamic_source !== 'none').length,
  text_rows: rows.reduce((sum, row) => sum + row.nonempty_text_rows, 0),
};
await mkdir('audit', { recursive: true });
await writeFile('audit/ptscps-agent-tablepress-semantic.json', JSON.stringify({ mode: 'read_only',
  inventory_run_id: 41341229462, source_sha: 'a4b517de654ed5a781874e032934527b4ef62087',
  summary, tables: rows }, null, 2) + '\n', { mode: 0o600 });
console.log(`PTSCPS_TABLEPRESS_SEMANTIC_AUDIT=PASS tables=${summary.tables} with_text=${summary.with_text} visual_or_empty=${summary.visual_or_empty} dynamic=${summary.dynamic} text_rows=${summary.text_rows}`);
