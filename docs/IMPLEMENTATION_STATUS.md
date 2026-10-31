# PTSCPS implementation checkpoint

Updated: 2026-10-31
Code mode: `auto-build`

## LATEST CHECKPOINT — Header WordPress integrated and deployed 2026-10-31

- This section **supersedes the older Homepage checkpoint below**; old claims about a missing Header menu are historical, not current blockers.
- Native WordPress `Header.vi` now exists: menu ID `1767`, `code=Header`, `lang=vi`, type `dropdown`. Exactly one verified published destination: `Trang chủ`, native item ID `82514`, `key=home`, `href=/`, `linkType=internal`. Guarded setup run [`41219401043`](https://github.com/ngocnhanvo/ptscps-actions/actions/runs/41219401043) **PASS**, no duplicate menu/item created.
- WordPress **Build Website** triggered via native authenticated admin UI, run [`41219602534`](https://github.com/ngocnhanvo/ptscps-actions/actions/runs/41219602534) **PASS**. The resulting production deploy [`41219661285`](https://github.com/ngocnhanvo/ptscps-actions/actions/runs/41219661285) **PASS** (SSG + public homepage smoke), log: `1 WordPress Header menu, 1 changed, wordpress`. Astro source remains `ngocnhanvo/ptscps-astro@master` SHA `b79a88aac76fc4e7bb69f3078f836e99de9de3bd`; this was a CMS-data rebuild, not a source-code change.
- Focused read-only browser QA [`41220075280`](https://github.com/ngocnhanvo/ptscps-actions/actions/runs/41220075280) **PASS**: live desktop at 1440px shows `Trang chủ` linking `/`; live mobile at 390px opens hamburger, shows the same valid link and sets `aria-expanded=true`. WordPress REST readback still shows exactly one item.
- **Do not repeat** native Header creation, WordPress build/deploy, 12/12 ESC Table images, prior full-page Visual QA or this focused menu QA. Do not hardcode navigation in Astro. Additional menu links must wait for actual migrated/published target pages; no invented URLs. Next: remaining content migration, then link mapping/menus/footer/policy pages; SSR runtime remains a non-blocking warning for SSG.

## HISTORICAL CHECKPOINT — Homepage 2026-10-31 (superseded by Header checkpoint above)

- Astro source `ngocnhanvo/ptscps-astro@master` at `b79a88aac76fc4e7bb69f3078f836e99de9de3bd` has been deployed through **native WordPress Build Website**.
- WordPress build trigger: `41214276700`; production deployment: **`41214333199` PASS**, including SSG smoke `/` and public homepage smoke.
- 12/12 native ESC Table images were saved and read back (`41207578994` PASS). **Do not reimport/reupload these assets.**
- Latest live-root desktop/mobile browser QA: `41211947416`, latest job `124576214653` PASS. Desktop 1440px: scrollWidth=1440, no overflow offenders, all 6 sections present, header CMS logo loaded. Mobile 390px: scrollWidth=390, no overflow offenders, all 6 sections present, logo loaded. Screenshots in latest workflow artifact (`13047292657`).
- Fixed desktop header nav width to `calc(100% - 220px)` beside logo; desktop blank strip and news-section paint also corrected in previous source commits.
- **Remaining homepage integration issue:** WordPress reports *no valid Header menu*. Build prints `WordPress chưa có menu Header hợp lệ, đang dùng src/data/menu.json fallback` and `0 WordPress Header menu`. The fallback array is empty; visible desktop navigation is therefore blank. This is a **WordPress CMS content/configuration issue**, not a CSS width regression. Do **not** hardcode navigation labels/links in Astro or seed unverified destinations. Map verified legacy navigation to migrated target pages with native WordPress Menu Manager when URLs/pages exist, then use the normal WP Build Website trigger.
- Public `/` currently returns HTML 200. This does not prove private SSR/API runtime readiness; do not revive unsupported Node proxy experiments or count them as homepage blocker.

### Next work (in order)

1. Inspect WordPress Menu Manager and current valid page/permalink inventory; create/restore a native `Header` Vietnamese menu based on real migrated links, preserving hierarchy. Verify `esc-api/v1/menus` exposes valid `Header.vi` and use WordPress Build Website only if data changed. If target pages have not migrated, record missing dependencies instead of linking to nonexistent pages.
2. Validate desktop navigation items, mobile hamburger interactions, key links, and visual parity with the approved design using PTSCPS Actions/Playwright, not repeated content/media imports.
3. Continue remaining content migration and footer menu/policy links separately as their CMS targets become available. The historical status sections below describe **older runs**, before public root and SSG smoke were repaired.

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
- Therefore the Astro compile/package/upload path is healthy. Hosting runtime provisioning remains a blocker only for public SSR/API routes; it does not block SSG/static build/package/upload/activation.
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

## Separate SSR hosting prerequisite

Provision a Node-capable application for `ptscps.thegioihosting.io.vn` before public SSR/API routes are expected to work. Preferred contract: Node 24, application root at the frontend deployment root, startup file `server/entry.mjs`, production mode, and the hosting-assigned `PORT`/routing mechanism. If the hosting instead provides PM2/VPS access, run the standalone entry behind a verified reverse proxy; do not assume fixed port 4321 until it is actually listening.

## Next action

1. Continue content migration/homepage implementation without waiting for Node runtime; SSG/static deployment remains usable and verified separately.
2. Provision/enable the frontend Node runtime in the hosting control plane (or expose supported SSH/runtime access to the existing deployment automation) as a separate infrastructure task.
3. After runtime exists, verify `/`, one SSR route and one API route against the live runtime; until then the production workflow records this as a warning only.
4. Trigger a fresh production build only through WordPress **Build Website** when there is an actual source/content change requiring deployment, then record its run ID and source SHA here.
