# Plan — real accounts + a central assessment record

Status: **proposal for review.** Nothing here is built yet. Approve or adjust the
decisions in §3, then I implement in the phases in §9.

## What you asked for

1. The **Assessments header icon** looks like the wafer/scan icon — replace it.
2. Let each dev/QA member **register a real account** and log in with their role
   to **submit assessments**, backed by a **central server database**.
3. **Keep the local option** (same demo users) as well, but the central DB is
   authoritative and the **local DB is a read-only replica** of it — so
   assessment progress is tracked properly, each person's rewards stay theirs,
   and **nobody can reset them locally**.

---

## 1. The icon (quick win, ships first)

The Assessments link uses `Icon name="target"` — concentric circles that read as
the `wafer`/`scan` glyph beside it. Fix: add a new **`trophy`** (or `award`)
glyph to `web/src/ui.tsx` and use it for the Assessments link. Small, isolated,
no dependencies. I'll do this in Phase 0 regardless of the bigger decisions.

---

## 2. The core architecture — "central is the record, local is a window"

The requirement that decides everything is **"nobody can reset it locally."** The
only way to guarantee that is: **assessment results are written and stored only
on the central server.** A laptop can never hold the authoritative copy, so it
can never tamper with it.

So the recommended model is:

- **One central deployment** of this same app, hosted by the org, with
  registration enabled and a persistent database. This is where every real
  account, login, and assessment submission lives. Real progress happens here.
- **The local app stays as-is for practice** — demo users, bundled SQLite, the
  wafer-analysis workflows, the test suites — all offline. Plus a **read-only
  mirror** of the central assessment data, refreshed by a sync command, so a
  member can see standings offline. The local app **cannot record or clear a
  real result** — those buttons only work against central.

This is one codebase, config-switched between `local` and `central` mode. It
satisfies all three requirements without a second app or a second database
engine.

### Why not the alternatives

| Alternative | Why not |
| --- | --- |
| Local writes to local DB, then syncs up to central | A user can edit their local DB before it syncs — exactly the "reset locally" you want to prevent. Rejected. |
| Two separate apps (a "central" app and a "local" app) | Doubles the code and the drift. The same binary in two modes is simpler and stays in sync by construction. |
| Move everything (wafer practice included) to central only | Loses the offline practice value you explicitly want to keep, and puts heavy wafer-upload load on a shared box. Keep practice local. |

### One decision inside this: where real people submit from

- **Recommended — hosted instance (simplest, most robust).** People submit on
  the central URL in their browser; it serves web + API same-origin, so there is
  no cross-origin auth to get right. The local app is practice + a read-only
  mirror.
- **Optional — hybrid.** The local app can point its *Assessments feature* at
  the central API, so a member running the app locally logs in with their real
  account and submits straight to central (practice features stay local). This
  is nicer UX but adds cross-origin auth (CORS + storing a central token in the
  local web app). I can add it in a later phase if you want it.

> **Decision 2A:** hosted-only submission (recommended), or also build the hybrid
> local→central submission?

---

## 3. Decisions I need from you

Everything else follows from these. My recommendation is in **bold**.

- **Decision A — database engine for central.**
  - **SQLite on the server, on a persistent volume, WAL mode + scheduled
    backups (recommended).** Keeps one engine, so the local replica is a trivial
    row copy; the app already uses `better-sqlite3`; fine for a small internal
    team where assessment writes are infrequent. Documented migration path to
    Postgres if the team grows.
  - Postgres (managed or self-hosted). The conventional "server database", better
    concurrency/durability, but it means rewriting the whole synchronous
    `store.ts` to an async Postgres driver, and the local SQLite replica then
    needs a translation sync. Bigger job.

- **Decision B — where the central instance is hosted.**
  - An org VM / on-prem box you control (recommended if you have one — keeps data
    in-house).
  - A managed platform (Fly.io / Render / Railway) — fastest to stand up, but the
    data leaves your network.
  - I'll write the Docker image + compose + a runbook either way; you point it at
    the chosen host.

- **Decision C — registration & role integrity.** Self-registration that lets
  people pick their own role is a hole (someone picks `admin`).
  - **Recommended:** anyone can register with a role of **`dev` or `qa` only**;
    `admin` is provisioned by seeding/CLI, never self-granted. Optionally gate
    registration to an **email-domain allowlist** (e.g. `@yieldwerx.com`) so only
    colleagues can sign up.
  - Stricter alternative: new accounts land as **pending**, and an admin approves
    the role before they can submit. More control, more admin work.

- **Decision D — identity fields.** Recommended: add **email** (unique, the login
  identity or alongside username) and a **display name**. Needed so standings
  show real people, and for password reset later. This is real PII — see §8.

- **Decision 2A** (from §2): hosted-only vs also hybrid submission.

---

## 4. Data model changes

`app_user` today: `user_id, username, password_hash, role, created_at`. For real
accounts, extend it (additive, self-healing migration like the existing ones):

- `email TEXT UNIQUE` — real identity (Decision D).
- `display_name TEXT` — shown in standings.
- `status TEXT` — `active` / `pending` (only if Decision C picks approval).
- `is_demo INTEGER NOT NULL DEFAULT 0` — marks the four seeded practice accounts,
  so real standings can exclude them and a demo login is visibly separate.

`assessment_result` is unchanged in shape (it already carries `evidence_url`,
`attempts`, `updated_at`); it simply lives on central and is the authoritative
table. Passwords keep the existing **scrypt** hashing (`password.ts`) — no change
needed.

Roles stay `viewer | dev | qa | admin`. `viewer` becomes the natural default/
pending role.

---

## 5. API changes

