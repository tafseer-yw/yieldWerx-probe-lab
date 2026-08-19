/**
 * AIO Tests data-set probe — the Examples surface for BDD cases.
 *
 * Reference case `YWPD-TC-1069` (an existing CLM case with a populated Examples
 * grid) revealed the model:
 *   - the case detail carries `hasDataSets: true` and
 *     `datasetParameters: [{ID, name}]` — the Examples HEADER row (columns);
 *   - the row VALUES are not in the case detail, so they live in a separate
 *     resource that still has to be located.
 * `dataSets` on the case body is typed ArrayList<Map<String,String>> and is
 * accepted with a 200 but never stored (`hasDataSets` stays false).
 *
 * Run:  npx tsx scripts/aio-probe-dataset.ts YWPD-TC-1069
 */
import 'dotenv/config';
import { authHeader, loadConfig } from './aio-lib';

async function main(): Promise<void> {
  const key = process.argv.slice(2).find((a) => !a.startsWith('-')) ?? 'YWPD-TC-1069';
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
  const headers = { Authorization: auth, Accept: 'application/json' };

  const d = await fetch(`${P}/testcase/${key}/detail`, { headers });
  const body = (await d.json()) as Record<string, unknown>;
  process.stdout.write(`hasDataSets: ${String(body.hasDataSets)}\n`);
  process.stdout.write(`datasetParameters: ${JSON.stringify(body.datasetParameters)}\n`);
  const caseId = body.ID;
  process.stdout.write(`numeric ID: ${String(caseId)}\n\n`);

  // `?fetchDataSets=true` is accepted — check whether it carries the row VALUES.
  const withRows = await fetch(`${P}/testcase/${key}/detail?fetchDataSets=true`, { headers });
  const wr = (await withRows.json()) as Record<string, unknown>;
  process.stdout.write(`fetchDataSets keys: ${Object.keys(wr).join(', ')}\n`);
  for (const k of Object.keys(wr)) {
    const v = JSON.stringify(wr[k]);
    if (v && /dataset|dataSet/i.test(k)) process.stdout.write(`  >> ${k} = ${v.slice(0, 700)}\n`);
  }
  process.stdout.write('\n');

  const suffixes = [
    `/testcase/${key}/dataset`,
    `/testcase/${key}/datasets`,
    `/testcase/${key}/dataSet`,
    `/testcase/${key}/datasetrow`,
    `/testcase/${key}/datasetParameter`,
    `/testcase/${key}/parameter/value`,
    `/testcase/${String(caseId)}/dataset`,
    `/dataset/${String(caseId)}`,
    `/testcase/${key}/detail?fetchDataSets=true`,
    `/testcase/${key}/dataset/values`,
  ];
  for (const s of suffixes) {
    const res = await fetch(`${P}${s}`, { headers });
    const t = (await res.text()).replace(/\s+/g, ' ');
    process.stdout.write(`${String(res.status).padEnd(4)} ${s}\n`);
    if (res.ok) process.stdout.write(`       ${t.slice(0, 600)}\n`);
  }
}

if (require.main === module) {
  void main().catch((err: unknown) => {
    process.stderr.write(
      `aio-probe-dataset failed: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exitCode = 1;
  });
}
