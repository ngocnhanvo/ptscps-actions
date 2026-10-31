# PTSCPS implementation checkpoint

Updated: 2026-10-31
Code mode: `auto-build`

## Current priority

Restore the WordPress-controlled Astro production deployment before continuing content migration or homepage implementation.

## Verified state

- Production workflow: `.github/workflows/ptscps-production-deploy.yml`.
- Astro source: `ngocnhanvo/ptscps-astro@master`.
- WordPress/PHP: `ngocnhanvo/ptscps-php@master`.
- Actions: `ngocnhanvo/ptscps-actions@main`.
- Production deploy run `41189859780` built Astro, packaged it, uploaded it by FTPS and completed signed activation successfully.
- The same run failed only at the final public-homepage smoke check: frontend `/` returned an HTTP error instead of HTML 200.
- Read-only HTTP diagnosis run `41190288005` confirmed `/` = 403, `/index.html` = 404, while `/client/index.html` = 200 with title `Trang chủ`; WordPress `/wp-json/` = 200.
- Read-only FTPS diagnosis run `41190602826` confirmed frontend docroot has `client/index.html`, `server/entry.mjs` and `pm2-reload.txt`, but no root `.htaccess`, root `index.html`, `ecosystem.config.cjs` or `.env`.
- Therefore the Astro build itself is not failing. The active blocker is the missing frontend web-server/Node routing layer after a successful signed deployment.

## Do not repeat

- Do not rerun the content inventory/migration dry-run that already passed.
- Do not rebuild Astro merely to reproduce the same 403 until routing/runtime is corrected.
- Do not flatten `client/` into the document root or bypass the public smoke check just to make Actions green; the project contains `prerender = false` API/SSR routes and requires the Node standalone runtime contract.
- Do not direct-dispatch the production deploy workflow; production build remains WordPress **Build Website** controlled.

## Next action

1. Verify the PTSCPS frontend hosting runtime/proxy contract for `server/entry.mjs` without changing Astro build/cache architecture.
2. Restore the minimal missing routing/bootstrap layer using a reversible change.
3. Verify `/`, a representative static asset, one SSR route and one API route.
4. Trigger a fresh production build only through WordPress **Build Website** after routing is fixed.
5. Record the resulting Actions run ID and source SHA here, then resume the migration/homepage work from the previous checkpoint.
