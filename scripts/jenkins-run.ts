/**
 * Trigger a build of the local `probe-lab-e2e` Jenkins job and stream its
 * console — `npm run jenkins:run`. The controller is started by `npm run
 * jenkins:up` (ci/local/); this only drives it.
 *
 * Talks to Jenkins over its REST API: fetch a CSRF crumb, POST the build,
 * follow the queue item to the build, stream progressive console text, and
 * exit non-zero if the build did not finish SUCCESS — so CI-style automation
 * can gate on it.
 *
 * Credentials and URL come from the environment, defaulting to the values
 * ci/local/casc.yaml seeds (admin/admin on :8080).
 */
import { setTimeout as sleep } from 'node:timers/promises';

const JOB_NAME = 'probe-lab-e2e';

interface Conn {
  baseUrl: string;
  authHeader: string;
}

interface Crumb {
  header: Record<string, string>;
  cookie?: string;
}

function connect(): Conn {
  const baseUrl = (process.env.JENKINS_URL ?? 'http://localhost:8080').replace(/\/$/, '');
  const user = process.env.JENKINS_ADMIN_USER ?? 'admin';
  const password = process.env.JENKINS_ADMIN_PASSWORD ?? 'admin';
  return { baseUrl, authHeader: `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}` };
}

/** Jenkins' default crumb issuer ties the crumb to the issuing session. */
async function fetchCrumb(conn: Conn): Promise<Crumb> {
  const response = await fetch(`${conn.baseUrl}/crumbIssuer/api/json`, {
    headers: { Authorization: conn.authHeader },
  });
  if (!response.ok) return { header: {} }; // issuer disabled — proceed without
  const body = (await response.json()) as { crumbRequestField: string; crumb: string };
  const cookie = response.headers.get('set-cookie') ?? undefined;
  return { header: { [body.crumbRequestField]: body.crumb }, cookie };
}

async function triggerBuild(conn: Conn, crumb: Crumb): Promise<string> {
  const response = await fetch(`${conn.baseUrl}/job/${JOB_NAME}/build`, {
    method: 'POST',
    headers: {
      Authorization: conn.authHeader,
      ...crumb.header,
      ...(crumb.cookie ? { Cookie: crumb.cookie } : {}),
    },
  });
  if (response.status === 404) {
    throw new Error(
      `Job '${JOB_NAME}' not found. Is the controller up and seeded? Try: npm run jenkins:up`,
    );
  }
  if (response.status !== 201) {
    throw new Error(
      `Build request failed (${response.status}). Check credentials and that Jenkins is up.`,
    );
  }
  const queueUrl = response.headers.get('location');
  if (!queueUrl)
    throw new Error('Jenkins accepted the build but returned no queue item to follow.');
  return queueUrl.replace(/\/$/, '');
}

/** Follow a queue item until Jenkins assigns it a build URL (or it is cancelled). */
async function awaitBuildUrl(conn: Conn, queueUrl: string): Promise<string> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const response = await fetch(`${queueUrl}/api/json`, {
      headers: { Authorization: conn.authHeader },
    });
    if (response.ok) {
      const body = (await response.json()) as {
        cancelled?: boolean;
        executable?: { url: string };
        why?: string;
      };
      if (body.cancelled) throw new Error('The queued build was cancelled.');
      if (body.executable?.url) return body.executable.url.replace(/\/$/, '');
    }
    await sleep(1000);
  }
  throw new Error('Timed out waiting for the build to leave the queue.');
}

/** Stream the console until the build stops producing output, then read its result. */
async function streamConsole(conn: Conn, buildUrl: string): Promise<string> {
  let start = 0;
  for (;;) {
    const response = await fetch(`${buildUrl}/logText/progressiveText?start=${start}`, {
      headers: { Authorization: conn.authHeader },
    });
    const text = await response.text();
    if (text.length > 0) process.stdout.write(text);
    start = Number(response.headers.get('x-text-size') ?? start);
    if (response.headers.get('x-more-data') !== 'true') break;
    await sleep(1500);
  }
  const status = await fetch(`${buildUrl}/api/json?tree=result`, {
    headers: { Authorization: conn.authHeader },
  });
  const body = (await status.json()) as { result: string | null };
  return body.result ?? 'UNKNOWN';
}

async function main(): Promise<void> {
  const conn = connect();
  process.stdout.write(`Triggering ${JOB_NAME} on ${conn.baseUrl} …\n`);
  const crumb = await fetchCrumb(conn);
  const queueUrl = await triggerBuild(conn, crumb);
  const buildUrl = await awaitBuildUrl(conn, queueUrl);
  process.stdout.write(`Build: ${buildUrl}\n\n`);
  const result = await streamConsole(conn, buildUrl);
  process.stdout.write(`\nBuild finished: ${result}\n`);
  process.stdout.write(
    `Allure report: open ${buildUrl}/allure  (or npm run allure:open after archiving)\n`,
  );
  process.exit(result === 'SUCCESS' ? 0 : 1);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(2);
});
