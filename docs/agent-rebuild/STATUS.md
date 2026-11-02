# PTSCPS RAG rebuild — latest checkpoint

- Timestamp: 2026-11-03 (Asia/Ho_Chi_Minh), RUN 00 baseline.
- Active run: **01**, pending implementation and tests.
- RUN 00: **PASS — audit only**; see `README.md` for verified HEAD and PASS/FAIL evidence.
- RUN 01: **NOT STARTED**. New Knowledge locale classification supersedes old plan.
- RUN 02: PARTIAL, existing index/chunker/product hooks; do not rerun successful production backfill.
- RUN 03: NOT STARTED. Existing SQL LIKE search is not vector/semantic RAG.
- RUN 04–06: PARTIAL/NOT VERIFIED; provider and routing failures persisted after prior changes.
- RUN 07: NOT STARTED; production corpus lacks published Post/Product in latest verified audit.
- RUN 08: NOT STARTED; production is not accepted.
- Overall: **IN_PROGRESS — NOT DONE**.
- Next exact step: verify current PHP HEAD, change `AgentLocale.php` plus locale unit test on `ptscps-php/master` using approved source-commit request, run PHP test, and record commit/run.
- Open failures: `#41383340604` live QA 1/4; unverified new Gemini source on production; previous protected PHP release failures. Keep 719 orphan index groups untouched.
- Source-of-truth locale: `ngocnhanvo/knowledge@d58d60043cc52fcd988f61ef4e3c883735bdcf43` / `stacks/wordpress-content-locale.md`.
