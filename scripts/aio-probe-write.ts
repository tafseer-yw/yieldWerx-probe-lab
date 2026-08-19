/**
 * AIO Tests write-surface probe — read-only-ish endpoint discovery for UPDATE
 * and STEP writes against ONE validation case.
 *
 * Findings so far (2026-07-31, from Case Sync's `--validate` push):
 *   - POST /project/{k}/testcase                     → create works
 *   - PUT  /project/{k}/testcase/{caseKey}           → 404 (the sync script's
 *     "idempotent update" path has never worked)
 *   - GET  /project/{k}/testcase/{caseKey}/detail    → works
 *   - scriptType/tags are ID-keyed objects; there is no `labels` field in the
 *     stored model at all, and `steps` is an array on the case record.
 *
 * Run:  npx tsx scripts/aio-probe-write.ts YWPD-TC-7876 8615
 */
import 'dotenv/config';
import { authHeader, loadConfig } from './aio-lib';

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  const key = args[0] ?? 'YWPD-TC-7876';
  const id = args[1] ?? '8615';
  const cfg = loadConfig();
  const token = process.env.AIO_API_TOKEN;
  const email = process.env.AIO_EMAIL;
  if (!token) {
    process.stdout.write('AIO_API_TOKEN not set.\n');
    process.exitCode = 1;
    return;
  }
  const auth = authHeader(cfg, token, email);
  const P = `${cfg.apiBaseUrl}/project/${cfg.projectKey}`;

  const attempts: { method: string; suffix: string; body: unknown }[] = [
    {
      method: 'PUT',
      suffix: `/testcase/${key}/detail`,
      body: { title: undefined, precondition: 'probe' },
    },
    { method: 'PATCH', suffix: `/testcase/${key}`, body: { precondition: 'probe' } },
    { method: 'PUT', suffix: `/testcase/${id}`, body: { precondition: 'probe' } },
    { method: 'PUT', suffix: `/testcase/${id}/detail`, body: { precondition: 'probe' } },
    { method: 'POST', suffix: `/testcase/${key}/step`, body: [{ step: 'probe step' }] },
    { method: 'POST', suffix: `/testcase/${key}/steps`, body: [{ step: 'probe step' }] },
    { method: 'PUT', suffix: `/testcase/${key}/step`, body: [{ step: 'probe step' }] },
    { method: 'POST', suffix: `/testcase/${key}/teststep`, body: [{ step: 'probe step' }] },
  ];

  for (const a of attempts) {
    try {
      const res = await fetch(`${P}${a.suffix}`, {
        method: a.method,
        headers: { 'Content-Type': 'application/json', Authorization: auth },
        body: JSON.stringify(a.body),
      });
      const text = (await res.text()).replace(/\s+/g, ' ');
      process.stdout.write(`${a.method.padEnd(6)} ${String(res.status).padEnd(4)} ${a.suffix}\n`);
      if (text) process.stdout.write(`             ${text.slice(0, 220)}\n`);
    } catch (err) {
      process.stdout.write(
        `${a.method.padEnd(6)} ERR  ${a.suffix} — ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }
  }
}

if (require.main === module) {
  void main().catch((err: unknown) => {
    process.stderr.write(
      `aio-probe-write failed: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exitCode = 1;
  });
}
