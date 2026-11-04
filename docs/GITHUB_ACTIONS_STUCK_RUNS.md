# PTSCPS migration GitHub Actions — hung-run recovery

Scope: `.github/workflows/ptscps-design-service-parity.yml` on `main`. The migration **writes** WordPress content. The failed assertion from 2026-11-04 (`Product menu_order mismatch`) is a script failure (exit code 1), **not** proof of a hung runner.

## What a yellow spinner means

The `Run node ...` step can finish with exit code 1 while the overall run still shows `in_progress` (UI refresh lag, incomplete run finalization, or actual platform/runner issue). A completed `Complete job` step is not an authoritative workflow-run status. The GitHub Actions **run API** is the source of truth for status/conclusion; if it remains `in_progress`, the run has not been finalized on GitHub.

## Built-in protections

- `migrate` has a 25-minute job timeout.
- The migration step has a 22-minute timeout, with GNU `timeout` issuing TERM after 20 minutes and KILL after 10 extra seconds. This bounds the Node/Chromium process, **not GitHub's own status synchronization**.
- The migration concurrency group intentionally uses `cancel-in-progress: false` to avoid interrupting a WordPress write.
- Editing a workflow YAML file alone does **not** trigger another migration. Only the ready marker or migration script changes on `main` trigger this job.
- There is no automatic force-cancel and no automatic retry of production data writes.

## Inspect and recover a stuck run

1. Refresh GitHub Actions and check the run's **Status** and **Conclusion** using `gh run view RUN_ID --repo ngocnhanvo/ptscps-actions --json status,conclusion,startedAt,updatedAt`.
2. If `status=completed`, the workflow finished; investigate the failing step separately.
3. If `status=in_progress` past the job timeout, first click **Cancel workflow** on the run. Give GitHub a chance to acknowledge it.
4. If it remains stuck, open **Actions → PTSCPS migration stuck-run recovery → Run workflow**. Enter the **database run ID from the URL**, not the displayed `#7`. Choose `inspect` first.
5. To force-cancel only that stuck migration run, choose `force_cancel` and enter the exact confirmation `FORCE_CANCEL`. The recovery job checks the workflow identity and requires the run to be active for at least 30 minutes. GitHub may still take time to update the status; this cannot repair a GitHub service-side inconsistency.

CLI alternative (only after identifying the exact run):

```bash
gh api --method POST repos/ngocnhanvo/ptscps-actions/actions/runs/RUN_ID/force-cancel
```

**Warning:** a failed/cancelled migration can have partially updated WordPress. Do not blindly rerun; inspect the database/remote state or rely on the migration's verified idempotency. A forced cancellation can release concurrency for future runs, but cannot guarantee an immediate GitHub UI update. If the API continues to report an active run even after force-cancel, raise a GitHub Support incident with the run URL and timestamps.
