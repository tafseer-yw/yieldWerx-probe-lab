/**
 * Global teardown — removes the wafers this suite uploaded.
 *
 * Every scenario that uploads stamps a unique `LOT-E2E-<timestamp>` lot so
 * re-runs never trip the duplicate-wafer guard. Without cleanup those wafers
 * accumulate in the developer's database run after run, which makes the app's
 * own screens misleading to look at.
 *
 * This talks to the app over HTTP only — no app code is imported and no
 * database is touched directly, per the dependency rule in CLAUDE.md. It is
 * deliberately forgiving: a teardown must never turn a green run red, so every
 * failure is logged and swallowed.
 *
 * It reaches the API through `apiBaseUrl`, which is 127.0.0.1 rather than
 * localhost on purpose. The API binds IPv4 loopback, `localhost` resolves to
 * ::1 first on macOS, and macOS AirPlay Receiver listens on port 5000 — so
 * `http://localhost:5000` reaches AirTunes, which answers 403 to everything.
 * That is exactly what happened here: every run logged "sign-in failed (403)"
 * and left its wafers behind, and they accumulated until the dashboard was
 * reporting dozens of them.
 */
import { loadConfig } from './config';
import { createLogger } from './logger';

/** The lot namespace the suite owns. Nothing outside it is ever deleted. */
const SUITE_LOT_PREFIX = 'LOT-E2E-';

interface UploadRow {
  id: string;
  lot: string | null;
}

const log = createLogger('Teardown');

export default async function globalTeardown(): Promise<void> {
  const config = loadConfig();
  const base = config.apiBaseUrl ?? config.baseUrl;
  const admin = config.auth?.roles?.admin;

  if (!admin?.username) {
    log.info('no admin credentials configured — leaving suite wafers in place');
    return;
  }

  try {
    const login = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: admin.username, password: admin.password }),
    });
    if (!login.ok) {
      log.info(`sign-in failed (${login.status}) — leaving suite wafers in place`);
      return;
    }
    const { accessToken } = (await login.json()) as { accessToken: string };
    const auth = { authorization: `Bearer ${accessToken}` };

    // History pages at 100, so a long-neglected database needs several rounds.
    let removed = 0;
    let seen = 0;
    for (let round = 0; round < 25; round += 1) {
      const listed = await fetch(
        `${base}/api/uploads?search=${encodeURIComponent(SUITE_LOT_PREFIX)}&pageSize=100`,
        { headers: auth },
      );
      if (!listed.ok) {
        log.info(`history read failed (${listed.status}) — ${removed} removed so far`);
        return;
      }
      const { items } = (await listed.json()) as { items: UploadRow[] };
      const mine = items.filter((item) => item.lot?.startsWith(SUITE_LOT_PREFIX) === true);
      if (mine.length === 0) break;
      seen += mine.length;
      for (const upload of mine) {
        const response = await fetch(`${base}/api/uploads/${upload.id}`, {
          method: 'DELETE',
          headers: auth,
        });
        if (response.ok) removed += 1;
      }
    }
    log.info(
      removed === 0 ? 'no suite wafers to remove' : `removed ${removed} of ${seen} suite wafer(s)`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.info(`skipped (${message})`);
  }
}
