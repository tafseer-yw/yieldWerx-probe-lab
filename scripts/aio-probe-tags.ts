/**
 * AIO Tests tag probe — the last silent-accept gap in Case Sync.
 *
 * `tags` on the case body is accepted with a 200 and stored as `[]`, whether
 * sent as `[{name}]` or `[{ID}]`. `GET /project/{k}/tag` shows tags are
 * project-level entities `{ID, name}`, so association is probably a separate
 * write — the same "declaration + values" split that Examples turned out to
 * need (`datasetParameters` + `dataSets`).
 *
 * Uses additive POST/PUT to sub-resources rather than `PUT …/detail`, because a
 * partial /detail body REPLACES the case and nulls folder/automationKey.
 *
 * Run:  npx tsx scripts/aio-probe-tags.ts YWPD-TC-7876
 */
import 'dotenv/config';
import { authHeader, loadConfig } from './aio-lib';

async function main(): Promise<void> {
  const key = process.argv.slice(2).find((a) => !a.startsWith('-')) ?? 'YWPD-TC-7876';
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
  const read = { Authorization: auth, Accept: 'application/json' };

  // Two known project tag IDs (from GET /project/{k}/tag).
  const tagList = await fetch(`${P}/tag`, { headers: read });
  const tags = (await tagList.json()) as { ID: number; name: string }[];
  const pick = tags.filter((t) =>
    ['regression', 'smoke', 'component'].includes(t.name.toLowerCase()),
  );
  process.stdout.write(`sample tags: ${JSON.stringify(pick.slice(0, 3))}\n\n`);
  const ids = pick.slice(0, 2).map((t) => t.ID);
  if (ids.length === 0) {
    process.stdout.write('no sample tag found\n');
    return;
  }

  // Find a case that already HAS tags and copy its stored shape — the same
  // approach that solved Examples (YWPD-TC-1069 supplied the model).
  const page = await fetch(`${P}/testcase?startAt=0&maxResults=100`, { headers: read });
  if (page.ok) {
    const body = (await page.json()) as { items?: { key: string; tags?: unknown[] }[] };
    const tagged = (body.items ?? []).filter((c) => Array.isArray(c.tags) && c.tags.length > 0);
    process.stdout.write(`cases with tags on page 1: ${tagged.length}\n`);
    for (const c of tagged.slice(0, 3)) {
      const d = await fetch(`${P}/testcase/${c.key}/detail`, { headers: read });
      if (!d.ok) continue;
      const full = (await d.json()) as { tags?: unknown };
      process.stdout.write(`  ${c.key} tags = ${JSON.stringify(full.tags)}\n`);
    }
    process.stdout.write('\n');
  }

  const attempts: { method: string; suffix: string; body: unknown }[] = [
    { method: 'POST', suffix: `/testcase/${key}/tag`, body: ids },
    { method: 'POST', suffix: `/testcase/${key}/tag`, body: { tagIDs: ids } },
    { method: 'POST', suffix: `/testcase/${key}/tag`, body: ids.map((ID) => ({ ID })) },
    { method: 'PUT', suffix: `/testcase/${key}/tag`, body: ids },
    { method: 'POST', suffix: `/testcase/${key}/tags`, body: ids },
    { method: 'PUT', suffix: `/testcase/${key}/tags`, body: ids },
  ];

  for (const a of attempts) {
    const res = await fetch(`${P}${a.suffix}`, {
      method: a.method,
      headers,
      body: JSON.stringify(a.body),
    });
    const t = (await res.text()).replace(/\s+/g, ' ');
    process.stdout.write(
      `${a.method.padEnd(5)} ${String(res.status).padEnd(4)} ${a.suffix} ${JSON.stringify(a.body).slice(0, 40)} ${t.slice(0, 120)}\n`,
    );
    if (!res.ok) continue;
    const back = await fetch(`${P}/testcase/${key}/detail`, { headers: read });
    const c = (await back.json()) as { tags?: unknown[] };
    process.stdout.write(`      -> tags now ${JSON.stringify(c.tags)}\n`);
    if (Array.isArray(c.tags) && c.tags.length > 0) {
      process.stdout.write('  ^ STORED — use this call.\n');
      return;
    }
  }
}

if (require.main === module) {
  void main().catch((err: unknown) => {
    process.stderr.write(
      `aio-probe-tags failed: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exitCode = 1;
  });
}
