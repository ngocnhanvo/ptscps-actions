# PTSC PS Visual Builder update — 2026-11-06

Status: **COMPLETE**. Final source is deployed and verified. No Builder work remains; do not repeat completed source suites, PHP upload, native builds or reversible CMS tests.

## Scope and source leases

- Project: `ngocnhanvo/ptscps-php/master`, `ngocnhanvo/ptscps-astro/master`; execution `ngocnhanvo/ptscps-actions/main`.
- Mode: auto-build. All source writes used encrypted `source-commit-actions` requests; Astro deploys were initiated only through native WordPress Build Website.
- Knowledge: `knowledge/main` at `6e5d1f333b7db7ce7e83c1626060ad74193ca9c2`.
- Final PHP: `98f91467550a0ec3819b124e5a83536c17c68584`.
- Final Astro: `9c2d791b2b594b61b495ab280b1ed435602ee88e`.
- Reference only: Template PHP `3b178876a0821f0e1c619528e462a8a3bf9de162`, Astro `0291d7d5640def31f9ee0d29328ed829fd44397b`. Neither reference project was deployed or modified.
- Separate News migration is outside this checkpoint. Existing PTSC PS public layout, native menus/URLs, language ownership and completed build optimizations are preserved.

## Resulting behavior

1. Header Menu editing uses native item IDs, permissions, current source versions, safe parent/order/link updates and verified restore behavior. Normal links select their source; Alt+click selects a native parent toggle. Preview cannot navigate or open a tab.
2. Footer scalar fields and registered Media resolve their actual native Info owner and language. Equal fallback text never implies ownership. Badge Media and its URL have independent provenance. Optional global FooterAssets remains explicit and versioned; missing or ambiguous sources are read-only.
3. Native ESC Table text, safe HTML and image cells use exact table/row/field coordinates and optimistic source versions/hashes. Stale rendered sources return 409. Text endpoints cannot promote plain text to an image URL, bypassing Media ownership. API-owned data remains read-only.
4. Private preview reload obtains fresh ticket-owned Header/Info/Media without rebuilding shared caches. The target's flattened `MenuNode[]` contract is preserved; other languages and non-Header items remain intact.
5. Preview-only foreground buttons expose background images covered by the homepage's text layers. They carry the verified cell and rendered version and use the existing guarded image inspector. Native PPS and legacy picture wrappers both support selection and responsive image/alt preview updates.
6. Native banner previous/next/dot controls work inside preview. Public markup and navigation are unchanged. Desktop/mobile editing cues and inspector skeletons identify editable, read-only and unavailable sources.

## Verification already completed — do not repeat