- `POST /api/auth/register` — new. Validates username/email/password/role
  (dev|qa), enforces the domain allowlist if chosen, hashes with scrypt, creates
  the account (active or pending per Decision C). Rate-limited.
- `POST /api/auth/login` — unchanged, now also serves real accounts.
- The assessment routes are unchanged in behaviour; they already derive the owner
  from the token and refuse to record for anyone else — which is exactly the
  integrity property you want. On central they become the single source of truth.
- `GET /api/assessments/export` — new, authenticated. Returns the assessment
  rows + user identities the **local replica** pulls. Read-only.
- (Only if Decision C = approval) `POST /api/admin/users/:id/approve` — admin
  sets a pending account's role to active.

---

## 6. Run modes and how the web finds the API

A single config switch, `PROBE_LAB_MODE = local | central` (plus the central URL
when relevant):

- **`central`** (the hosted instance): registration enabled; requires a real
  `YW_AUTH_SECRET` (the app already refuses to bind beyond loopback with the
  default secret — a safeguard that's already in place); serves the built web and
  the API **same-origin**; persistent DB volume.
- **`local`** (default, unchanged): demo users, bundled SQLite, offline practice,
  registration disabled, plus the read-only assessment mirror from §7.

Serving the web in central mode needs one addition the app doesn't have yet:
**the API must serve the built `dist/practice-web`** (via `@fastify/static`), or a
reverse proxy does. Today the web is only served by Vite in dev. I'll add static
serving so the central instance is a single self-contained process.

---

## 7. The local replica (one-way, read-only)

- A command — `npm run assessments:pull` (and/or a "Refresh from central" button
  for admins) — calls central's `GET /api/assessments/export` with a configured
  central URL + token, and writes the rows into the local `assessment_result`
  table, **replacing** it. That is the "replica": local mirrors central.
- In `local` mode the Assessments page renders this mirror **read-only** — the
  Record/Clear controls are hidden or disabled with "recorded on the central
  server", and a "last synced" timestamp is shown. Any stray local write is
  overwritten on the next pull.
- Because the write path is server-only and the local view is a replaceable
  mirror, **a local user cannot inflate or reset their rewards** — the whole
  point of requirement 3.

---

## 8. Security & privacy hardening (central)

- **Real `YW_AUTH_SECRET`** (≥32 chars) per environment — already enforced before
  non-loopback binding.
- **HTTPS** in front of the central instance (hosting/reverse proxy).
- **Rate-limit** login and register (the app already has a rate-limit knob).
- **Password policy** on register (length/complexity), scrypt hashing (existing).
- **Real accounts = real PII** (email). Decide retention, who can see the user
  list, and that the DB backups are protected. Don't commit any secret or the
  central DB. `.env` stays gitignored (already is).
- CORS is only needed if you pick the hybrid (Decision 2A); hosted-only is
  same-origin and needs none.

---

## 9. Phased implementation (each phase verified before the next)

- **Phase 0 — icon.** Add the `trophy` glyph, use it for Assessments. Screenshot
  both themes. _Independent of every decision; ships immediately._
- **Phase 1 — accounts & registration.** `app_user` migration (email/display
  name/status/is_demo), `POST /api/auth/register`, role integrity per Decision C,
  a Register screen in the web. Executable auth/register tests (valid, duplicate,
  bad role, disallowed domain, rate limit) added to the security suite.
- **Phase 2 — central serving.** `@fastify/static` serving of the built web, a
  `PROBE_LAB_MODE` switch, a production Dockerfile + compose with a DB volume, and
  a deployment runbook. Verify a clean container boots, registration + login +
  submit work end to end against the persistent volume.
- **Phase 3 — the replica.** `GET /api/assessments/export`, `assessments:pull`,
  local read-only rendering + "last synced". Verify: submit on central → pull →
  local mirror matches → local Record/Clear are inert.
- **Phase 4 (optional) — hybrid submission** (only if Decision 2A includes it):
  CORS on central, the local web targeting the central API for the Assessments
  feature, real login from the local app.
- **Phase 5 — deploy & seed.** Stand up the central instance on the chosen host,
  seed the four demo accounts + your admin, hand you the URL and the runbook.

Each phase: typecheck, lint, prettier, the app + browser suites green, and — for
the auth/registration work — new executable tests, before I move on.

---

## 10. Risks & trade-offs (stated, not hidden)

- **SQLite on a shared server** serialises writes (better-sqlite3 is synchronous).
  Fine for infrequent assessment writes; if you later run heavy wafer practice on
  the central box too, that contends — keep heavy practice local, or move to
  Postgres (Decision A).
- **Durability** rests on the volume + backups. A managed Postgres removes that
  worry at the cost of the rewrite. My recommendation (SQLite + scheduled
  backups) is a deliberate trade for a small team; say the word if you'd rather
  pay the Postgres cost up front.
- **Real accounts add PII and an attack surface** (a public login). The existing
  safeguards (secret-before-exposure, rate limiting, scrypt) cover the basics;
  HTTPS and the domain allowlist are the two things you must not skip.
- **This is a real product/security change, not a practice exercise** — the
  central instance holds real credentials and is internet-reachable. It deserves
  a review before it goes live, and I'll flag anything that needs your explicit
  sign-off (the auth secret, the host, who gets admin).

---

## 11. Rough effort

- Phase 0: trivial (minutes).
- Phase 1: ~half a day (migration + register endpoint + screen + tests).
- Phase 2: ~half a day (static serving + Docker + runbook).
- Phase 3: ~half a day (export + pull + read-only mirror).
- Phase 4 (optional): ~half a day (CORS + hybrid).
- Phase 5: depends on the host you choose.

I'll do them in order, committing each phase on its own branch as usual, and stop
for your review between phases if you want. **Approve §3 (and 2A) and I'll start
with Phase 0.**
