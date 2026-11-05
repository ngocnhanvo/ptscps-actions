const RUN_URL_RE = /\/actions\/runs\/(\d+)(?:$|[/?#])/;

export function extractBuildRunId(url) {
  const match = RUN_URL_RE.exec(String(url || ''));
  return match ? Number(match[1]) : null;
}

export function classifyWordPressBuildPayload(payload, { lockedRunId = null, expectTriggered = true } = {}) {
  if (!payload || payload.success !== true || !payload.data || typeof payload.data !== 'object') {
    return { kind: 'fatal', message: 'WordPress build status returned an invalid payload' };
  }

  const data = payload.data;
  const status = String(data.status || '');
  const message = String(data.message || data.last_build_status || status || 'unknown');
  const runUrl = String(data.dashboard_url || '');
  const runId = extractBuildRunId(runUrl);

  if (lockedRunId && runId && Number(runId) !== Number(lockedRunId)) {
    return { kind: 'fatal', message: 'WordPress build status switched run id from ' + lockedRunId + ' to ' + runId, runId, runUrl, status };
  }

  if (status === 'success') {
    if (!runId) return { kind: 'fatal', message: 'Build succeeded without an exact GitHub run URL', status, runUrl };
    return { kind: 'success', message, runId, runUrl, status };
  }

  if (status === 'loading') return { kind: 'pending', message, runId, runUrl, status };

  if (status === 'idle') {
    return expectTriggered
      ? { kind: 'fatal', message: 'WordPress reported idle before the triggered build completed', runId, runUrl, status }
      : { kind: 'idle', message, runId, runUrl, status };
  }

  if (status === 'error') {
    if (runId || /Conclusion\s*:/i.test(message) || /build.+(thất bại|failed)/i.test(message)) {
      return { kind: 'failure', message, runId, runUrl, status };
    }
    if (/HTTP\s*(429|5\d\d)/i.test(message) || /tạm mất kết nối|timeout|temporar/i.test(message)) {
      return { kind: 'retryable', message, runId, runUrl, status };
    }
    return { kind: 'fatal', message, runId, runUrl, status };
  }

  return { kind: 'fatal', message: 'Unknown WordPress build status: ' + (status || '(empty)'), runId, runUrl, status };
}

async function readStatus(page, requestTimeoutMs) {
  return page.evaluate(async timeoutMs => {
    const cfg = globalThis.vcsBuild || {};
    if (!cfg.ajax_url || !cfg.nonce) return { transportError: 'WordPress build status AJAX configuration missing' };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const body = new URLSearchParams({ action: 'vcs_check_build_status', nonce: String(cfg.nonce) });
      const response = await fetch(String(cfg.ajax_url), {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
        body: body.toString(),
        signal: controller.signal,
      });
      const text = await response.text();
      let json = null;
      try { json = JSON.parse(text); } catch {}
      return { httpStatus: response.status, json };
    } catch (error) {
      return { transportError: String(error?.name || error?.message || error) };
    } finally {
      clearTimeout(timer);
    }
  }, requestTimeoutMs);
}

export async function waitForWordPressBuild({
  page,
  log = () => {},
  expectTriggered = true,
  discoveryTimeoutMs = 180000,
  buildTimeoutMs = 900000,
  pollIntervalMs = 10000,
  requestTimeoutMs = 20000,
}) {
  const started = Date.now();
  const discoveryDeadline = started + discoveryTimeoutMs;
  const buildDeadline = started + buildTimeoutMs;
  let lockedRunId = null;
  let lockedRunUrl = '';
  let consecutiveReadErrors = 0;
  let lastLogAt = 0;
  let lastStateKey = '';

  while (true) {
    const now = Date.now();
    if (!lockedRunId && expectTriggered && now >= discoveryDeadline) {
      throw new Error('WordPress build run was not discovered within ' + Math.round(discoveryTimeoutMs / 1000) + 's');
    }
    if (now >= buildDeadline) {
      throw new Error('WordPress build did not complete within ' + Math.round(buildTimeoutMs / 1000) + 's' + (lockedRunId ? ' (run ' + lockedRunId + ')' : ''));
    }

    const raw = await readStatus(page, requestTimeoutMs);
    if (raw.transportError || Number(raw.httpStatus || 0) !== 200) {
      consecutiveReadErrors += 1;
      const code = raw.transportError || ('HTTP ' + (raw.httpStatus || 0));
      log('BUILD_MONITOR_RETRY', { attempt: consecutiveReadErrors, error: code, runId: lockedRunId });
      if (consecutiveReadErrors >= 4) throw new Error('WordPress build status unavailable after ' + consecutiveReadErrors + ' attempts: ' + code);
      await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
      continue;
    }

    const state = classifyWordPressBuildPayload(raw.json, { lockedRunId, expectTriggered });
    if (state.runId && !lockedRunId) {
      lockedRunId = state.runId;
      lockedRunUrl = state.runUrl;
      log('BUILD_RUN_LOCKED', { runId: lockedRunId, runUrl: lockedRunUrl });
    }
    consecutiveReadErrors = 0;

    const stateKey = state.kind + ':' + (state.status || '') + ':' + (lockedRunId || '');
    if (stateKey !== lastStateKey || now - lastLogAt >= 30000) {
      log('BUILD_MONITOR', {
        kind: state.kind,
        status: state.status || '',
        runId: lockedRunId,
        runUrl: lockedRunUrl || state.runUrl || '',
        elapsedSeconds: Math.round((now - started) / 1000),
        remainingSeconds: Math.max(0, Math.round((buildDeadline - now) / 1000)),
      });
      lastStateKey = stateKey;
      lastLogAt = now;
    }

    if (state.kind === 'success') return { status: 'success', runId: lockedRunId, runUrl: lockedRunUrl || state.runUrl };
    if (state.kind === 'idle') return { status: 'idle', runId: lockedRunId, runUrl: lockedRunUrl };
    if (state.kind === 'failure' || state.kind === 'fatal') {
      throw new Error('WordPress build monitor ' + state.kind + ': ' + state.message + (lockedRunId ? ' (run ' + lockedRunId + ')' : ''));
    }
    if (state.kind === 'retryable') {
      consecutiveReadErrors += 1;
      if (consecutiveReadErrors >= 4) throw new Error('WordPress build status repeatedly failed: ' + state.message);
    }

    await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
  }
}
