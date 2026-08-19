/**
 * AIO duplicate-case de-duplication â€” `npx tsx scripts/aio-dedupe-cases.ts [--live]`.
 *
 * Two Case Sync runs created a case each for the same seven CAT-01 scenarios:
 * the CAT-01 subset sync made YWPD-TC-7869..7875 in folder "YWPD-12836" (#686),
 * and the later full-feature sync made its own keys in "YWPD-12836 | Cosmic"
 * (#1291). Both sets are live and share an automationKey, so automation would
 * bind ambiguously.
 *
 * Decision (repository owner, 2026-07-31): keep the full-sync set â€” it carries
 * the CI-01 signature fix, the Examples data sets, and sits in the folder that
 * holds all 122 cases. Retire the CAT-01 subset keys.
 *
 * SAFETY: a case that has ANY execution history is never deleted â€” deleting it
 * would destroy run evidence. Those are reported and skipped for a human to
 * handle. Dry-run by default; `--live` is required to delete anything.
 *
 * The guard queries TEST CYCLES, not the case. The first version of this script
 * probed `/testcase/{key}/run|runs|execution` â€” every one of which 404s, so
 * "no history" was a guaranteed zero that would have reported a case with a
 * hundred runs as safe to delete. That is the CD-01 / CI-04 defect class this
 * repo has spent ten audits removing, and it nearly deleted live records.
 * `/testcycle/{key}/testrun` and `/testcycle/{key}/testcase` return 200 with a
 * parseable `items` list, so they can genuinely return rows. If either stops
 * returning 200 the script ABORTS rather than treating silence as safety.
 */
import 'dotenv/config';
import { authHeader, loadConfig } from './aio-lib';

