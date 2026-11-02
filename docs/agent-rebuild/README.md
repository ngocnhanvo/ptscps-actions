# PTSCPS AI Agent — RAG rebuild (RUN 00–08)

Owner-approved execution scope: PTSCPS WordPress AI Agent. This is an **execution checkpoint**, not a claim of completion.

**Source of truth:** `ngocnhanvo/knowledge@main`, especially `stacks/wordpress-content-locale.md` (verified HEAD `d58d60043cc52fcd988f61ef4e3c883735bdcf43`, 2026-11-03).

**Repositories:** `ngocnhanvo/ptscps-php@master`, `ngocnhanvo/ptscps-astro@master`, `ngocnhanvo/ptscps-actions@main`. All source writes to allowlisted targets must use encrypted `ngocnhanvo/source-commit-actions` requests. Astro builds only via WordPress Build Website, not direct Actions. PHP-only release and website production acceptance are separate gates.

## Run ledger and acceptance gates

| Run | Scope | Gate | Status at RUN 00 audit |
|---|---|---|---|
| 00 | Audit architecture, production baseline, safe handoff | HEAD, latest runs, old PASS/FAIL preserved | PASS (read-only audit, this document) |
| 01 | Source-language contract | ACF arbitrary valid locale; TablePress actual shortcode; tests | SOURCE PASS, live acceptance pending — `68514b7e`, `f6f6e58d` |
| 02 | Four-source ingestion | Page/Post/Product/TablePress/other ACF, update hooks, lossless chunking; no unplanned bulk reindex | PARTIAL — prior source tests exist |
| 03 | Retrieval/RAG | Evidence recall/ranking across available sources; no PHP hard-coded semantic responses | NOT STARTED |
| 04 | LLM Planner | Schema, conversational intent, tool plans, grounded dispatch | PARTIAL — provider failures observed |
| 05 | Skills/Tool gateway | Verifiable contracts, CMS and dynamic WooCommerce retrieval | PARTIAL — ContactSkill ACF locale corrected in `f6f6e58d` |
| 06 | LLM synthesis & resilience | Grounded language-correct answers, provider errors and failover | PARTIAL — production unstable |
| 07 | Ground-truthed VI/EN+ multilingual QA | >=100 real-source cases when corpus supports, 0 cross-locale leakage; >=95% retrieval top-5, >=95% supported factual answers | NOT STARTED |
| 08 | Release and production acceptance | Guarded PHP release, rollback/readback, postrelease read-only QA | NOT STARTED |

**Completion contract:** Every required run is evidence-backed PASS on an identified SHA and environment, all in-scope open FAIL resolved, and production acceptance verified. `FAILED`, `BLOCKED`, `NOT_TESTED`, `SKIPPED`, and source-only PASS cannot be promoted to project DONE. ChatMode Recovery must treat an end-of-chat response as a checkpoint, not evidence of project completion. Automated recovery may request a new read-only assessment, but must never loop on an external blocker or take unapproved action.

## Verified baseline — 2026-11-03

- PHP HEAD: `6af01f694d6737392ec2fdbb58c1c050fe7166ac`.
- Astro HEAD: `28ae46057de761bc3ae8c4a2a3abe660a6043e1a`.
- Actions HEAD before RUN 00: `ecabdbbcaf6808fdc39779d3677d8c1c0dec0ffd`.
- TablePress guarded recovery `#41381347856` **PASS**: 16/16, 98 chunks, indexed coverage 18/18; **do not rerun** without a new scoped, backed-up reason.
- Read-only production inventory `#41383340604`: two published Pages, 16 TablePress, no published Post/Product in four-source corpus; 719 orphan groups *untouched*. Corpus counts require fresh read-only verification before final QA.
- Factual smoke in same run: **1/4 PASS**, three unresolved; a token-match failure alone is not definitive factual error.
- Production error UI browser acceptance `#41476189957` PASS; Astro Build Website `#41475086348` PASS — **do not rerun** for PHP-only work.
- Failed protected PHP releases `#41462206087`, `#41469958485`, `#41474403887`; newest Gemini source fix `6af01f69` **not verified live**.
- Previous plan in `docs/AI_AGENT_KNOWLEDGE_UNIFICATION.md` contains **superseded locale rules**; use the newly approved Knowledge, not that old checkpoint, for RUN 01 onward.

