# PTSCPS implementation checkpoint

Updated: 2026-11-05
Code mode: `auto-build`

## CURRENT CHECKPOINT — HSEQ full source/target parity, objective/certificate data and production QA PASS (2026-11-05)

- Acceptance baselines now cover all corrected HSEQ children, not only Policy: `/hseq/chinh-sach-skatmtcl`, `/hseq/muc-tieu-skatmtcl`, and `/hseq/giay-chung-nhan-skatmtcl` on legacy `ptscps.com.vn` versus production target `ptscps.thegioihosting.io.vn`. HSEQ remains WordPress-owned with 5 Pages and ESC Tables `hseq_00_vi` through `hseq_04_vi`.
- Independent legacy inventory is the acceptance oracle. Policy has 3 visible documents (`PTS082024005`/`006`/`007`). Objective has **2 visible images** (`PTS082024008-223x300.png`, `PTS082024009-216x300.png`) plus **1 PDF** (`2.-Ke-hoach-thuc-hien-muc-tieu-2022-2.pdf`). Certificates have exactly 3 visible images (`Capture030123001/002/003-rotated.jpg`) mapped to ISO 9001-2015, ISO 14001-2015 and ISO 45001-2018.
- Objective media parity is now explicit: WordPress media IDs `82918`/`82919` are the two visible objective documents and media `82912` is the PDF. `hseq_02_vi` was updated in-place from one visible image to two visible image rows while preserving 7 total rows. Certificate media IDs `82913`/`82914`/`82915` remain attached to the three certificate rows in `hseq_04_vi`.
- Native `Header.vi` still preserves source navigation semantics `Giới thiệu → Dịch vụ → HSEQ`; HSEQ children remain exactly `Tất cả`, `Chính sách HSEQ`, `Mục tiêu HSEQ`, `Hệ thống quản lý HSEQ`, `Giấy chứng nhận HSEQ`.
- WordPress-triggered production deploy `42038393361` **PASS** after the objective visible-media update, including Astro build, FTP-TLS upload, signed activation and public smoke. No independent build path was used.
- Final HSEQ source→target run `42038107618` **PASS** on desktop/mobile; artifact `13420361262`. Required gates all PASS: `SOURCE_INVENTORY_PASS`, `DATA_PARITY_PASS={policyDocuments:3, objectiveVisibleDocuments:2, objectivePdfLinks:1, certificates:3}`, `NAV_PARITY_PASS`, and `VISUAL_PARITY_PASS` for both viewports.
- Image-load assertions verify actual rendered media: both objective images and all three certificate images report positive `naturalWidth`/`naturalHeight` on desktop/mobile. Artifact screenshots visually confirm the two objective documents plus PDF action and all three certificate documents. This supersedes the earlier weaker `objectiveAssets=2` gate that counted one image plus one PDF without enforcing two visible source images.
- Current Actions source `dd50ff23c3d12058518ce082fe47c783dbb59469` keeps the independent source oracle and exact WordPress build-run monitor. **Do not weaken objective parity back to link/count-only checks.**
- **Do not rerun HSEQ migration/build unless source/CMS/source code changes or a new regression is observed.** Preserve WordPress ownership of Pages/ESC Tables/Header menu and use source-visible-media parity for future HSEQ child pages.

## CURRENT CHECKPOINT — Project detail semantics aligned and production QA PASS (2026-11-05)

