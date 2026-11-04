# PTSCPS Playwright / Chromium runtime standard

For project-specific migration, WordPress admin operations and browser QA scripts:

- Run the Chromium job inside `mcr.microsoft.com/playwright:v1.64.0-noble` with `options: --ipc=host`.
- Install only the matching Node package: `npm install --no-save --no-package-lock --ignore-scripts --no-audit --no-fund playwright@1.64.0`.
- **Do not use** `npx playwright install --with-deps chromium` in these image-backed jobs. The browser and Ubuntu dependencies already exist in the image.
- If a workflow has multiple jobs, configure the image only for the job that launches Chromium; do not change release/utility jobs or their permissions.
- Preserve `on`, `if`, `concurrency`, `timeout-minutes`, secrets and actual script behavior. Avoid auto-running a migration merely to test its browser installation.
- Run only approved smoke/read-only tests when verifying runtime. Production WordPress writes or deploys need their existing, explicit run gates.

For centralized **read-only** smoke, WordPress Site Health and build-trigger browser checks, call `ngocnhanvo/knowledge-actions/.github/workflows/playwright.yml@main`. This shared workflow is not a replacement for project-specific write-capable migration scripts.

GitHub-hosted runners are ephemeral and can still require downloading the Docker image. This removes the per-job apt/Chromium installation, not necessarily all container startup time.

Applied to the PTSCPS browser-install workflows on 2026-11-04. Existing compatible container-based and shared-Playwright workflows were retained.
