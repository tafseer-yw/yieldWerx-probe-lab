/**
 * AIO Tests sync verifier — `npx tsx scripts/aio-verify-sync.ts <feature-slug>`.
 *
 * Read-only. Re-reads every synced case from AIO and compares it against the
 * feature file it came from. A push returning HTTP 200 is NOT evidence the data
 * landed — AIO silently discards fields it does not recognise (`bddContent`,
 * `dataSets` without `datasetParameters`, `tags`), so the read-back is the only
 * honest check. `dataSets` is only returned with `?fetchDataSets=true`.
 *
 * Paced, because AIO throttles a tight loop.
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { authHeader, loadConfig } from './aio-lib';

interface Row {
  tc: string;
  key: string;
  isOutline: boolean;
  columns: string[];
  rowCount: number;
  steps: number;
}

/** Pull the expected shape of every scenario straight from the feature files. */
function fromFeatures(slug: string): Row[] {
  const dir = path.join(process.cwd(), 'features', slug);
  const out: Row[] = [];
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.feature'))) {
    const text = fs.readFileSync(path.join(dir, f), 'utf-8');
    for (const part of text.split(/(?=^ {2}# AC:)/m).slice(1)) {
      const tc = part.match(/@(TC-[a-z-]+-\d{3})\b/)?.[1];
      const key = part.match(/# Traceability:[^\n]*\/\s*(YWPD-TC-\d+)/)?.[1];
      if (!tc || !key) continue;
      const isOutline = /^\s*Scenario Outline:/m.test(part);
      const table = [...part.matchAll(/^\s*\|.*\|\s*$/gm)].map((m) => m[0]);
      const cells = (l: string): string[] =>
        l
          .trim()
          .replace(/^\|/, '')
          .replace(/\|$/, '')
          .split('|')
          .map((c) => c.trim());
      const columns = table.length > 1 ? cells(table[0] ?? '') : [];
      const rowCount = table.length > 1 ? table.length - 1 : 0;
      const steps = [...part.matchAll(/^\s*(Given|When|Then|And|But)\s+\S/gm)].length;
      out.push({ tc, key, isOutline, columns, rowCount, steps });
    }
  }
  return out;
}

async function main(): Promise<void> {
  const slug = process.argv.slice(2).find((a) => !a.startsWith('-')) ?? 'cluster-detection';
  const cfg = loadConfig();
  const token = process.env.AIO_API_TOKEN;
  if (!token) {
    process.stdout.write('AIO_API_TOKEN not set.\n');
    process.exitCode = 1;
    return;
  }
  const auth = authHeader(cfg, token, process.env.AIO_EMAIL);
  const P = `${cfg.apiBaseUrl}/project/${cfg.projectKey}`;
  const expected = fromFeatures(slug);
  const problems: string[] = [];
  let checked = 0;
  let withData = 0;

  for (const e of expected) {
    let res: Response | undefined;
    for (let a = 0; a < 6; a++) {
      res = await fetch(`${P}/testcase/${e.key}/detail?fetchDataSets=true`, {
        headers: { Authorization: auth, Accept: 'application/json' },
      });
      if (res.status !== 429) break;
      await new Promise((r) => setTimeout(r, 3000 * 2 ** a));
    }
    if (!res?.ok) {
      problems.push(`${e.tc} (${e.key}): read failed ${res?.status ?? '?'}`);
      continue;
    }
    const c = (await res.json()) as Record<string, unknown>;
    checked++;

    const scriptType = (c.scriptType as { name?: string } | null)?.name;
    if (scriptType !== 'BDD/Gherkin')
      problems.push(`${e.tc}: scriptType is "${scriptType ?? 'null'}"`);
    if ((c.folder as { ID?: number } | null)?.ID === undefined)
      problems.push(`${e.tc}: folder is null`);
    if (c.automationKey !== e.tc)
      problems.push(`${e.tc}: automationKey is "${String(c.automationKey)}"`);
    const steps = Array.isArray(c.steps) ? c.steps.length : 0;
    if (steps !== e.steps)
      problems.push(`${e.tc}: ${steps} steps in AIO, ${e.steps} in the feature file`);

    if (e.isOutline && e.rowCount > 0) {
      const params =
        (c.datasetParameters as { name: string }[] | undefined)?.map((p) => p.name) ?? [];
      const sets = (c.dataSets as Record<string, string>[] | undefined) ?? [];
      if (sets.length === 0) problems.push(`${e.tc}: NO data set (expected ${e.rowCount} row(s))`);
      else {
        withData++;
        if (sets.length !== e.rowCount)
          problems.push(
            `${e.tc}: ${sets.length} data rows in AIO, ${e.rowCount} in the feature file`,
          );
        const missing = e.columns.filter((col) => !params.includes(col));
        if (missing.length > 0)
          problems.push(`${e.tc}: missing Examples column(s) ${missing.join(', ')}`);
      }
    }
    await new Promise((r) => setTimeout(r, 250));
  }

  process.stdout.write(
    `\nchecked ${checked}/${expected.length} case(s) · ${withData} with data sets\n`,
  );
  process.stdout.write(`problems: ${problems.length}\n`);
  problems.forEach((p) => process.stdout.write(`  ${p}\n`));
  process.exitCode = problems.length ? 1 : 0;
}

if (require.main === module) {
  void main().catch((err: unknown) => {
    process.stderr.write(
      `aio-verify-sync failed: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exitCode = 1;
  });
}