/** Keys created by the CAT-01 subset sync, superseded by the full-feature sync. */
const RETIRE: { key: string; tc: string; keep: string }[] = [
  { key: 'YWPD-TC-7869', tc: 'TC-cluster-detection-001', keep: 'YWPD-TC-7876' },
  { key: 'YWPD-TC-7870', tc: 'TC-cluster-detection-002', keep: 'YWPD-TC-7933' },
  { key: 'YWPD-TC-7871', tc: 'TC-cluster-detection-003', keep: 'YWPD-TC-7935' },
  { key: 'YWPD-TC-7872', tc: 'TC-cluster-detection-004', keep: 'YWPD-TC-7934' },
  { key: 'YWPD-TC-7873', tc: 'TC-cluster-detection-005', keep: 'YWPD-TC-7936' },
  { key: 'YWPD-TC-7874', tc: 'TC-cluster-detection-006', keep: 'YWPD-TC-7937' },
  { key: 'YWPD-TC-7875', tc: 'TC-cluster-detection-007', keep: 'YWPD-TC-7938' },
];

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
  const read = { Authorization: auth, Accept: 'application/json' };

  const req = async (suffix: string, method = 'GET'): Promise<{ status: number; body: string }> => {
    for (let a = 0; a < 5; a++) {
      const r = await fetch(`${P}${suffix}`, { method, headers: read });
      if (r.status === 429) {
        await new Promise((z) => setTimeout(z, 3000 * 2 ** a));
        continue;
      }
      return { status: r.status, body: (await r.text()).slice(0, 400) };
    }
    return { status: 429, body: '' };
  };

  /**
   * Like `req`, but UNTRUNCATED. `req` slices the body to 400 chars for log
   * lines; parsing that as JSON would yield a partial case, and writing it back
   * through PUT /detail (which replaces the whole body) would null every field
   * past the cut. The archive path must use this one.
   */
  const reqFull = async (suffix: string): Promise<{ status: number; body: string }> => {
    for (let a = 0; a < 5; a++) {
      const r = await fetch(`${P}${suffix}`, { headers: read });
      if (r.status === 429) {
        await new Promise((z) => setTimeout(z, 3000 * 2 ** a));
        continue;
      }
      return { status: r.status, body: await r.text() };
    }
    return { status: 429, body: '' };
  };

  const reqJson = async (
    suffix: string,
    method: string,
    payload: unknown,
  ): Promise<{ status: number; body: string }> => {
    for (let a = 0; a < 5; a++) {
      const r = await fetch(`${P}${suffix}`, {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: auth },
        body: JSON.stringify(payload),
      });
      if (r.status === 429) {
        await new Promise((z) => setTimeout(z, 3000 * 2 ** a));
        continue;
      }
      return { status: r.status, body: (await r.text()).slice(0, 400) };
    }
    return { status: 429, body: '' };
  };

  process.stdout.write(
    `AIO de-duplication â€” ${live ? 'LIVE' : 'dry-run'} Â· keeping the full-sync set\n\n`,
  );

  // ---- Build the set of case keys referenced by ANY cycle, and prove the
  // query works before trusting an empty answer.
  const cyclesRes = await req('/testcycle');
  if (cyclesRes.status !== 200) {
    process.stdout.write(
      `ABORT â€” cannot list test cycles (${cyclesRes.status}); refusing to delete on an unverified guard.\n`,
    );
    process.exitCode = 1;
    return;
  }
  const cycleKeys = [...cyclesRes.body.matchAll(/"key":"(YWPD-CY-[^"]+)"/g)].map((m) => m[1]);
  const referenced = new Set<string>();
  for (const c of cycleKeys) {
    for (const suffix of ['/testcase', '/testrun']) {
      const r = await req(`/testcycle/${c}${suffix}`);
      if (r.status !== 200) {
        process.stdout.write(
          `ABORT â€” /testcycle/${c}${suffix} returned ${r.status}; the history guard cannot be trusted.\n`,
        );
        process.exitCode = 1;
        return;
      }
      for (const m of r.body.matchAll(/"(YWPD-TC-\d+)"/g)) if (m[1]) referenced.add(m[1]);
      await new Promise((z) => setTimeout(z, 200));
    }
  }
  process.stdout.write(
    `history guard: ${cycleKeys.length} cycle(s) queried [${cycleKeys.join(', ')}], ` +
      `${referenced.size} case(s) referenced by a cycle\n\n`,
  );

  let deleted = 0;
  let skipped = 0;

  for (const r of RETIRE) {
    const detail = await req(`/testcase/${r.key}/detail`);
    if (detail.status !== 200) {
      process.stdout.write(`  - ${r.key} (${r.tc}) already absent (${detail.status})\n`);
      continue;
    }
    if (referenced.has(r.key)) {
      skipped++;
      process.stdout.write(
        `  ! ${r.key} (${r.tc}) IS IN A TEST CYCLE â€” skipped, handle by hand\n`,
      );
      continue;
    }
    if (!live) {
      process.stdout.write(`  ~ ${r.key} (${r.tc}) would be archived; ${r.keep} survives\n`);
      continue;
    }

    // Archive, not delete. DELETE is unreachable on this API (every variant
    // 404s or 500s), and archiving is reversible, which for a superseded
    // duplicate is the better outcome anyway.
    //
    // PUT /detail REPLACES the whole body, so the case is read back in full
    // (with ?fetchDataSets=true, or the Examples silently vanish) and written
    // back complete. A partial body here would null folder and automationKey â€”
    // exactly what happened to TC-7881 during payload discovery.
    const full = await reqFull(`/testcase/${r.key}/detail?fetchDataSets=true`);
    if (full.status !== 200) {
      skipped++;
      process.stdout.write(`  ! ${r.key} could not be re-read (${full.status}) â€” skipped\n`);
      continue;
    }
    const c = JSON.parse(full.body === '' ? '{}' : full.body) as Record<string, unknown>;
    const steps = Array.isArray(c.steps)
      ? (c.steps as Record<string, unknown>[]).map((s) => ({
          bddStep: s.bddStep,
          stepType: s.stepType,
        }))
      : [];
    const payload: Record<string, unknown> = {
      title: c.title,
      description: c.description ?? undefined,
      precondition: c.precondition ?? undefined,
      folder:
        (c.folder as { ID?: number } | null)?.ID === undefined
          ? undefined
          : { ID: (c.folder as { ID: number }).ID },
      status:
        (c.status as { ID?: number } | null)?.ID === undefined
          ? undefined
          : { ID: (c.status as { ID: number }).ID },
      scriptType: { ID: 4 },
      automationKey: c.automationKey ?? undefined,
      steps,
      datasetParameters: c.datasetParameters ?? undefined,
      dataSets: c.dataSets ?? undefined,
      isArchived: true,
    };
    const put = await reqJson(`/testcase/${r.key}/detail`, 'PUT', payload);
    if (put.status < 200 || put.status >= 300) {
      skipped++;
      process.stdout.write(
        `  ! ${r.key} archive failed (${put.status}): ${put.body.slice(0, 160)}\n`,
      );
      continue;
    }
    // Read back â€” a 2xx is not evidence on this API.
    const back = await reqFull(`/testcase/${r.key}/detail?fetchDataSets=true`);
    const b = JSON.parse(back.body === '' ? '{}' : back.body) as Record<string, unknown>;
    const ok =
      b.isArchived === true &&
      b.automationKey === r.tc &&
      (b.folder as { ID?: number } | null)?.ID !== undefined &&
      Array.isArray(b.steps) &&
      (b.steps as unknown[]).length === steps.length;
    if (ok) {
      deleted++;
      process.stdout.write(`  x ${r.key} (${r.tc}) ARCHIVED, intact; ${r.keep} survives\n`);
    } else {
      skipped++;
      process.stdout.write(
        `  ! ${r.key} archive read-back FAILED â€” isArchived=${String(b.isArchived)}, ` +
          `automationKey=${String(b.automationKey)}, steps=${Array.isArray(b.steps) ? (b.steps as unknown[]).length : 'n/a'} (expected ${steps.length})\n`,
      );
    }
    await new Promise((z) => setTimeout(z, 300));
  }

  process.stdout.write(
    `\n${live ? `deleted ${deleted}` : 'dry run â€” nothing deleted'} Â· skipped ${skipped}\n` +
      (live ? '' : 'Add --live to apply.\n'),
  );
}

if (require.main === module) {
  void main().catch((err: unknown) => {
    process.stderr.write(
      `aio-dedupe-cases failed: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exitCode = 1;
  });
}
