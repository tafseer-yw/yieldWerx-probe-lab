import { check, sleep } from 'k6';
import http from 'k6/http';
import { Rate } from 'k6/metrics';

import {
  assertSafeTarget,
  baseUrl,
  profileName,
  requestHeaders,
  scenarioOptions,
} from '../lib/config.js';
import { performanceSummary } from '../lib/summary.js';

/*
 * The read journey a yield engineer actually takes: sign in, list wafers, run
 * the bin pareto report, download it as CSV. Read-only by design — the write
 * path (upload) stays out of the workload until cleanup under load is a solved
 * problem, the same reasoning test-ops applied to its CRUD scenario.
 *
 * Functional correctness stays inside the load test: every response is checked
 * for status AND shape, and failures feed business_errors. A p95 of 50ms means
 * nothing if the endpoint is returning garbage quickly.
 */

export const options = scenarioOptions('waferReports', [
  'list_wafers',
  'bin_pareto',
  'bin_pareto_csv',
]);

const businessErrors = new Rate('business_errors');

export function setup() {
  assertSafeTarget();

  const login = http.post(
    `${baseUrl}/api/auth/login`,
    JSON.stringify({
      username: __ENV.PERF_USERNAME || 'qa',
      password: __ENV.PERF_PASSWORD || 'qa',
    }),
    { headers: { 'content-type': 'application/json' }, tags: { operation: 'login' } },
  );
  if (login.status !== 200) {
    throw new Error(
      `Sign-in failed (${login.status}). Is the app running? Start it with: npm run app:dev`,
    );
  }
  const token = login.json('accessToken');

  /* The workload needs at least one wafer to report on. Refusing beats
     measuring an empty database and calling it fast. */
  const wafers = http.get(`${baseUrl}/api/wafers?pageSize=1`, {
    headers: requestHeaders(token, 'setup'),
  });
  const first = wafers.json('items.0.waferSequence');
  if (!first) {
    throw new Error(
      'No wafers in the database — load a sample wafer first (Sample wafers, as admin).',
    );
  }
  return { token, waferSequence: first, profile: profileName };
}

export function waferReports(context) {
  const runId = `${context.profile}-${__VU}-${__ITER}`;
  const headers = requestHeaders(context.token, runId);

  const list = http.get(`${baseUrl}/api/wafers?pageSize=25`, {
    headers,
    tags: { operation: 'list_wafers' },
  });
  const listPassed = check(list, {
    'wafer list returns 200': (response) => response.status === 200,
    'wafer list has items': (response) => Array.isArray(response.json('items')),
  });
  businessErrors.add(!listPassed, { operation: 'list_wafers' });

  const report = http.get(
    `${baseUrl}/api/reports/wafers/${context.waferSequence}/bin-pareto?specifyBins=All%20Bins`,
    { headers, tags: { operation: 'bin_pareto' } },
  );
  const reportPassed = check(report, {
    'report returns 200': (response) => response.status === 200,
    'report carries bins': (response) => Array.isArray(response.json('bins')),
    'report yield is a number': (response) => typeof response.json('header.yield') === 'number',
  });
  businessErrors.add(!reportPassed, { operation: 'bin_pareto' });

  const csv = http.get(
    `${baseUrl}/api/reports/wafers/${context.waferSequence}/bin-pareto.csv?specifyBins=All%20Bins`,
    { headers: { ...headers, accept: 'text/csv' }, tags: { operation: 'bin_pareto_csv' } },
  );
  const csvPassed = check(csv, {
    'csv returns 200': (response) => response.status === 200,
    'csv is text/csv': (response) =>
      String(response.headers['Content-Type'] || '').includes('text/csv'),
    'csv carries the table header': (response) =>
      String(response.body).includes('Bin number,Bin name,Die count,Bin %,Cumulative %'),
  });
  businessErrors.add(!csvPassed, { operation: 'bin_pareto_csv' });

  sleep(0.3);
}

export function handleSummary(data) {
  return performanceSummary(data);
}
