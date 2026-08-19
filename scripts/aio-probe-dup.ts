/**
 * AIO duplicate-case reconciliation probe — `npx tsx scripts/aio-probe-dup.ts`.
 *
 * Read-only. Two Case Sync runs touched the same CAT-01 scenarios:
 * `test(cluster-detection): sync CAT-01 cases to AIO` created YWPD-TC-7869..7875,
 * and a later full-feature sync created its own keys for the same seven TC ids.
 * This reads both keys per TC id and reports which pairs are genuinely live in
 * AIO, so the reconciliation is based on the server's state rather than on what
 * the feature files claim.
 */
import 'dotenv/config';
import { authHeader, loadConfig } from './aio-lib';

/** TC id → [key written by the CAT-01 sync, key written by the full-feature sync]. */
const PAIRS: [string, string, string][] = [
  ['TC-cluster-detection-001', 'YWPD-TC-7869', 'YWPD-TC-7876'],
  ['TC-cluster-detection-002', 'YWPD-TC-7870', 'YWPD-TC-7933'],
  ['TC-cluster-detection-003', 'YWPD-TC-7871', 'YWPD-TC-7935'],
  ['TC-cluster-detection-004', 'YWPD-TC-7872', 'YWPD-TC-7934'],
  ['TC-cluster-detection-005', 'YWPD-TC-7873', 'YWPD-TC-7936'],
  ['TC-cluster-detection-006', 'YWPD-TC-7874', 'YWPD-TC-7937'],
  ['TC-cluster-detection-007', 'YWPD-TC-7875', 'YWPD-TC-7938'],
];

interface Info {
  missing?: number;
  title?: string;
  folder?: string | null;
  automationKey?: string | null;
  scriptType?: string | null;
  steps?: number;
  archived?: boolean;
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  const token = process.env.AIO_API_TOKEN;
  if (!token) {
    process.stdout.write('AIO_API_TOKEN not set.\n');
    process.exitCode = 1;
    return;
  }
  const auth = authHeader(cfg, token, process.env.AIO_EMAIL);
  const P = `${cfg.apiBaseUrl}/project/${cfg.projectKey}`;

  const get = async (key: string): Promise<Info> => {
    for (let a = 0; a < 5; a++) {
      const r = await fetch(`${P}/testcase/${key}/detail`, {
        headers: { Authorization: auth, Accept: 'application/json' },
      });
      if (r.status === 429) {
        await new Promise((z) => setTimeout(z, 3000 * 2 ** a));
        continue;
      }
      if (!r.ok) return { missing: r.status };
      const b = (await r.json()) as Record<string, unknown>;
      return {
        title: String(b.title ?? ''),
        folder: (b.folder as { name?: string } | null)?.name ?? null,
        automationKey: (b.automationKey as string | null) ?? null,
        scriptType: (b.scriptType as { name?: string } | null)?.name ?? null,
        steps: Array.isArray(b.steps) ? b.steps.length : 0,
        archived: Boolean(b.isArchived),
      };
    }
    return { missing: 429 };
  };

  const line = (label: string, key: string, i: Info): string =>
    i.missing
      ? `   ${label} ${key} -> ABSENT (${i.missing})`
      : `   ${label} ${key} -> ${i.scriptType}, ${i.steps} steps, folder="${i.folder}", automationKey=${i.automationKey}${i.archived ? ' [ARCHIVED]' : ''}`;

  let both = 0;
  for (const [tc, theirs, mine] of PAIRS) {
    const a = await get(theirs);
    await new Promise((z) => setTimeout(z, 250));
    const b = await get(mine);
    await new Promise((z) => setTimeout(z, 250));
    if (!a.missing && !b.missing && !a.archived && !b.archived) both++;
    process.stdout.write(
      `${tc}\n${line('CAT-01 sync', theirs, a)}\n${line('full sync  ', mine, b)}\n`,
    );
  }
  process.stdout.write(`\nBOTH LIVE (true duplicates): ${both} of ${PAIRS.length}\n`);
}

if (require.main === module) {
  void main().catch((err: unknown) => {
    process.stderr.write(
      `aio-probe-dup failed: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exitCode = 1;
  });
}
