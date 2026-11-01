# PTSCPS — Unified bilingual AI Agent knowledge: execution checkpoint

Updated: 2026-11-02 (+07:00). Scope: `ngocnhanvo/ptscps-php@master` and `ngocnhanvo/ptscps-actions@main`. Code mode: `auto-build`.

## Mandatory policy and target

Read `ngocnhanvo/knowledge@main` before work. Source writes to allowlisted PHP/Actions targets **only** via `ngocnhanvo/source-commit-actions` (encrypted request + READY); never use target Contents/Git Data API writes. PHP release is separate from source commit. Astro builds, if required, are only triggered by WordPress `Build Website`, not direct GitHub Actions invocation.

Published Page/Post/Product locale is the exact `product_lang` ACF value `vi` or `en`; absent/invalid values are *unclassified* and must not enter either corpus. TablePress locale uses its **actual ID** from the `tablepress_tables.table_post` mapping, not the WordPress slug: exactly one `_` means VI; >=2 underscores require a terminal `_vi` or `_en`; zero or unknown suffix means unclassified. Visitor page locale determines retrieval and answer language regardless of the language used to type the question.

## Verified commits and workflow evidence

- Existing live chat locale/history/synthesis baseline: PHP `d023836e` released in PTSCPS Actions [41333821863](https://github.com/ngocnhanvo/ptscps-actions/actions/runs/41333821863), live chat QA [41333951883](https://github.com/ngocnhanvo/ptscps-actions/actions/runs/41333951883) PASS. **Do not rerun these past workflows.**
- PHP `9d96f14c`: shared strict source locale rules, product inclusion and unit test; control-plane run [41338402548](https://github.com/ngocnhanvo/source-commit-actions/actions/runs/41338402548) PASS.
- PHP `b9b2f046`: classify TablePress by real registry ID, not post slug; independently committed.
- PHP `dfad70e8`: read-only four-source Inventory/coverage report in `KnowledgeInventory.php`; admin interface `Tools → AI Knowledge Index → View bilingual inventory JSON`; independently committed.
- PHP `0d3c647b`: lossless chunking of long Page/Post/TablePress, plus unit test, control-plane [41339660056](https://github.com/ngocnhanvo/source-commit-actions/actions/runs/41339660056) PASS.
- PHP `a4b517de`: product public description/category/visible attributes in `ProductKnowledgeSource`, plus unit test; control-plane [41340339295](https://github.com/ngocnhanvo/source-commit-actions/actions/runs/41340339295) PASS.

Above reflects **source-level** completion only. The latest verified PHP source HEAD when this checkpoint was drafted is `a4b517de654ed5a781874e032934527b4ef62087`. Re-read HEAD before each step; a concurrent implementation may move it. A source-only PASS is **not** production deploy or live QA.

## Do not repeat / do not race

- A lossless chunker request `20261102-ptscps-agent-chunker-lossless-v1` failed `git apply` and must not be rerun; a corrected v3 completed successfully. v2 was only staged, never READY-triggered.
- A proposed `20261102-ptscps-agent-product-evidence-v1` was **staged encrypted but not READY-triggered**, because concurrent commit `a4b517de` introduced overlapping Product indexing. Do not activate this stale request. Inspect the actual source before making an independent delta.
- Do not run an Astro production build merely because PHP KnowledgeIndex source changed; the chatbot is a WordPress/PHP concern.
- Do not bulk reindex production before a read-only inventory, known source SHA, rollback/backup, and guarded deployment path are confirmed. No verified production reindex occurred in this execution phase.

## Work remaining, in order

1. **Release preflight / live inventory:** verify the exact PHP source SHA, inspect the existing PHP release workflow (`ptscps-actions/.github/workflows/ptscps-php-release.yml`) and `ptscps-php-live-release.py` allowlist for all new Knowledge files. Existing manual workflow has an explicit `DEPLOY_PHP` opt-in, and historic push triggers pin old SHAs. Do not hijack a historic trigger. Use the approved guarded PHP FTPS path when executable. Confirm updated code is actually live before opening the authenticated read-only inventory. Do not assume unit tests imply deployment.
2. **Inventory:** export CMS Page, Post, Product and TablePress census with status, VI/EN/unclassified locale, index chunks, missing/orphan coverage. Count actual eligible published records; inventory PASS must include 100% enumerated sources, not an estimated percentage. Investigate unclassified ACF and TablePress IDs without guessing language.
3. **Index refresh:** validate new chunker/product metadata with real post and TablePress fixtures; handle index-version/backfill under backup and rollback controls, avoiding implicit full rebuild in a regular chat request. Confirm update hooks, stale index cleanup, and eventual consistency. Check TablePress rows, ESC Table data objects, source URLs, duplicated section references, and completeness of product relationships.
4. **Retrieval/Planner:** audit remaining hard-coded service/helmet/Blue Sea routing and evidence ranking. Prioritize verified corpus-wide retrieval before specialist fallback, but retain dynamic WooCommerce checks for price/stock. Test follow-up, negative questions, multi-source synthesis and original source references.
5. **100+ bilingual factual QA:** obtain a *ground-truthed* question set from actual published CMS records. Minimum 100 questions, spanning four source types, both locales, negative/unknown, conversation continuity, source ranking and cross-locale leakage. Acceptance: 100% eligible source status known; 0 wrong-locale evidence; top-5 recall >=95%; >=95% factual answers supported; no invented business/product/pricing claims. Preserve evidence/run/inputs.
6. **Release acceptance:** only after guarded PHP deploy + inventory + reindex + live VI/EN regression; report source SHA, deploy run, post-deploy QA, observed metrics, and remaining exclusions separately. Do not mark the entire project PASS just because individual source commits succeeded.

## Current status

`CODE_READY_PARTIAL` (Locale, Inventory utility, lossless chunker, basic product facts), `PRODUCTIVE_SOURCE_TESTS_PASS`, `LIVE_INVENTORY_NOT_RUN`, `PRODUCTION_KNOWLEDGE_DEPLOY_NOT_VERIFIED`, `REINDEX_NOT_RUN`, `100_QUESTION_QA_NOT_RUN`, `ACCEPTANCE_PENDING`.

This file is a checkpoint, not approval to bypass production gates or assume that new CMS content is published in VI/EN.
