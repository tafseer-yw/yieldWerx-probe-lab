/**
 * AIO Tests metadata probe — read-only endpoint/shape discovery.
 *
 * Case Sync's `--validate` push (2026-07-31) proved the create payload was
 * materially wrong: `scriptType` fell back to Classic, `tags` came back empty,
 * `labels` was absent, and the Gherkin never stored — the AIO UI shows
 * "No steps" under both the Classic and BDD/Gherkin tabs. This probe finds the
 * endpoints and field names that carry them, so the payload is reconciled
 * against the API rather than guessed a second time.
 *
 * Run:  npx tsx scripts/aio-probe-meta.ts [CASE-KEY]
 */
import 'dotenv/config';
import { authHeader, loadConfig } from './aio-lib';

async function main(): Promise<void> {
  const key = process.argv.slice(2).find((a) => !a.startsWith('-')) ?? 'YWPD-TC-7876';
  const cfg = loadConfig();
  const token = process.env.AIO_API_TOKEN;
  const email = process.env.AIO_EMAIL;
  if (!token) {
    process.stdout.write('AIO_API_TOKEN not set.\n');
    process.exitCode = 1;
    return;
  }
  const headers = { Authorization: authHeader(cfg, token, email), Accept: 'application/json' };
  const P = `/project/${cfg.projectKey}`;

  // 1. The full stored record for the validation case — what DID land.
  const detail = await fetch(`${cfg.apiBaseUrl}${P}/testcase/${key}/detail`, { headers });
  process.stdout.write(`== FULL DETAIL ${key} -> ${detail.status}\n`);
  if (detail.ok) {
    const body: unknown = await detail.json();
    process.stdout.write(`${JSON.stringify(body, null, 1).slice(0, 3000)}\n`);
  }

  // 2. Candidate step / BDD / metadata endpoints.
  const candidates = [
    `${P}/testcase/${key}/teststep`,
    `${P}/testcase/${key}/teststeps`,
    `${P}/testcase/${key}/bdd`,
    `${P}/testcase/${key}/gherkin`,
    `${P}/testcase/${key}/script`,
    `${P}/testcase/${key}/attachment`,
    `/scripttype`,
    `/testcase/scripttype`,
    `${P}/testcase/customfield`,
    `${P}/customfield`,
  ];
  process.stdout.write('\n== ENDPOINT PROBE\n');
  for (const suffix of candidates) {
    try {
      const res = await fetch(`${cfg.apiBaseUrl}${suffix}`, { headers });
      const text = (await res.text()).replace(/\s+/g, ' ');
      process.stdout.write(`${String(res.status).padEnd(4)} ${suffix}\n`);
      if (res.ok) process.stdout.write(`       ${text.slice(0, 500)}\n`);
    } catch (err) {
      process.stdout.write(
        `ERR  ${suffix} — ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }
  }
}

if (require.main === module) {
  void main().catch((err: unknown) => {
    process.stderr.write(
      `aio-probe-meta failed: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exitCode = 1;
  });
}
