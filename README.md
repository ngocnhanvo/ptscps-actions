# PTSCPS Actions — WordPress-controlled deployment and read-only tests

Repository: `ngocnhanvo/ptscps-actions` (branch `main`).

## Source of truth and branches

- Astro development/testing: `ngocnhanvo/ptscps-astro` → `github`.
- Astro production source: `ngocnhanvo/ptscps-astro` → `master`.
- WordPress/PHP: `ngocnhanvo/ptscps-php` → `master`.
- Shared Chromium testing: `ngocnhanvo/knowledge-actions` (reusable workflow, no copying tests).
- See `ngocnhanvo/knowledge` → `main` for the shared engineering rules.

## Build Website

Only the WordPress admin **Build Website** control dispatches `wp_trigger_build` to
`.github/workflows/ptscps-production-deploy.yml`. The workflow checks out Astro
`master`, validates `WC_URL` and `WC_URL_CLIENT` from `ENV_FILE`, builds the
production source, packages the public Astro assets, and activates the archive
through the signed `ptscps-unzip.php` endpoint. No site domain, FTP target,
WordPress database name, or Google OAuth credential is hardcoded.

WordPress must configure `VCS_GH_OWNER` and `VCS_GH_REPO` in its own
`wp-config.php`. The MU plugin must not silently override the destination.
The unzip endpoint retains HMAC authentication, timestamp validation, ZIP SHA-256
verification and destination path checks.

## Separate operations

- `ptscps-shared-playwright.yml`: manual, read-only `smoke`,
  `wordpress-site-health` or `wordpress-build-trigger-audit`. It derives both
  origins from `ENV_FILE`; WordPress checks require `WP_ADMIN_USERNAME` and
  `WP_ADMIN_PASSWORD`. To compare DB identities without baking in old tenant
  values, configure optional GitHub Actions repository **Variables**
  `PTSCPS_EXPECTED_DB_SHA256` and `PTSCPS_DISALLOWED_DB_SHA256`.
- `ptscps-php-release.yml`: manual PHP-only FTPS deployment, requires
  `confirm=DEPLOY_PHP`. It does **not** build Astro.

Expected repo secrets for supported operations: `ENV_FILE`, `SOURCE_REPO_PAT`,
`FTP_SERVER`, `FTP_USERNAME`, `FTP_PASSWORD`, and optionally the
WordPress admin credentials used only by browser tests. Configure these for
each cloned project; do not reuse a previous customer's endpoints or data.

In code mode **normal**, source changes and source-only tests are allowed.
Do not dispatch the production build or upload WordPress files over FTP without
explicit approval. Never assume a sanitized source tree implies a sanitized
live WordPress database.

## RAG rebuild RUN03 (2026-11-03)

- Read-only retrieval evidence: [Actions run #41513823111](https://github.com/ngocnhanvo/ptscps-actions/actions/runs/41513823111), PHP guarded FTPS PASS, top-5 retrieval QA FAIL (6/20 source anchors, 1/4 natural probes, 0 wrong-locale hits).
- Detailed source IDs/queries/top-5 are encrypted in [artifact #13174018382](https://github.com/ngocnhanvo/ptscps-actions/actions/runs/41513823111/artifacts/13174018382). The public summary has aggregate metrics only.
- RUN03 remains open for evidence-based ranking diagnosis; RUN07 four-source acceptance is BLOCKED on real published Post/Product corpus. See `docs/agent-rebuild/STATUS.md` for current checkpoint.
- Latest stage-level production read-only audit: [#41539146177](https://github.com/ngocnhanvo/ptscps-actions/actions/runs/41539146177) PASS for guarded PHP release and diagnostic execution, but retrieval QA FAIL (7/24 top-5 hits, 17 misses, zero wrong-locale). Miss gates: 4 no meaningful tokens, 1 SQL lexical miss, 2 token coverage, 10 strong-authoritative collapse. [Aggregate artifact #13185153830](https://github.com/ngocnhanvo/ptscps-actions/actions/runs/41539146177/artifacts/13185153830). Keep factual answer acceptance separate; no reindex, LLM quota or Astro build.