- Astro `master` source `886ac10d5158283f997a6c4987281c612b4c8975` (`fix(projects): use project category semantics on detail pages`) keeps generic product behavior outside project routes while treating `/dich-vu/...` / service-root detail entries as projects.
- Project detail breadcrumb now uses the real project category label from CMS and links to `/dich-vu/{categorySlug}` instead of `Sản phẩm`; the price/contact-price row is suppressed for projects, related-card quote CTAs are hidden, and the related section title is `Dự án tương tự` (`Similar projects` for EN).
- Native WordPress Build Website trigger `41994641705` **PASS**; production deploy `41994757566` **PASS** and explicitly deployed Astro commit `886ac10d5158283f997a6c4987281c612b4c8975`, including signed staging activation plus public SSG/home smoke.
- Production read-only Playwright QA `41995157303` **PASS** on desktop/mobile. Project detail regression, parent/child service routes and category routes remain PASS. Screenshot artifact `13399184214` visually confirms the project category breadcrumb, no visible quote CTA, and `Dự án tương tự` cards without quote buttons on desktop/mobile.
- The matching project category routes are healthy in the same QA (`SERVICES_READONLY_QA_REPAIR_PLANT=PASS` desktop/mobile and `SERVICES_READONLY_QA_CATEGORY=van-hanh-va-bao-duong-fpso-fso-mopu:PASS`), so the breadcrumb destination is backed by an existing live category route.
- **Do not rerun this build/QA unless Astro/CMS changes or a new regression is observed.** Preserve project-only semantics in `ProductDetailsPage.astro`; do not globally remove e-commerce behavior from real product routes.

## CURRENT CHECKPOINT — Project detail isolated from service landing content and production QA PASS (2026-11-05)

- Root cause fixed in the generic product-detail route: `src/pages/ssr/products/[slug]/detail.astro` previously rendered `ExtractHTML` from the product-list page in an attempt to reuse a banner, which injected the entire `/dich-vu` landing content above project details. The detail route now renders only `ProductDetailsPage`; no project slug is hard-coded.
- Astro `master` source `442ae298c236ba8df012a88468e0e0e1568c57b8` (`fix(projects): remove service listing from project details`) passed `source-commit-actions` run `41991543813`. The earlier v1 control request failed during Base64 decrypt before target checkout/apply and is superseded; do not rerun it.
- Native WordPress Build Website trigger `41991745468` **PASS**; production deploy `41991850775` **PASS** and explicitly deployed Astro commit `442ae298c236ba8df012a88468e0e0e1568c57b8`, including signed staging activation plus public SSG/home smoke.
- Regression guard commit `29fa728f1e187fda37cf508e7d81b8e681a41a34` adds a real project-detail browser check derived from the first repair project card instead of hard-coding its route. Production read-only Playwright run `41992279220` **PASS** on desktop and mobile: first H1 equals the Dung Quat project title, no `[data-services-category-grid]`, no service category description, and all existing service/menu regressions remain PASS.
- Screenshot artifact `13398274004` contains `desktop-repair-project-detail.png` and `mobile-repair-project-detail.png`; both visually start at breadcrumb/project content with no service landing grid above it.
- **Do not rerun this build/QA unless Astro/CMS changes or a new regression is observed.** Keep the project-detail isolation assertion in `scripts/ptscps-services-readonly-qa.mjs`.

## CURRENT CHECKPOINT — Repair service detail legacy flow aligned and production QA PASS (2026-11-05)

- Scope completed: `dich-vu-bao-duong-sua-chua-thiet-bi-tinh-thiet-bi-quay-thiet-bi-dien-va-tu-dong-hoa`. The nested service detail no longer renders all capability images as a detached gallery after the text; content and media now follow the legacy sequence from CMS.
- CMS migration run `41987398204` **PASS**. ESC Table `pub_service_dich-vu-bao-duong-sua-chua-thiet-bi-tinh-thiet-bi-quay-thiet-bi-dien-va-tu-dong-hoa` read back with `29` rows and `16` media items (`CREATED_VERIFIED`). Earlier runs `41985729490` and `41986460583` failed while testing taxonomy-description image storage and are superseded; **do not rerun them**.
- Astro `master` source `5514dac1e4ea159fd57d247a097e7d14f2a454ce` renders the generic ESC Table detail flow in CMS order, groups adjacent `gallery-image` rows, suppresses the old taxonomy description/capability gallery when a content flow exists, and does not hard-code the service slug.
- Native WordPress Build Website trigger `41988133432` **PASS**; production deploy `41988260123` **PASS** from Astro source `5514dac1e4ea159fd57d247a097e7d14f2a454ce`, including build/package/FTPS activation and public SSG smoke.
- Production read-only Playwright QA `41989276180` **PASS** on desktop and mobile: `19` ordered content blocks, `6` gallery groups sized `[2,2,2,4,4,2]`, `16` loaded images, no duplicate capability gallery, and parent/plant/other/menu regressions PASS. Screenshot artifact: `13396899538`.
- **Do not rerun this migration/build/QA unless CMS/source changes or a new regression is observed.** If further visual refinement is requested, start from artifact `13396899538` and adjust only the shared ESC Table/Tailwind presentation while preserving CMS order and data ownership.