- PHP source gate [42146743580](https://github.com/ngocnhanvo/source-commit-actions/actions/runs/42146743580): PASS. PHP syntax, 12 standalone suites, generated UI JavaScript syntax and ticket renewal regression. Tests do not write CMS data.
- Initial Astro source gate [42146750243](https://github.com/ngocnhanvo/source-commit-actions/actions/runs/42146750243): 34 files / 216 tests PASS. Local focused 110 tests and eight Astro compiler transforms passed.
- Header array integration regression reproduced `menus.filter is not a function`; fixed in `638b51e38c3e6fca6bd2451d50357f2e7b483653`. Gate [42166614100](https://github.com/ngocnhanvo/source-commit-actions/actions/runs/42166614100): 216 PASS.
- Native overlaid-image/PPS control regressions were observed before fixes. Final gate [42169351524](https://github.com/ngocnhanvo/source-commit-actions/actions/runs/42169351524): 36 files / 226 tests PASS. Actual native PPS source selection, responsive image/alt patches and legacy picture behavior are covered.
- Independent source review findings were addressed: rendered versions, exact Footer provenance, independent badge ownership, fresh shared snapshots, Media-only image promotion, body auxiliary-click lock and fax href synchronization.
- Offline Chromium desktop/mobile contracts: PASS in [42147407661](https://github.com/ngocnhanvo/ptscps-actions/actions/runs/42147407661), before PHP release; no external navigation, requests or CMS writes.
- Scoped FTPS PHP release in the same run: 21 runtime files checked, 16 changed, all SHA-256 readback verified; includes staged before main entrypoint; no cleanup pending. Do not upload PHP again.
- Live native Header and Footer Info acceptance [42167548844](https://github.com/ngocnhanvo/ptscps-actions/actions/runs/42167548844): select/cancel/save/REST readback/preview reload/restore PASS. Temporary labels were restored and verified; native Menu timestamps were preserved rather than rewritten. Page `82467`, language `vi`.
- The same run completed exact text selection, draft cancellation and stale-rendered-source 409 checks before the image hit-test stopped at a covered background image. No text/image CMS writes occurred.
- Remaining inline-image/Media inspector and desktop/mobile preview/navigation acceptance [42168288827](https://github.com/ngocnhanvo/ptscps-actions/actions/runs/42168288827): PASS. Header/Footer/text checks were skipped using the completed checkpoint. No CMS writes.

## Deployment and continuation

- Initial WordPress-native build `42147882129` (attempt 1, source `3c519e2`) and corrected Header build `42167054532` (attempt 1, source `638b51e`) succeeded. A later native build `42169061377` (attempt 1, source `8576752`) also succeeded after all temporary CMS values had been restored.
- The deployment marker is protected outside the public client tree. Verify it through read-only, TLS-verified FTPS, not a public HTTP URL. Inspect `server/entry.mjs` and `client/index.html` along with branch/commit/target.
- Build monitor locks the exact GitHub run, classifies failed/cancelled/timed-out conclusions, has finite discovery/build/request timeouts and reports progress. WordPress reconciles its own completed-run lock; scripts never delete it directly.
- Source request v5 was rejected because concurrent News work moved Actions HEAD. V6 rebased the identical patch only after verifying unchanged Builder blobs; no News files were overwritten.
- Final integration execution: [42169505522](https://github.com/ngocnhanvo/ptscps-actions/actions/runs/42169505522), Actions source `bd8d8f62422eaa1879c8d7e9fd99f58742278594`: **SUCCESS**. It skipped successful PHP/offline/shared/text checks, built final Astro through WordPress and verified native image/banner controls on desktop/mobile without CMS writes.
- Never upload credentials, tickets, nonces, cookies, raw content backups or private runner rollback files. Published evidence is limited to sanitized result JSON and visible UI screenshots.

## Completion evidence

- Final WordPress-native build [42169632148](https://github.com/ngocnhanvo/ptscps-actions/actions/runs/42169632148), attempt **1**, job `127734149323`: **SUCCESS**. Source `9c2d791b2b594b61b495ab280b1ed435602ee88e`, branch `master`; no symlinks; deployed SSG `/index.html` and public `/` smoke PASS.
- Read-only FTPS marker verification: source/branch/target match; `server/entry.mjs` and `client/index.html` exist. Sitemap revision `4729297d-e93b-49ff-865c-0a47b6f5cedf`.
- Final native acceptance job `127733738037`: desktop **PASS**, mobile **PASS** for foreground background-image selection, exact rendered version, image/SEO inspector and actual PPS previous/next/dot banner controls. No navigation or new tabs, no CMS writes.
- Evidence artifact [`13479913871`](https://github.com/ngocnhanvo/ptscps-actions/actions/runs/42169505522/artifacts/13479913871): sanitized `build.json`, `native-build.json`, `live-final-result.json`, `live-final-desktop.png`, `live-final-mobile.png`. Both screenshots were visually inspected; image controls are reachable and the native inspector shows `home_00 · image · dòng 1`. Builder reports **0 sources awaiting build** after the restored CMS state was built.
- Earlier Header/Footer acceptance and original image/viewport acceptance are retained at their own run IDs above; no temporary test values remain. Global FooterAssets is optional and unconfigured; no content/schema was invented for it.
- Previous build optimizations remain recorded in [2026-11-06-build-optimization.md](2026-11-06-build-optimization.md) and were not repeated or reverted by this update.
