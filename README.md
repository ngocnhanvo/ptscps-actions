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