## CURRENT CHECKPOINT — VI/EN AI Agent live regression PASS (2026-11-02)

- Source verified: Astro `master` `385ad53970d6574b9c34dcf02cf6348fded900eb` (active-page-locale chat, history and clear); PHP `master` `d023836e52c5a03ae5694f15044cf437c07225dc` (English-only synthesis instructions, existing VI preserved).
- Existing PHP history locale release [41331571290](https://github.com/ngocnhanvo/ptscps-actions/actions/runs/41331571290), WordPress Build Website [41331695187](https://github.com/ngocnhanvo/ptscps-actions/actions/runs/41331695187) and Astro deploy [41331739032](https://github.com/ngocnhanvo/ptscps-actions/actions/runs/41331739032) PASS. **Do not rerun these builds.**
- New focused PHP-only release [41333821863](https://github.com/ngocnhanvo/ptscps-actions/actions/runs/41333821863) PASS; it uploaded only `AgentSynthesisPrompt.php`, with pinned source SHA, PHP lint and locale regression test. No Astro rebuild was needed.
- Post-release real-site live QA [41333951883](https://github.com/ngocnhanvo/ptscps-actions/actions/runs/41333951883) **PASS**: EN page `lang=en` and Agent language flag; EN answer English (16 EN signals, 0 VI signals); VI answer Vietnamese; shared cookie and language-isolated history; POST clear verified by fresh GET in both languages. Do not rerun QA without a new regression.
- Agent English-language error cause: the prior synthesis system prompt was entirely Vietnamese; a trailing locale instruction did not reliably prevent Vietnamese replies. EN now receives separate English-only synthesis instructions, with the same evidence-only constraints. VI prompt unchanged.
- Remaining unrelated migration/visual tasks are tracked in historical checkpoints. Keep build activation routed only through WordPress Build Website; do not trigger production Actions directly.

## CURRENT CHECKPOINT — Quick links, customers and footer (2026-11-01)

- WordPress homepage Page ID `82467` retains prior six native ESC Table sections and has two more native Insert Code blocks: `home_14` four quick links and `home_15` nineteen customer logos. Both tables saved and read back without duplicates; 23 authentic old-site images imported via WordPress native media picker with ALT. Guarded CMS run [41232378867](https://github.com/ngocnhanvo/ptscps-actions/actions/runs/41232378867) PASS. **Do not rerun source inventory, original 12 images or this 23-image import.**
- Astro `master` implemented both responsive sections and original-company footer in `3edabd510a6283758f2aa4488c58d9a6cf7f93b1`; first native WordPress build trigger [41233080049](https://github.com/ngocnhanvo/ptscps-actions/actions/runs/41233080049) and production deploy [41233136602](https://github.com/ngocnhanvo/ptscps-actions/actions/runs/41233136602) PASS.
- Live read-only Playwright [41233386886](https://github.com/ngocnhanvo/ptscps-actions/actions/runs/41233386886) PASS on desktop 1440, tablet 768, mobile 390: eight sections rendered, no horizontal document overflow, no same-origin request failures. Artifact `13054691953` contains screenshots. Its initial inspection found footer incorrectly using the hosting domain and unverified Zalo fallback; this QA **predates** the next footer-only source correction.
- Astro `master` footer-only fix `75b5edc04f183fa4bf93c918bdb82a55c483f0a7` commits verified official website display (`www.ptscps.com.vn`) instead of hosting domain and prevents guessing Zalo from the landline. **Next:** build this SHA only through the native WordPress Build Website UI, monitor production release and verify corrected footer visually. SSR hosting warning is non-blocking for SSG.

## HISTORICAL CHECKPOINT — Header WordPress integrated and deployed 2026-10-31

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
