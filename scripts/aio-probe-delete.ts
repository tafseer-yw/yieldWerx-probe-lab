/**
 * AIO delete-endpoint probe — `npx tsx scripts/aio-probe-delete.ts [--live]`.
 *
 * `DELETE /project/{k}/testcase/{key}` returns 404, so it is not the delete
 * path — the same surprise as the update path, which turned out to be
 * `PUT /testcase/{key}/detail`. This tries the plausible variants against ONE
 * case (the first superseded CAT-01 duplicate) and stops at the first success,
 * so a wrong guess cannot cascade across the set.
 *
 * Dry-run lists what it would try. `--live` actually issues them, in order,
 * stopping at the first 2xx.
 */
import 'dotenv/config';
import { authHeader, loadConfig } from './aio-lib';

const TARGET_KEY = 'YWPD-TC-7869';

async function main(): Promise<void> {
  const live = process.argv.includes('--live');
  const cfg = loadConfig();
  const token = process.env.AIO_API_TOKEN;
  if (!token) {
    process.stdout.write('AIO_API_TOKEN not set.\n');
    process.exitCode = 1;
    return;
  }
  const auth = authHeader(cfg, token, process.env.AIO_EMAIL);
  const P = `${cfg.apiBaseUrl}/project/${cfg.projectKey}`;
  const headers = { 'Content-Type': 'application/json', Authorization: auth };

  const detail = await fetch(`${P}/testcase/${TARGET_KEY}/detail`, {
    headers: { Authorization: auth, Accept: 'application/json' },
  });
  if (!detail.ok) {
    process.stdout.write(`${TARGET_KEY} is not readable (${detail.status}) — nothing to do.\n`);
    return;
  }
  const body = (await detail.json()) as { ID?: number };
  const id = body.ID;
  process.stdout.write(`${TARGET_KEY} exists, numeric ID ${String(id)}\n\n`);

  // Archive variants first — reversible, and `isArchived` in the PUT /detail
  // body is accepted with a 2xx and silently ignored, so it must be a distinct
  // action. Delete variants after, all of which 404 or 500.
  const attempts: { method: string; suffix: string; body?: unknown }[] = [
    { method: 'POST', suffix: `/testcase/${TARGET_KEY}/archive` },
    { method: 'PUT', suffix: `/testcase/${TARGET_KEY}/archive` },
    { method: 'POST', suffix: `/testcase/archive`, body: [TARGET_KEY] },
    { method: 'POST', suffix: `/testcase/archive`, body: { keys: [TARGET_KEY] } },
    { method: 'PUT', suffix: `/testcase/${TARGET_KEY}/detail`, body: { isArchived: true } },
    { method: 'DELETE', suffix: `/testcase/${TARGET_KEY}/detail` },
    { method: 'DELETE', suffix: `/testcase/${String(id)}` },
  ];

  for (const a of attempts) {
    if (!live) {
      process.stdout.write(
        `  would try ${a.method.padEnd(6)} ${a.suffix} ${a.body ? JSON.stringify(a.body) : ''}\n`,
      );
      continue;
    }
    const res = await fetch(`${P}${a.suffix}`, {
      method: a.method,
      headers,
      body: a.body === undefined ? undefined : JSON.stringify(a.body),
    });
    const text = (await res.text()).replace(/\s+/g, ' ').slice(0, 160);
    process.stdout.write(
      `  ${a.method.padEnd(6)} ${String(res.status).padEnd(4)} ${a.suffix} ${text}\n`,
    );
    if (res.status >= 200 && res.status < 300) {
      // A 2xx proves nothing on this API — read back and check the actual state.
      const check = await fetch(`${P}/testcase/${TARGET_KEY}/detail`, {
        headers: { Authorization: auth, Accept: 'application/json' },
      });
      if (check.status === 404) {
        process.stdout.write('\n  ^ 2xx and the case is GONE — this is the delete path.\n');
        return;
      }
      const cb = (await check.json()) as { isArchived?: boolean };
      if (cb.isArchived === true) {
        process.stdout.write('\n  ^ 2xx and isArchived=true — this is the archive path.\n');
        return;
      }
      process.stdout.write('    (2xx but still present and not archived — ignored, continuing)\n');
    }
    await new Promise((z) => setTimeout(z, 250));
  }
  if (live) process.stdout.write('\n  no variant deleted the case.\n');
  else process.stdout.write('\nAdd --live to issue these.\n');
}

if (require.main === module) {
  void main().catch((err: unknown) => {
    process.stderr.write(
      `aio-probe-delete failed: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exitCode = 1;
  });
}