## Run execution protocol

1. Read `knowledge/main` and this checkpoint; check the current remote HEAD, running workflows, and prior artifacts before any action.
2. Diagnose one layer and write evidence. Change only in-scope code via allowed control-plane, pin `base_sha` and validate test files.
3. Each source commit is followed by targeted tests. Production release is a separate guarded operation. Never reindex or delete existing data to pass a test; no fabricated Page/Post/Product content.
4. Record exact SHA, run URL, test failures, live state and next action. Carry forward every unresolved failure until a fresh run verifies correction.
5. If in doubt about provider quotas, permissions, external API costs, or live access, label the relevant gate BLOCKED and continue safe independent work, without inventing business rules.
6. If this chat ends, continue from the latest ledger and current GitHub live state. **No promise of unattended ChatGPT execution is implied without a configured external worker.**

## Immediate next actions

1. RUN 01: implement the exact arbitrary-ACF-language and TablePress-default-VI contract with focused PHP tests; verify source commit and record new SHA.
2. RUN 02–03: audit actual ingestion/retrieval completeness before selecting embedding or vector infra. Existing WordPress/MySQL is the default; no added paid services by assumption.
3. RUN 04–06: fix LLM Planner/Skill/Synthesis from trace evidence, including provider 429/400 and safe failover. No regex semantic shortcuts.
4. RUN 07–08: factual QA from real published records; guarded deploy + production smoke, then close ledger only on measured PASS.

**Requested long-task window:** 2026-11-03 00:39–09:00 Asia/Ho_Chi_Minh. GitHub Actions may run independently once configured, but ChatGPT itself does not continue executing after the active session ends.

### Changes after baseline (2026-11-03)

- RUN 01 source locale + unit tests: PHP [`68514b7e`](https://github.com/ngocnhanvo/ptscps-php/commit/68514b7e799a4083949ba491be4ad5a90eadeacd), [control run #41495039282](https://github.com/ngocnhanvo/source-commit-actions/actions/runs/41495039282) PASS.
- ContactSkill ACF exact locale + unit tests: PHP [`f6f6e58d`](https://github.com/ngocnhanvo/ptscps-php/commit/f6f6e58d2d6de19b18b164cd4fe03d8af2424b09), [control run #41495944119](https://github.com/ngocnhanvo/source-commit-actions/actions/runs/41495944119) PASS.
- Neither code commit is equivalent to production release or actual Agent acceptance.

### RUN 02 production evidence — 2026-11-03

- PHP [`79929f61`](https://github.com/ngocnhanvo/ptscps-php/commit/79929f61b6b55f17e0a67dd6429a3e9374895bcc): inventory now enumerates public post types and Thông tin chung, reports all ACF language codes. [Source tests #41502562437](https://github.com/ngocnhanvo/source-commit-actions/actions/runs/41502562437) PASS.
- [Pre-release read-only census #41502909642](https://github.com/ngocnhanvo/ptscps-actions/actions/runs/41502909642): 18/18 indexed, 719 orphan groups, legacy inventory schema.
- [Guarded PHP release and postrelease census #41503433075](https://github.com/ngocnhanvo/ptscps-actions/actions/runs/41503433075): FTPS identity, SHA-256 readback and PHP tests PASS; no Astro build/reindex. Live dynamic-language schema PASS; 20/20 eligible indexed (10 VI, 10 EN), Page 2, TablePress 16, Thông tin chung 2, Post 0, Product 0; 717 orphan groups untouched.
- **Scope of PASS:** production inventory coverage of existing eligible published sources only. No Post/Product corpus, no top-5 recall measurement, no new end-to-end LLM acceptance. RUN 03–08 remain open; RUN 07 full four-source acceptance is blocked by missing real published Post/Product records.
- Historical LLM and factual QA failures remain open until new focused evidence verifies fixes; do not repeat earlier successful backfill or delete orphan index groups.
