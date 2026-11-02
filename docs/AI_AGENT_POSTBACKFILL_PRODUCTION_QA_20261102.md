# PTSCPS AI Agent — Production post-backfill QA checkpoint (2026-11-02)

Scope: `ptscps-php/master` SHA `3144e27804baa79f00b94fd64342a8b75a39a3b5`, `ptscps-actions/main` SHA `1adadaae0e1c6c44845391aca1a872c07d481663`. Mode: `auto-build`; PHP-only work, no Astro build.

## Verified PASS — do not rerun

- Guarded PHP recovery tool release [#41380573605](https://github.com/ngocnhanvo/ptscps-actions/actions/runs/41380573605): PASS.
- Fingerprint-pinned preview [#41381068633](https://github.com/ngocnhanvo/ptscps-actions/actions/runs/41381068633): PASS (16 tables; 8 VI, 8 EN; 98 expected chunks).
- Production guarded apply [#41381347856](https://github.com/ngocnhanvo/ptscps-actions/actions/runs/41381347856): PASS; 16/16 TablePress tables indexed, 98 chunks, 18/18 eligible sources indexed, missing=0; 719 legacy/non-enumerated index groups **untouched**. Artifact contains preflight and result. Never repeat this apply without a new explicit scope/fingerprint.
- New read-only live QA source committed through central control-plane [#41383327081](https://github.com/ngocnhanvo/source-commit-actions/actions/runs/41383327081): PASS; Actions source commit `1adadaae`.
- Live read-only audit [#41383340604](https://github.com/ngocnhanvo/ptscps-actions/actions/runs/41383340604): **inventory PASS**, 18 eligible/published, 9 VI, 9 EN, zero missing; 2 published Page, 16 published TablePress; **zero published Post/Product** in the four-source census. All 16 public TablePress IDs accessible, 82 text rows. Orphan *groups* = 719 (693 post, 24 page, 2 thong-tin-chung). These are not confirmed safe for deletion.

## Production QA FAIL — acceptance BLOCKED, not full deployment PASS

Same read-only run #41383340604: factual smoke passed only **1/4** cases. `vi_services`: HTTP 200, language and one published-table grounding term found, PASS. `en_services`: HTTP 200, English language PASS but no table-grounding term, FAIL. `vi_clients`: HTTP 200, Vietnamese PASS but no table-grounding term, FAIL. `en_clients`: HTTP 503, no answer, FAIL. Result artifact `ptscps-agent-postbackfill-live-qa`, ID `13114785992`, contains only sanitized diagnostics; no answer bodies or secrets.

A zero token hit is a screening signal, not conclusive proof of inaccurate content. Diagnose actual chosen Planner skill, retrieved evidence, and response; distinguish no-answer from different correct paraphrase. Investigate episodic HTTP 503 by comparing frontend proxy and authorized WordPress Agent upstream, without printing credentials or customer chat content.

## Next actions (strict order)

1. Read-only trace for the four focused cases: inspect Planner/Skill route, retrieval mode `fact` vs `collection`, TablePress source IDs/rows, evidence count, context, source URLs; compare frontend 503 and WordPress upstream code. No ungrounded code patches.
2. If root cause confirmed, add minimal source fix + portable regression tests via encrypted `source-commit-actions` request on `ptscps-php/master`, pinned to current HEAD. Deploy PHP only via guarded project FTPS release, verify SHA/readback/rollback, no Astro build.
3. Run **new focused regression only for corrected behavior**; do not repeat previously PASS backfill or old locale QA. Keep 719 orphan groups intact until an authoritative cross-type inventory and rollback plan exist.
4. For 100+ VI/EN factual acceptance across Page, Post, Product, TablePress, first publish/verify real Post/Product content and strict `product_lang` ACF classification. Current four-source census has zero published Post/Product: full four-source acceptance **cannot** be reported PASS. Build ground truth from CMS records, test top-5 recall >=95%, supported answers >=95%, wrong-locale evidence=0, and no invented facts.

Statuses: `BACKFILL_PRODUCTION_PASS`; `INDEX_COVERAGE_18_OF_18_PASS`; `LIVE_QA_1_OF_4_FAIL`; `POST_PRODUCT_CORPUS_ABSENT`; `FULL_ACCEPTANCE_NOT_PASSED`. Preserve all evidence URLs and do not invent completion.
