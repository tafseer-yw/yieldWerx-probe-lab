/**
 * AIO Tests BDD-steps probe — the last unknown in the Case Sync payload.
 *
 * Reverse-engineering log (2026-07-31, on validation case YWPD-TC-7876):
 *   - POST /project/{k}/testcase               → create
 *   - PUT  /project/{k}/testcase/{key}         → 404 (never the update path)
 *   - PUT  /project/{k}/testcase/{key}/detail  → the real update path; needs
 *     `title` and `scriptType` in every body
 *   - scriptType IDs are instance-specific: **3 = Classic, 4 = BDD/Gherkin**
 *     (1/2/5/6 rejected with "Please specify the Test Script Type")
 *   - `bddContent` / `gherkinContent` / `script` are all ACCEPTED (200) and all
 *     silently DROPPED — steps stayed 0. The Gherkin does not live in a text
 *     field; it lives in `steps[]`.
 *   - `steps: [{step}]` → 400 "Cannot create Case Step … provide value for
 *     **Step Type**". So each step needs a step-type discriminator.
 *   - There is NO `labels` field in the stored model; `tags[]` is ID-keyed.
 *
 * This probe finds the step-type shape. Confined to one validation case.
 *
 * Run:  npx tsx scripts/aio-probe-bdd.ts YWPD-TC-7876
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
  const auth = authHeader(cfg, token, email);
  const base = `${cfg.apiBaseUrl}/project/${cfg.projectKey}/testcase/${key}`;
  const headers = { 'Content-Type': 'application/json', Authorization: auth };

  const read = async (): Promise<Record<string, unknown>> => {
    const r = await fetch(`${base}/detail`, {
      headers: { Authorization: auth, Accept: 'application/json' },
    });
    return (await r.json()) as Record<string, unknown>;
  };
  const title = String((await read()).title ?? '');

  const gherkin = 'Given The "Custom Signatures" screen is open';
  // TestStepType is a bare-string Java enum: [BDD_GIVEN, BDD_…, TEXT].
  // With `{step, stepType:'BDD_GIVEN'}` AIO replies "Cannot save BDD step
  // record … Please provide step data" — so a BDD step's text is NOT in `step`.
  const T = 'BDD_GIVEN';
  const shapes: { label: string; steps: unknown }[] = [
    { label: 'data only', steps: [{ stepType: T, data: gherkin }] },
    { label: 'stepData', steps: [{ stepType: T, stepData: gherkin }] },
    { label: 'step + non-empty data', steps: [{ stepType: T, step: gherkin, data: gherkin }] },
    { label: 'description', steps: [{ stepType: T, description: gherkin }] },
    { label: 'bddStep', steps: [{ stepType: T, bddStep: gherkin }] },
    { label: 'text', steps: [{ stepType: T, text: gherkin }] },
    { label: 'stepDetail', steps: [{ stepType: T, stepDetail: gherkin }] },
  ];

  for (const { label, steps } of shapes) {
    const res = await fetch(`${base}/detail`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ title, scriptType: { ID: 4 }, steps }),
    });
    const txt = (await res.text()).replace(/\s+/g, ' ').slice(0, 150);
    if (!res.ok) {
      process.stdout.write(`${label.padEnd(26)} PUT ${res.status} ${txt}\n`);
      continue;
    }
    const after = await read();
    const stored = after.steps;
    const n = Array.isArray(stored) ? stored.length : 0;
    process.stdout.write(
      `${label.padEnd(26)} PUT 200 · steps=${n} ${n ? JSON.stringify(stored).slice(0, 260) : ''}\n`,
    );
    if (n > 0) {
      process.stdout.write('  ^ STORED — use this shape.\n');
      return;
    }
  }
}

if (require.main === module) {
  void main().catch((err: unknown) => {
    process.stderr.write(
      `aio-probe-bdd failed: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exitCode = 1;
  });
}
