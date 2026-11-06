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

## Final verification

- Build optimization: PASS. PHP source `1a85971d515b68de924efb9be3ffd67b54d3b35b`; Actions implementation `6f717d80a6561587763db88ca61ad63df578b383` (`main`).
- PHP source validation [42134458732](https://github.com/ngocnhanvo/source-commit-actions/actions/runs/42134458732): syntax and 41 filesystem assertions PASS.
- Actions source validation [42134860397](https://github.com/ngocnhanvo/source-commit-actions/actions/runs/42134860397): PASS.
- Cross-repository tests and scoped FTPS release [42134882174](https://github.com/ngocnhanvo/ptscps-actions/actions/runs/42134882174): 15/15 Python tests PASS (including actual Python → PHP reconstruction); 41 PHP assertions PASS; helper and endpoint installed with TLS, destination identity, SHA-256 readback and rollback. Only two PHP files installed.
- Native WordPress request [42135201254](https://github.com/ngocnhanvo/ptscps-actions/actions/runs/42135201254): authenticated Build Website, native status reconciliation and accepted request. This trigger result was not treated as build success.
- Locked deployment [42135313949](https://github.com/ngocnhanvo/ptscps-actions/actions/runs/42135313949), attempt 1, Actions source `dcce060f1d592abf25f5c80970fbc10e47068262`: completed/success. No independent Actions build dispatch was used.
- Compiled Astro production source: `ea539628cbf7154a19d7faa4fcb9cbe01bf67360`. No Astro source changes in this task.
- Image delta: 748/748 images reused, 15,967,988 uncompressed bytes omitted. Static delta: 42/71 public static files reused, 1,174,274 bytes omitted.
- Both pnpm store and project `.cache` restored. Sitemap unchanged: original Save revision protocol preserved; XML omitted and restored locally.
- Signed ZIP hash/provenance/activation PASS. Public `/index.html` and homepage HTTP smoke PASS.

| Measurement | Baseline 42051857639 | Optimized 42135313949 |
| --- | ---: | ---: |
| ZIP bytes | 19,166,415 | 2,862,804 |
| FTPS transfer | 41 s | 16 s |
| Astro build step | 31 s | 33 s (includes concurrent lftp readiness) |
| Separate lftp install | 29 s | folded into build |
| Whole job | 142 s | 85 s |

These are two observed production runs, with later CMS content in the optimized run. They demonstrate actual delta use and removed serial setup time; they are not a controlled benchmark or a guarantee for every build.

## Review and execution notes

- Fixed all review findings: exclusive image subtree ownership, canonical ancestor checks, 1 MiB marker fallback before deletion, explicit `unpack_delta` compatibility rejection, compiled symlink rejection even without inventory, typed HTTP fallback and exact approved PHP master SHA. No deferred review findings.
- Initial Actions request 42134661037 failed before publishing: the local source snapshot had one extra trailing newline. Recreated the exact remote baseline and verified patch applicability; corrected request 42134860397 PASS. No deploy occurred from the rejected request.
- Legacy services workflow 42134882018 was incidentally selected by its existing shared-helper push filter. Its old source-SHA guard stopped it; FTPS, CMS setup and build steps were skipped. No service migration was repeated.
- Separate News migration 42132814954 ended failure in its migration step. It was neither changed nor retried by this build-optimization task; its earlier work remains a separate follow-up.
- This optimization task is complete; do not rerun successful source validation, PHP upload or production build on recovery. Future work should use the existing WordPress build entry point and current repository HEAD.
