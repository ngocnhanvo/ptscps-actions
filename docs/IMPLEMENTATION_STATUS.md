# PTSCPS implementation checkpoint

Updated: 2026-10-31
Code mode: `auto-build`

## Current priority

Keep WordPress-controlled Astro production deployment usable for SSG/static output while the frontend Node SSR runtime remains unavailable. Public SSR runtime verification is non-blocking so content migration and homepage implementation can continue.

## Verified state

- Production workflow: `.github/workflows/ptscps-production-deploy.yml`.
- Astro source: `ngocnhanvo/ptscps-astro@master`.
- WordPress/PHP: `ngocnhanvo/ptscps-php@master`.
- Actions: `ngocnhanvo/ptscps-actions@main`.
- Production deploy run `41189859780` built Astro, packaged it, uploaded it by FTPS and completed signed activation successfully; it failed only at the final public-homepage smoke check.
- Read-only HTTP diagnosis run `41190288005` confirmed `/` = 403, `/index.html` = 404, while `/client/index.html` = 200 with title `Trang chủ`; WordPress `/wp-json/` = 200.
- Read-only FTPS diagnosis run `41190602826` confirmed frontend docroot has `client/index.html`, `server/entry.mjs` and `pm2-reload.txt`, but no root `.htaccess`, root `index.html`, `ecosystem.config.cjs` or `.env`.
- Guarded Apache bridge test run `41190919885` successfully installed the managed proxy temporarily, but both `/` and `/api/agent/history` returned HTTP 503 five times. The workflow then verified and removed the newly-created `.htaccess` automatically.
- Ephemeral runtime capability probe run `41191194251` completed successfully and removed its temporary PHP probe. The frontend vhost exposes PHP 8.4, but `node`, `pm2` and Passenger are not available there; `exec`, `shell_exec` and `proc_open` are disabled; port `127.0.0.1:4321` is closed.
- Therefore the Astro compile/package/upload path is healthy. The remaining blocker is **hosting runtime provisioning**: this frontend vhost currently has no runnable Node/Passenger/PM2 process for `server/entry.mjs`.
- Owner decision on 2026-10-31: missing public SSR runtime must be reported as a warning, not fail an otherwise successful SSG build/package/upload/activation. Static client verification remains blocking.

## Safety / rollback state

- No failed proxy configuration remains on production; run `41190919885` rolled back the test `.htaccess`.
- No runtime probe remains on production; run `41191194251` deleted the temporary PHP file after collecting sanitized capability data.
- Public frontend is back to the pre-test state: root routing is still unavailable, but the deployed Astro bundle remains intact under `client/` and `server/`.

## Do not repeat

- Do not rerun the content inventory/migration dry-run that already passed.
- Do not rebuild Astro merely to reproduce the same 403 until a Node-capable runtime is provisioned for the frontend domain.
- Do not retry the localhost:4321 Apache bridge unless a process is first verified listening there.
- Do not flatten `client/` into the document root. Compile/package/activation and deployed static-client checks remain blocking; only public SSR runtime availability is downgraded to a warning until hosting provides Node.
- Do not direct-dispatch the production deploy workflow; production build remains WordPress **Build Website** controlled.

## Required external hosting prerequisite

Provision a Node-capable application for `ptscps.thegioihosting.io.vn` before the next production build. Preferred contract: Node 24, application root at the frontend deployment root, startup file `server/entry.mjs`, production mode, and the hosting-assigned `PORT`/routing mechanism. If the hosting instead provides PM2/VPS access, run the standalone entry behind a verified reverse proxy; do not assume fixed port 4321 until it is actually listening.

## Next action

1. Continue content migration/homepage implementation without waiting for Node runtime; SSG/static deployment remains usable and verified separately.
2. Provision/enable the frontend Node runtime in the hosting control plane (or expose supported SSH/runtime access to the existing deployment automation) as a separate infrastructure task.
3. After runtime exists, verify `/`, one SSR route and one API route against the live runtime; until then the production workflow records this as a warning only.
4. Trigger a fresh production build only through WordPress **Build Website** when there is an actual source/content change requiring deployment, then record its run ID and source SHA here.
