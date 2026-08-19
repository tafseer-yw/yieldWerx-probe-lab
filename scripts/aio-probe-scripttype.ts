/**
 * AIO Tests scriptType + BDD-steps probe.
 *
 * Reverse-engineering log (2026-07-31, Case Sync validation on YWPD-TC-7876):
 *   - POST /project/{k}/testcase                  → create
 *   - PUT  /project/{k}/testcase/{key}            → 404  (NOT the update path;
 *     the sync script's "idempotent update" branch had never worked)
 *   - PUT  /project/{k}/testcase/{key}/detail     → the real update path;
 *     replies 400 "Please specify the Test Script Type" on a partial body
 *   - GET  /project/{k}/testcase/{key}/detail     → read
 *   - `scriptType`, `status`, `folder`, `tags[]` are ID-keyed objects; there is
 *     NO `labels` field in the stored model.
 *
 * AIO exposes no scriptType metadata endpoint, and the IDs are instance
 * specific (this project stores Classic as ID 3), so the only way to learn the
 * BDD ID is to set one and read it back. Confined to one validation case.
 *
 * Run:  npx tsx scripts/aio-probe-scripttype.ts YWPD-TC-7876
 */
import 'dotenv/config';
import { authHeader, loadConfig } from './aio-lib';

async function main(): Promise<void> {
  const key = process.argv.slice(2).find((a) => !a.startsWith('-'));
  if (!key) {
    process.stdout.write('Usage: npx tsx scripts/aio-probe-scripttype.ts <CASE-KEY>\n');
    process.exitCode = 1;
    return;
  }
  const cfg = loadConfig();
  const token = process.env.AIO_API_TOKEN;
  const email = process.env.AIO_EMAIL;
  if (!token) {
    process.stdout.write('AIO_API_TOKEN not set.\n');
    process.exitCode = 1;
    return;
  }
  const auth = authHeader(cfg, token, email);
  const base = `${cfg.apiBaseUrl}/project/${cfg.projectKey}/testcase/${key}`;
  const out: string[] = [];

  for (const ID of [1, 2, 4, 5, 6]) {
    const put = await fetch(`${base}/detail`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: auth },
      body: JSON.stringify({ scriptType: { ID } }),
    });
    const txt = (await put.text()).replace(/\s+/g, ' ').slice(0, 160);
    if (!put.ok) {
      out.push(`ID ${ID}: PUT -> ${put.status} ${txt}`);
      continue;
    }
    const get = await fetch(`${base}/detail`, {
      headers: { Authorization: auth, Accept: 'application/json' },
    });
    const body = (await get.json()) as { scriptType?: { ID?: number; name?: string } };
    out.push(`ID ${ID}: stored as -> ${JSON.stringify(body.scriptType)}`);
  }
  process.stdout.write(out.join('\n') + '\n');
}

if (require.main === module) {
  void main().catch((err: unknown) => {
    process.stderr.write(
      `aio-probe-scripttype failed: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exitCode = 1;
  });
}
