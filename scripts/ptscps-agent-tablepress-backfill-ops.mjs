import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

// Verified production WordPress only. Never print passwords, cookies, CMS bodies,
// preflight source hashes, or full WP responses to the public Actions logs.
const env = process.env.ENV_FILE || '';
const site = env.split(/\r?\n/).filter(line => /^\s*WC_URL\s*=/.test(line));
if (site.length !== 1) throw new Error('Expected exactly one WordPress WC_URL');
const raw = site[0].split('=').slice(1).join('=').trim().replace(/^(?:"(.*)"|'(.*)')$/, (_, a, b) => a ?? b);
const origin = new URL(raw);
if (origin.protocol !== 'https:' || origin.hostname !== 'admin-ptscps.thegioihosting.io.vn'
    || !['/', ''].includes(origin.pathname) || origin.search || origin.hash || origin.port
    || origin.username || origin.password) throw new Error('Wrong WordPress site');
if (!process.env.WP_ADMIN_USERNAME || !process.env.WP_ADMIN_PASSWORD) throw new Error('No WP Admin credentials');
const phase = process.argv[2];
if (!['preview', 'apply'].includes(phase)) throw new Error('Mode must be preview or apply');
const pinnedSource = '3144e27804baa79f00b94fd64342a8b75a39a3b5';
const pinnedRelease = '41380573605';
const tableIds = [
  'home_00', 'home_01', 'home_02', 'home_03', 'home_04', 'home_05', 'home_14', 'home_15',
  'home_00_en', 'home_01_en', 'home_02_en', 'home_03_en', 'home_04_en', 'home_05_en', 'home_14_en', 'home_15_en',
];
const ref = process.env.GITHUB_SHA || '';

