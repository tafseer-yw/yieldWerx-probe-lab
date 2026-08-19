/**
 * AIO run-history probe — proves the de-duplication safety check can actually fire.
 *
 * `aio-dedupe-cases.ts` refuses to delete a case that has execution history. That
 * guard is only worth anything if the endpoint it queries EXISTS: if every probe
 * 404s, "no history" is a guaranteed zero and the guard silently permits every
 * deletion — the exact defect class (CD-01 / CI-04) this repo has been removing.
 *
 * This prints the raw status of each candidate endpoint so the guard can be
 * pointed at one that genuinely returns rows, and looks for any case in the
 * project that HAS a run, as a positive control.
 */
import 'dotenv/config';
import { authHeader, loadConfig } from './aio-lib';

async function main(): Promise<void> {
  const key = process.argv.slice(2).find((a) => !a.startsWith('-')) ?? 'YWPD-TC-7869';
  const cfg = loadConfig();
  const token = process.env.AIO_API_TOKEN;
  if (!token) {
    process.stdout.write('AIO_API_TOKEN not set.\n');
    process.exitCode = 1;
    return;
  }
  const auth = authHeader(cfg, token, process.env.AIO_EMAIL);
  const P = `${cfg.apiBaseUrl}/project/${cfg.projectKey}`;
  const read = { Authorization: auth, Accept: 'application/json' };

  const get = async (s: string): Promise<{ status: number; body: string }> => {
    for (let a = 0; a < 5; a++) {
      const r = await fetch(`${P}${s}`, { headers: read });
      if (r.status === 429) {
        await new Promise((z) => setTimeout(z, 3000 * 2 ** a));
        continue;
      }
      return { status: r.status, body: (await r.text()).replace(/\s+/g, ' ').slice(0, 200) };
    }
    return { status: 429, body: '' };
  };

  process.stdout.write(`== per-case endpoints on ${key}\n`);
  for (const s of [
    `/testcase/${key}/run`,
    `/testcase/${key}/runs`,
    `/testcase/${key}/execution`,
    `/testcase/${key}/executions`,
    `/testcase/${key}/cycle`,
    `/testcase/${key}/result`,
  ]) {
    const r = await get(s);
    process.stdout.write(
      `  ${String(r.status).padEnd(4)} ${s}  ${r.status === 200 ? r.body : ''}\n`,
    );
    await new Promise((z) => setTimeout(z, 200));
  }

  process.stdout.write('\n== project-level cycle/run surfaces (a positive control)\n');
  for (const s of ['/cycle', '/testcycle', '/run', '/testrun']) {
    const r = await get(s);
    process.stdout.write(
      `  ${String(r.status).padEnd(4)} ${s}  ${r.status === 200 ? r.body : ''}\n`,
    );
    await new Promise((z) => setTimeout(z, 200));
  }

  // Every per-case endpoint 404s, so run history is NOT reachable from the case.
  // `/testcycle` is the live surface: find the cycle->case endpoint so the
  // de-duplication guard can query something that genuinely returns rows.
  process.stdout.write('\n== cycles, and how to list the cases inside one\n');
  const cycles = await get('/testcycle');
  const ids = [...cycles.body.matchAll(/"key":"(YWPD-CY-[^"]+)"/g)].map((m) => m[1]).slice(0, 3);
  process.stdout.write(`  cycles found: ${ids.join(', ') || 'none parsed'}\n`);
  for (const c of ids) {
    for (const suffix of ['/testcase', '/testrun', '/run', '/case']) {
      const r = await get(`/testcycle/${c}${suffix}`);
      process.stdout.write(
        `  ${String(r.status).padEnd(4)} /testcycle/${c}${suffix}  ${r.status === 200 ? r.body.slice(0, 160) : ''}\n`,
      );
      await new Promise((z) => setTimeout(z, 200));
    }
  }
}

if (require.main === module) {
  void main().catch((err: unknown) => {
    process.stderr.write(
      `aio-probe-history failed: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exitCode = 1;
  });
}
