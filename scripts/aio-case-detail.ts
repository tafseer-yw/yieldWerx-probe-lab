/**
 * AIO Tests single-case inspector — `npm run aio:case -- <AIO-KEY>`.
 *
 * Read-only. Fetches ONE case by key and prints the fields Case Sync writes, so
 * a `--validate` push can be reconciled against what AIO actually stored
 * without paging the whole project (which rate-limits at ~5800 cases).
 *
 * Run:  npm run aio:case -- YWPD-TC-7876
 */
import 'dotenv/config';
import { authHeader, loadConfig } from './aio-lib';

async function main(): Promise<void> {
  const key = process.argv.slice(2).find((a) => !a.startsWith('-'));
  if (!key) {
    process.stdout.write('Usage: npm run aio:case -- <AIO-KEY>\n');
    process.exitCode = 1;
    return;
  }
  const cfg = loadConfig();
  const token = process.env.AIO_API_TOKEN;
  const email = process.env.AIO_EMAIL;
  if (!token) {
    process.stdout.write('AIO_API_TOKEN not set — see npm run aio:check.\n');
    process.exitCode = 1;
    return;
  }

  const paths = [`/testcase/${key}/detail`, `/testcase/${key}`];
  for (const suffix of paths) {
    const url = `${cfg.apiBaseUrl}/project/${cfg.projectKey}${suffix}`;
    const res = await fetch(url, {
      headers: { Authorization: authHeader(cfg, token, email), Accept: 'application/json' },
    });
    process.stdout.write(`GET ${suffix} -> ${res.status}\n`);
    if (!res.ok) continue;
    const body: unknown = await res.json().catch(() => ({}));
    const rec = body as Record<string, unknown>;
    const c = (rec.testCase ?? rec) as Record<string, unknown>;
    const show = (label: string, v: unknown): void => {
      const text = typeof v === 'string' ? v : JSON.stringify(v);
      process.stdout.write(
        `  ${label.padEnd(14)} ${text === undefined ? '(absent)' : String(text).slice(0, 300)}\n`,
      );
    };
    show('key', c.key);
    show('title', c.title);
    show('folder', c.folder);
    show('status', c.status);
    show('scriptType', c.scriptType);
    show('type', c.type);
    show('tags', c.tags);
    // `labels` is not a CaseFullDetails field — shown to prove it stays absent.
    show('labels', c.labels);
    show('automationKey', c.automationKey);
    // Fields a full-body PUT would clear if the payload omitted them; printing
    // them is how "did the update preserve unmanaged metadata?" gets answered.
    show('precondition', c.precondition);
    show('priority', c.priority);
    show('customFields', c.customFields);
    const steps = Array.isArray(c.steps) ? (c.steps as Record<string, unknown>[]) : [];
    show('steps', `${steps.length} step(s)`);
    for (const s of steps.slice(0, 40)) {
      process.stdout.write(
        `      ${String(s.stepType ?? '?').padEnd(10)} ${String(s.bddStep ?? s.step ?? '')}\n`,
      );
    }
    show('fields', Object.keys(c).join(', '));
    return;
  }
  process.stdout.write('Could not read the case on any known path.\n');
  process.exitCode = 1;
}

if (require.main === module) {
  void main().catch((err: unknown) => {
    process.stderr.write(
      `aio-case-detail failed: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exitCode = 1;
  });
}
