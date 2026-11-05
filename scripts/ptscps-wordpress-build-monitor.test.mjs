import assert from 'node:assert/strict';
import { classifyWordPressBuildPayload, extractBuildRunId } from './ptscps-wordpress-build-monitor.mjs';

assert.equal(extractBuildRunId('https://github.com/acme/site/actions/runs/12345'), 12345);
assert.equal(extractBuildRunId('https://github.com/acme/site/actions'), null);

let state = classifyWordPressBuildPayload({ success: true, data: { status: 'loading', dashboard_url: 'https://github.com/acme/site/actions' } });
assert.equal(state.kind, 'pending');
assert.equal(state.runId, null);

state = classifyWordPressBuildPayload({ success: true, data: { status: 'loading', dashboard_url: 'https://github.com/acme/site/actions/runs/44' } });
assert.equal(state.kind, 'pending');
assert.equal(state.runId, 44);

state = classifyWordPressBuildPayload({ success: true, data: { status: 'success', dashboard_url: 'https://github.com/acme/site/actions/runs/44' } }, { lockedRunId: 44 });
assert.equal(state.kind, 'success');

state = classifyWordPressBuildPayload({ success: true, data: { status: 'error', message: 'Tiến trình build trên GitHub Actions đã thất bại (Conclusion: failure).', dashboard_url: 'https://github.com/acme/site/actions/runs/44' } }, { lockedRunId: 44 });
assert.equal(state.kind, 'failure');

state = classifyWordPressBuildPayload({ success: true, data: { status: 'error', message: 'GitHub API trả lỗi HTTP 503', dashboard_url: 'https://github.com/acme/site/actions' } });
assert.equal(state.kind, 'retryable');

state = classifyWordPressBuildPayload({ success: true, data: { status: 'error', message: 'GitHub API trả lỗi HTTP 403', dashboard_url: 'https://github.com/acme/site/actions' } });
assert.equal(state.kind, 'fatal');

state = classifyWordPressBuildPayload({ success: true, data: { status: 'loading', dashboard_url: 'https://github.com/acme/site/actions/runs/45' } }, { lockedRunId: 44 });
assert.equal(state.kind, 'fatal');

assert.equal(classifyWordPressBuildPayload({ success: true, data: { status: 'idle', dashboard_url: 'https://github.com/acme/site/actions' } }, { expectTriggered: false }).kind, 'idle');
assert.equal(classifyWordPressBuildPayload({ success: true, data: { status: 'idle', dashboard_url: 'https://github.com/acme/site/actions' } }, { expectTriggered: true }).kind, 'fatal');

console.log('HSEQ_BUILD_MONITOR_TEST=PASS');
