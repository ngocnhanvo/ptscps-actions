# PTSCPS RAG rebuild — latest checkpoint

- Timestamp: 2026-11-03 (Asia/Ho_Chi_Minh), RUN 00 baseline.
- Active run: **02**, audit ingestion and retrieval after source-level locale correction.
- RUN 00: **PASS — audit only**; see `README.md` for verified HEAD and PASS/FAIL evidence.
- RUN 01: **SOURCE PASS / LIVE NOT TESTED** — PHP `68514b7e` via control-plane [#41495039282](https://github.com/ngocnhanvo/source-commit-actions/actions/runs/41495039282), ACF arbitrary language, TablePress unknown IDs default VI, scoped language-history tests PASS. ContactSkill exact-ACF selection PHP `f6f6e58d` via [#41495944119](https://github.com/ngocnhanvo/source-commit-actions/actions/runs/41495944119), focused PHP unit test PASS. Neither commit alone proves runtime rollout.
- RUN 02: **PARTIAL** — existing index/chunker/Product source code present, but live published Page/Post/Product/Thông tin chung coverage must be re-audited read-only. Do not rerun prior successful production backfill.
- RUN 03: **NOT STARTED**. Existing SQL LIKE evidence search is lexical RAG, not embedding/vector or independently measured semantic retrieval.
- RUN 04–06: PARTIAL/NOT VERIFIED; provider and routing failures persisted after prior changes.
- RUN 07: NOT STARTED; production corpus lacks published Post/Product in latest verified audit.
- RUN 08: NOT STARTED; production is not accepted.
- Overall: **IN_PROGRESS — NOT DONE**. PHP source HEAD after two commits: `f6f6e58d2d6de19b18b164cd4fe03d8af2424b09`. No production release done here. 7/9 runs still incomplete, RUN 01 live acceptance pending.
- Next exact step: RUN 02 read current source and inventory, audit ingestion across all published post types and TablePress with strict ACF locale, then design/run read-only evidence queries from actual CMS records. After independent readiness, guarded PHP-only release and postrelease QA. Do not repeat source commits that passed.
- Open failures: `#41383340604` live QA 1/4; unverified new Gemini source on production; previous protected PHP release failures. Keep 719 orphan index groups untouched.
- Source-of-truth locale: `ngocnhanvo/knowledge@d58d60043cc52fcd988f61ef4e3c883735bdcf43` / `stacks/wordpress-content-locale.md`.

## Scheduled continuation

- An hourly ChatGPT automation was created for 2026-11-03 01:39–08:39 Asia/Ho_Chi_Minh to continue from this checkpoint, plus a 09:00 acceptance review. This is an explicitly configured automation, **not** a guarantee all 9 runs finish or that the Chrome extension can force one chat to remain running.
