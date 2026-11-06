# PTSC PS build optimization

Request: bring the four PSE build/upload optimizations in the owner's screenshot to PTSC PS. Target `ptscps-actions/main`, `ptscps-php/master`; `ptscps-astro/master` remains the production source. Code mode `auto-build`; source write gate `source-commit-actions`.

## Baseline and scope

- Knowledge `main`: `6e5d1f333b7db7ce7e83c1626060ad74193ca9c2`.
- Actions HEAD `052eb0e749fe61ababb383e1f34262f20589a8e0`; PHP HEAD `1c02bd52e4ff10322d6ca7fe83f0367bc0827592`.
- Latest completed production run `42051857639` PASS. News migration `42132814954` already running: do not restart or alter its CMS work.
- Present: SHA-specific resumable FTPS, TLS certificate verification, finite timeout/retries, pnpm store and native `.cache`.
- Missing: 4 MiB socket buffer, signed image/static delta ZIP, concurrent lftp installation.
- Reference only: `psevn-actions/main` `1ef455411c4b3d345e1fbae3da7ef87224f6f1fd`, plus PSE PHP delta implementation. No reference repository writes.

## Implementation plan

Architecture: port the established signed PSE inventory/package/restore contract with PTSCPS names. Keep WordPress as the build entry point, preserve full ZIP fallback, sitemap Save token, SSR, cache keys, HMAC, checksum, destination validation and rollback.

1. Add tests for actual package/restore, stale/corrupt files, absent inventory, symlinks and forbidden paths. Add transfer boundary tests for TLS/resume/buffer and upload error propagation. Verify missing functionality first.
2. Add `ptscps-image-delta.php` and targeted hooks to `ptscps-unzip.php`: signed read-only inventory; hash-verified restoration in staging before live renames; remove private markers.
3. Port two Python packagers and manifest support; prepare lftp during the existing build; set socket buffer 4194304. Keep new homepage index and all SSR bytes in ZIP.
4. Publish PHP through the source gate with PHP contract tests, then publish Actions through the source gate with workflow validation. Scoped FTPS release installs helper before endpoint with SHA-256 readback and rollback.
5. Run cross-repo tests before release, inspect ongoing runs, then use the native WordPress Build Website workflow if no relevant build is already active. Lock the resulting run ID, stop on any non-success conclusion, verify provenance and smoke. Record actual bytes omitted and transfer/build timings.

## Review focus

- Same-size changed files must upload, not reuse.
- Live assets changed after inventory must fail verification before activation.
- Unsupported inventory must preserve full ZIP; authentication errors must fail.
- Symlink/traversal/duplicate/missing/extra assets must fail safely.
- No reuse of server SSR or mandatory client/index.html; sitemap revision handling stays intact.

## Progress

- Audit: PASS; implementation/tests: IN PROGRESS; PHP release/new build: NOT STARTED.

- Review: overlap, ancestor symlinks, marker size, capability rollback, compiled symlinks, typed HTTP fallback and approved PHP HEAD all addressed.
- Local Python: 14 PASS, 1 runner-only PHP roundtrip NOT TESTED locally; workflow/shell/Python syntax PASS.
- PHP source validation: run `42134458732` PASS, including standalone filesystem contract. No FTP or new Astro build yet.
- Baseline production run `42051857639`: job 142s, Astro step 31s, serial lftp preparation 29s, ZIP 19,166,415 bytes, FTP 41s. Different later CMS content can change build timing and size; compare transfer mechanism separately.
