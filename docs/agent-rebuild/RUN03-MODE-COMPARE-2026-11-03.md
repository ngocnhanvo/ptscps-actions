# RUN03 — Fact versus collection retrieval, 2026-11-03

Status: **PRODUCTION DIAGNOSTIC PASS / RETRIEVAL QA FAIL**. This is not RUN03/RUN07/RUN08 acceptance.

## Verified scope and evidence

- Read `ngocnhanvo/knowledge@main` tree `d58d60043cc52fcd988f61ef4e3c883735bdcf43` before changes; preserved official ACF `product_lang` and actual TablePress shortcode language rules.
- PHP `ngocnhanvo/ptscps-php@master` `e5620533b0a1b315b81592c9d5798692fe72a9d5` via encrypted [source-commit #41555205467](https://github.com/ngocnhanvo/source-commit-actions/actions/runs/41555205467) PASS. Read-only QA now permits explicit `fact` or `collection` retrieval, with admin nonce and opt-in compare flag; default `fact` unchanged. No production ranking or business rule changed.
- Actions `ngocnhanvo/ptscps-actions@main` `e1421cf6664fa4663b9720d138a87430e6b01b44` via encrypted [source-commit #41555355841](https://github.com/ngocnhanvo/source-commit-actions/actions/runs/41555355841) PASS. New workflow runs only the four existing natural probes and stores sanitized aggregates.
- [Guarded production release and comparison #41555378708](https://github.com/ngocnhanvo/ptscps-actions/actions/runs/41555378708) PASS: PHP syntax, 20/20 stage regressions, 10/10 published-collection tests, 10/10 source-locale tests, read-only guard tests; FTPS identity/TLS PASS, 6 files checked, **3 installed, 3 unchanged**, SHA-256 readback PASS, rollback retained, no Astro build.
- [Sanitized artifact #13193772424](https://github.com/ngocnhanvo/ptscps-actions/actions/runs/41555378708/artifacts/13193772424): fact-mode expected-source top-5 **1/4**, collection-mode **2/4**, **0 wrong-locale** across both. This is only four existing questions, not factual-answer correctness or the >=100-case suite.

| Existing case | Fact top-5 | Collection top-5 | Evidence-based observation |
|---|---|---|---|
| `vi_services` | PASS | PASS | Normal ranked retrieval |
| `en_services` | FAIL | FAIL | Rank token coverage; no top-5 rows in either mode |
| `vi_clients` | FAIL | PASS | Collection source resolved through published TablePress metadata |
| `en_clients` | FAIL | FAIL | No SQL lexical match; no top-5 rows in either mode |

The prior combined anchor+natural baseline remains **7/24** top-5 (FAIL), not remeasured as no ranking fix was made. Collection mode gained one source-grounded natural hit, but cannot be claimed as general RAG PASS. No CMS/index writes, backfill, reindex, provider quota, source-fact fabrication or Astro Build Website trigger. The 717 orphan groups remain untouched.

## Remaining gates and next exact action

- RUN03 **FAIL** versus >=95%; first inspect the two EN misses using protected, admin-authenticated, read-only comparisons of published TablePress title/excerpt, indexed search text and token/coverage stages. Distinguish a test-query mismatch from a genuine retrieval defect before editing tokenization or ranking. Preserve authoritative factual guard and official locale rules. Then apply only a proven minimal fix with regression, guarded FTPS, and live QA.
- RUN01 live multilingual chat QA still pending; RUN02 existing corpus inventory PASS. RUN04–06 remain PARTIAL/NOT VERIFIED with prior Planner `plan_shape`, Groq 429 and factual-answer failures; do not spend provider quota blindly.
- RUN07 full four-source acceptance **BLOCKED** by absence of real published Post/Product in last verified census; RUN08 **NOT STARTED**. No overall production acceptance.

Chế độ code: auto-build (no Astro change; no Astro build required).
