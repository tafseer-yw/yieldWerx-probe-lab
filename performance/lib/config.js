/*
 * k6 run configuration — profiles, thresholds, and the safety gate.
 *
 * Ported from test-ops/e2e (the proven integration) with one structural
 * difference: there is no throwaway reference API here, because probe-lab IS a
 * local, seedable, disposable app — k6 in Docker reaches it on the host
 * through host.docker.internal. Start it first: `npm run app:dev`.
 *
 * Profiles are data selected by PERF_PROFILE; an unknown name refuses rather
 * than guessing. `smoke` proves the script is correct; the louder profiles
 * answer load questions and are locked behind PERF_ALLOW_LOAD so nobody
 * generates load by accident.
 */

const profiles = {
  smoke: {
    executor: 'shared-iterations',
    vus: 1,
    iterations: 1,
    maxDuration: '30s',
  },
  load: {
    executor: 'ramping-vus',
    startVUs: 0,
    stages: [
      { duration: '30s', target: 10 },
      { duration: '2m', target: 10 },
      { duration: '30s', target: 0 },
    ],
    gracefulRampDown: '15s',
  },
  stress: {
    executor: 'ramping-vus',
    startVUs: 0,
    stages: [
      { duration: '30s', target: 10 },
      { duration: '1m', target: 25 },
      { duration: '1m', target: 50 },
      { duration: '30s', target: 0 },
    ],
    gracefulRampDown: '15s',
  },
  spike: {
    executor: 'ramping-vus',
    startVUs: 0,
    stages: [
      { duration: '15s', target: 5 },
      { duration: '10s', target: 75 },
      { duration: '30s', target: 75 },
      { duration: '15s', target: 0 },
    ],
    gracefulRampDown: '10s',
  },
  endurance: {
    executor: 'constant-vus',
    vus: 10,
    duration: '30m',
    gracefulStop: '30s',
  },
};

export const profileName = (__ENV.PERF_PROFILE || 'smoke').toLowerCase();
if (!Object.hasOwn(profiles, profileName)) {
  throw new Error(
    `Unknown PERF_PROFILE '${profileName}'. Use smoke, load, stress, spike, or endurance.`,
  );
}

export const baseUrl = (__ENV.PERF_BASE_URL || 'http://host.docker.internal:5000').replace(
  /\/$/,
  '',
);
export const targetEnvironment = (__ENV.PERF_ENV || 'local').toLowerCase();
export const p95Milliseconds = positiveInteger(__ENV.PERF_P95_MS || '750', 'PERF_P95_MS');

/**
 * The full k6 options object for one scenario function, with a per-operation
 * p95 threshold generated for every operation the scenario names — so a slow
 * endpoint is named in the failure, not hidden inside a global average.
 */
export function scenarioOptions(exec, operations = []) {
  const operationThresholds = Object.fromEntries(
    operations.map((operation) => [
      `http_req_duration{operation:${operation}}`,
      [`p(95)<${p95Milliseconds}`],
    ]),
  );
  return {
    scenarios: {
      [profileName]: {
        ...profiles[profileName],
        exec,
        tags: { profile: profileName, test_type: 'performance', protocol: 'api' },
      },
    },
    thresholds: {
      checks: ['rate>0.99'],
      business_errors: ['rate<0.01'],
      http_req_failed: ['rate<0.01'],
      http_req_duration: [`p(95)<${p95Milliseconds}`],
      ...operationThresholds,
    },
    setupTimeout: '30s',
    teardownTimeout: '30s',
    discardResponseBodies: false,
    noConnectionReuse: false,
    userAgent: 'probe-lab-k6-performance/1.0',
  };
}

/**
 * Fail-closed target gate, called in setup() before any traffic:
 * - a load-generating profile needs PERF_ALLOW_LOAD=true;
 * - a non-local target needs PERF_ALLOW_EXTERNAL=true and HTTPS;
 * - production needs PERF_ALLOW_PRODUCTION=true AND a change ticket.
 * The same rule shape as /yw:scan-security: never assume a target is fine.
 */
export function assertSafeTarget(...targets) {
  /* k6's runtime has no URL global (found the hard way: ReferenceError in
     setup), so the two facts the gate needs — scheme and hostname — are read
     with a plain match instead. A target that does not parse is refused. */
  const parse = (target) => {
    const match = /^(https?):\/\/([^/:?#]+)/.exec(target);
    if (!match) throw new Error(`Unparseable performance target: ${target}`);
    return { protocol: `${match[1]}:`, hostname: match[2] };
  };
  const urls = (targets.length > 0 ? targets : [baseUrl]).map(parse);
  const localHosts = new Set(['127.0.0.1', 'localhost', 'host.docker.internal']);
  const externalUrls = urls.filter((url) => !localHosts.has(url.hostname));
  const loadGenerating = profileName !== 'smoke';
  const looksProduction = targetEnvironment === 'production' || targetEnvironment === 'prod';

  if (loadGenerating && !enabled(__ENV.PERF_ALLOW_LOAD)) {
    throw new Error(
      'Load generation is locked. Set PERF_ALLOW_LOAD=true after reviewing the profile.',
    );
  }
  if (externalUrls.length > 0 && !enabled(__ENV.PERF_ALLOW_EXTERNAL)) {
    throw new Error(
      'External targets are locked. Set PERF_ALLOW_EXTERNAL=true for an authorized test environment.',
    );
  }
  if (looksProduction) {
    if (!enabled(__ENV.PERF_ALLOW_PRODUCTION) || !(__ENV.PERF_CHANGE_TICKET || '').trim()) {
      throw new Error(
        'Production requires PERF_ALLOW_PRODUCTION=true and a non-empty PERF_CHANGE_TICKET.',
      );
    }
  }
  if (externalUrls.some((url) => url.protocol !== 'https:')) {
    throw new Error('External performance targets must use HTTPS.');
  }
}

export function requestHeaders(token, runId) {
  const headers = {
    'content-type': 'application/json',
    accept: 'application/json',
    'x-performance-run-id': runId,
  };
  if (token) headers.authorization = `Bearer ${token}`;
  return headers;
}

function enabled(value) {
  return /^(1|true|yes)$/i.test(value || '');
}

function positiveInteger(value, name) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0)
    throw new Error(`${name} must be a positive integer.`);
  return parsed;
}
