import { profileName, targetEnvironment } from './config.js';

/**
 * Machine-readable run summary under reports/k6/ — a contract other tools can
 * read (the ledger, CI, a trend script), not console text that scrolls away.
 */
export function performanceSummary(data) {
  const path = __ENV.PERF_SUMMARY_PATH || `reports/k6/${profileName}-summary.json`;
  const summary = {
    schemaVersion: 1,
    profile: profileName,
    environment: targetEnvironment,
    generatedAt: new Date().toISOString(),
    metrics: {
      checks: metricValues(data, 'checks'),
      businessErrors: metricValues(data, 'business_errors'),
      requests: metricValues(data, 'http_reqs'),
      failedRequests: metricValues(data, 'http_req_failed'),
      requestDuration: metricValues(data, 'http_req_duration'),
    },
  };
  const p95 = summary.metrics.requestDuration['p(95)'];
  const failedRate = summary.metrics.failedRequests.rate;
  return {
    [path]: JSON.stringify(summary, null, 2),
    stdout: `\nk6 ${profileName} complete: p95=${format(p95)}ms, failed-rate=${format(failedRate)}\nsummary: ${path}\n`,
  };
}

function metricValues(data, name) {
  return data.metrics[name] ? data.metrics[name].values : {};
}

function format(value) {
  return typeof value === 'number' ? value.toFixed(3) : 'n/a';
}