const browser = await chromium.launch({headless:true});
try {
  const page = await browser.newPage();
  await page.goto(`${origin.origin}/wp-login.php`, {waitUntil:'domcontentloaded', timeout:45000});
  await page.locator('#user_login').fill(process.env.WP_ADMIN_USERNAME);
  await page.locator('#user_pass').fill(process.env.WP_ADMIN_PASSWORD);
  await Promise.all([
    page.waitForURL(u => u.origin === origin.origin && u.pathname.startsWith('/wp-admin/'), {timeout:45000}),
    page.locator('#wp-submit').click(),
  ]);
  const agentPage = `${origin.origin}/wp-admin/tools.php?page=ptscps-agent-tablepress-backfill`;
  await page.goto(agentPage, {waitUntil:'domcontentloaded',timeout:45000});
  const form = page.locator('form:has(input[name="action"][value="ptscps_agent_tablepress_preview"])');
  await form.waitFor({state:'visible',timeout:15000});
  const nonce = await form.locator('input[name="_wpnonce"]').inputValue();
  if (!nonce) throw new Error('No authenticated recovery nonce');
  const post = async (action, extra={}) => {
    const response = await page.context().request.post(`${origin.origin}/wp-admin/admin-post.php`, {
      form:{action:`ptscps_agent_tablepress_${action}`, _wpnonce:nonce, ...extra}, timeout:125000,
    });
    let data;
    try { data = await response.json(); } catch { throw new Error(`${action} returned invalid JSON (HTTP ${response.status()})`); }
    if (!response.ok()) throw new Error(`${action} denied by WordPress (HTTP ${response.status()}, reason=${String(data?.reason ?? 'unknown').slice(0,120)})`);
    return data;
  };
  const preflight = await post('preview');
  if (preflight?.mode !== 'read_only' || preflight.source_count !== 16 ||
      !/^[0-9a-f]{64}$/.test(String(preflight.fingerprint ?? '')) ||
      !Array.isArray(preflight.sources) || preflight.sources.length !== 16 ||
      preflight.expected_chunks < 82) throw new Error('Preflight unexpected coverage');
  const names = preflight.sources.map(s=>s.table_id);
  if (JSON.stringify(names) !== JSON.stringify(tableIds) ||
      preflight.sources.filter(s=>s.language === 'vi').length !== 8 ||
      preflight.sources.filter(s=>s.language === 'en').length !== 8) {
    throw new Error('Preflight source locale or ID mismatch');
  }
  const safePreview = {
    report_version:1,mode:'preflight',source_sha:pinnedSource,release_run:pinnedRelease,
    action_sha:ref,source_count:16,expected_chunks:preflight.expected_chunks,
    fingerprint:preflight.fingerprint,
    tables:preflight.sources.map(({id,table_id,language,expected_chunks,source_hash})=>({id,table_id,language,expected_chunks,source_hash})),
  };
  await mkdir('audit',{recursive:true});
  await writeFile('audit/ptscps-agent-tablepress-backfill-preflight.json',JSON.stringify(safePreview,null,2)+'\n',{mode:0o600});
  console.log(`PTSCPS_TABLEPRESS_BACKFILL_PREFLIGHT=PASS sources=16 chunks_expected=${preflight.expected_chunks} vi=8 en=8 mode=${phase}`);
  if (phase === 'preview') process.exitCode = 0;
  if (phase === 'apply') {
    const marker = (await readFile('audit/ptscps-agent-tablepress-backfill-apply.ready','utf8')).trim();
    const expectedMarker = `PTSCPS_TABLEPRESS_BACKFILL_APPLY fingerprint=${preflight.fingerprint} source=${pinnedSource} release_run=${pinnedRelease}`;
    if (marker !== expectedMarker) throw new Error('Unapproved or stale apply fingerprint; no writes performed');
    // Must already exist: a *separate successful* artifact-upload step precedes this script.
    const audit = await readFile('audit/ptscps-agent-tablepress-backfill-preflight.json','utf8');
    const saved = JSON.parse(audit);
    if (saved.fingerprint !== preflight.fingerprint) throw new Error('Preflight artifact mismatch');
    let applied = false;
    try {
      const result = await post('apply', {fingerprint:preflight.fingerprint});
      applied = result.status === 'applied';
      if (!applied || result.sources !== 16 || result.missing_index !== 0 || !result.rollback_available) {
        throw new Error('Unexpected apply acknowledgement');
      }
      await page.goto(`${origin.origin}/wp-admin/tools.php?page=esc-agent-knowledge-index`,{waitUntil:'domcontentloaded',timeout:45000});
      const censusForm = page.locator('form:has(input[name="action"][value="esc_agent_export_knowledge_inventory"])');
      await censusForm.waitFor({state:'visible',timeout:15000});
      const inventoryNonce = await censusForm.locator('input[name="_wpnonce"]').inputValue();
      const invResp = await page.context().request.post(`${origin.origin}/wp-admin/admin-post.php`,{
        form:{action:'esc_agent_export_knowledge_inventory',_wpnonce:inventoryNonce},timeout:120000,
      });
      if (!invResp.ok()) throw new Error('Post-backfill inventory export failed');
      const after = await invResp.json();
      if (after.mode !== 'read_only' || after.counts?.eligible !== 18 || after.counts?.indexed !== 18
          || after.counts?.missing_index !== 0 || after.counts?.vi !== 9 || after.counts?.en !== 9
          || after.counts?.orphan_index !== 719) throw new Error('Post-backfill census mismatch');
      const tableEntries = after.sources.filter(x=>x.type === 'tablepress' && x.status === 'publish');
      if (tableEntries.length !== 16 || tableEntries.some(x=>x.indexed_chunks < 1)) throw new Error('Missing TablePress index chunks after apply');
      const receipt = {status:'PASS',source_sha:pinnedSource,verified_source_count:16,
        indexed_chunks:tableEntries.reduce((sum,x)=>sum+x.indexed_chunks,0),
        missing_index:after.counts.missing_index,orphan_index:after.counts.orphan_index,
        indexed_total:after.counts.indexed,eligible_total:after.counts.eligible,
      };
      await writeFile('audit/ptscps-agent-tablepress-backfill-result.json',JSON.stringify(receipt,null,2)+'\n',{mode:0o600});
      console.log(`PTSCPS_TABLEPRESS_BACKFILL_PRODUCTION=PASS tables=16 chunks=${receipt.indexed_chunks} indexed=${receipt.indexed_total}/${receipt.eligible_total} orphan_groups_untouched=${receipt.orphan_index}`);
    } catch (error) {
      // If apply was attempted, rollback is an explicitly provided guarded
      // admin action and refuses to remove rows modified since the snapshot.
      let rollback = 'not_attempted';
      try {
        const answer = await post('rollback');
        rollback = answer.status === 'rolled_back' ? 'PASS' : 'INCOMPLETE';
      } catch { rollback = 'BLOCKED_MANUAL_REVIEW'; }
      console.log(`PTSCPS_TABLEPRESS_BACKFILL_RECOVERY rollback=${rollback}`);
      throw error;
    }
  }
} finally {
  await browser.close();
}
