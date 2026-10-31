/** Static-only PTSCPS source audit: no Astro build, WordPress access, FTP or deploy. */
import { transform } from '@astrojs/compiler';
import ts from 'typescript';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const projectRoot = path.resolve(process.argv[2] || './source');
const root = path.join(projectRoot, 'src');
const packageJson = JSON.parse(await readFile(path.join(projectRoot, 'package.json'), 'utf8'));
const dependencies = new Set(Object.keys({ ...packageJson.dependencies, ...packageJson.devDependencies, ...packageJson.optionalDependencies }));
const all = [];
async function visit(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await visit(full);
    else if (entry.isFile()) all.push(full);
  }
}
await visit(root);
const ext = p => path.extname(p);
const files = all.filter(p => ['.astro', '.ts', '.tsx', '.js', '.jsx', '.css', '.json'].includes(ext(p)));
const allPaths = new Set(all.map(p => path.normalize(p)));
const diagnostics = [];
const missing = [];
const importsFound = [];
const counters = { astro: 0, ts: 0, tsx: 0, json: 0, css: 0, imports: 0 };
const candidates = p => [p, ...['.ts','.tsx','.js','.mjs','.json','.astro','.css','.scss'].map(ext=>p+ext), ...['/index.ts','/index.tsx','/index.js','/index.astro','/index.json'].map(s=>p+s)];
const isLocal = s => s.startsWith('@/') || s.startsWith('./') || s.startsWith('../');
const resolveLocal = (s, filepath) => path.normalize(s.startsWith('@/') ? path.join(root, s.slice(2)) : path.resolve(path.dirname(filepath), s));
function error(source, message) { diagnostics.push({ file: path.relative(projectRoot, source), message: String(message).slice(0, 450) }); }
for (const file of files) {
  const source = await readFile(file, 'utf8');
  const e = ext(file);
  if (e === '.astro') {
    counters.astro++;
    try { await transform(source, { filename: file }); }
    catch (err) { error(file, `Astro compiler: ${err?.message ?? err}`); }
  } else if (e === '.ts' || e === '.tsx' || e === '.js' || e === '.jsx') {
    counters[e.substring(1)] = (counters[e.substring(1)] ?? 0) + 1;
    const kind = e === '.tsx' || e === '.jsx' ? ts.ScriptKind.TSX : e === '.ts' ? ts.ScriptKind.TS : ts.ScriptKind.JS;
    const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind);
    for (const diag of parsed.parseDiagnostics) {
      const pos = parsed.getLineAndCharacterOfPosition(diag.start ?? 0);
      error(file, `TypeScript syntax ${pos.line+1}:${pos.character+1} ${ts.flattenDiagnosticMessageText(diag.messageText, ' ')}`);
    }
  } else if (e === '.json') {
    counters.json++;
    try { JSON.parse(source); } catch (err) { error(file, `JSON: ${err.message}`); }
  } else if (e === '.css') counters.css++;

  const importExpr = /(?:\bfrom\s*|\bimport\s*\(|\bimport\s*|@import\s*)['"`]([^'"`]+)['"`]/g;
  for (const match of source.matchAll(importExpr)) {
    const specifier = match[1].split('?')[0];
    counters.imports++;
    if (isLocal(specifier)) {
      const absolute = resolveLocal(specifier, file);
      if (!candidates(absolute).some(p => allPaths.has(path.normalize(p)))) missing.push({ file: path.relative(projectRoot,file), import:specifier, kind:e === '.astro'?'astro':'other' });
      importsFound.push({ file: path.relative(projectRoot,file), import:specifier });
    } else if (!specifier.startsWith('node:') && !specifier.startsWith('astro:') && !specifier.startsWith('virtual:') && !specifier.startsWith('\0') && !specifier.startsWith('http')) {
      const pkg = specifier.startsWith('@') ? specifier.split('/').slice(0,2).join('/') : specifier.split('/')[0];
      if (!dependencies.has(pkg) && pkg !== 'astro') {
        // Report, do not fail: native integrations and Astro virtual imports can be registered at runtime.
        importsFound.push({ file: path.relative(projectRoot,file), external:pkg, unlisted:true });
      }
    }
  }
}
// Astro glob registry eagerly loads all TablePress .astro files. Always check every table template.
const failedAstroImports = missing.filter(x=>x.kind==='astro');
const dormantImportWarnings = missing.filter(x=>x.kind!=='astro');
const unlisted = importsFound.filter(x=>x.unlisted);
console.log('SOURCE_AUDIT_COUNTS='+JSON.stringify({files:files.length, ...counters, missingAstroImports: failedAstroImports.length, inactiveImportWarnings:dormantImportWarnings.length, unlistedPackageWarnings:unlisted.length}));
for (const item of dormantImportWarnings) console.log('INACTIVE_IMPORT_WARNING='+JSON.stringify(item));
for (const item of unlisted) console.log('EXTERNAL_PACKAGE_WARNING='+JSON.stringify(item));
for (const item of failedAstroImports) console.error('MISSING_ASTRO_IMPORT='+JSON.stringify(item));
for (const item of diagnostics) console.error('SYNTAX_ERROR='+JSON.stringify(item));
if (failedAstroImports.length || diagnostics.length) process.exitCode = 1;
else console.log('SOURCE_AUDIT=PASS (static compiler and direct Astro imports; no deploy)');
