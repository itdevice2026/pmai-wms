# Deploying to GitHub Pages + Supabase

No third service. GitHub hosts the app, Supabase holds the data and enforces
every rule.

---

## 1. Push to GitHub

Create an empty **private** repo named `pmai-wms` at https://github.com/new
(no README, no .gitignore — this repo has them). Then:

```bash
git remote add origin https://github.com/itdevice2026/pmai-wms.git
git branch -M main
git push -u origin main
```

When git asks for a password it wants a **Personal Access Token**, not your
account password. Create one at Settings → Developer settings → Personal access
tokens (classic) with the `repo` scope.

> GitHub Pages on a **private** repo needs GitHub Pro or an organisation plan.
> On the free plan, make the repo public — that is safe here: the repo contains
> no secrets (verified — the build carries only the publishable key), and all
> access control lives in the database.

## 2. Set two repository variables

**Settings → Secrets and variables → Actions → Variables → New variable.**
These are *variables*, not secrets — they are baked into a public JavaScript
bundle by design.

| Name | Value |
|---|---|
| `SUPABASE_URL` | `https://cayhkmnjlvifogaiksvg.supabase.co` |
| `SUPABASE_ANON_KEY` | `sb_publishable_QRuciPYjzloVb-XchNe3VQ_xf1YwheR` |

## 3. Turn on Pages

**Settings → Pages → Build and deployment → Source: GitHub Actions.**

Push (or run the *Deploy to GitHub Pages* workflow manually). Your URL will be:

```
https://itdevice2026.github.io/pmai-wms/
```

## 4. Sign in

Email `itdevice@meatplus.ph` with the temporary password issued during setup.
**Change it immediately** at System → My Account.

---

## Why this is safe without an application server

There is no server to enforce rules, so the database does it:

- **Reads** — every table has row-level security. A user only sees what their
  role's permissions allow.
- **Writes** — the `authenticated` role has **no INSERT, UPDATE or DELETE on
  any table**. Verified: the grant query returns zero rows. Every change goes
  through a `SECURITY DEFINER` function (`rpc_*`) that re-checks permission,
  the crate lifecycle and period locks.
- **Role and permissions** come from the database on each session, never from
  the JWT, so a tampered token grants nothing.

`scripts/security-test.sql` impersonates a signed-in browser and attempts the
attacks this architecture is vulnerable to — direct inserts, privilege
escalation, wiping the audit trail, clearing the login-lockout history, illegal
lifecycle jumps. Run it after any change to RLS, grants or the RPC layer:

```bash
psql "$DATABASE_URL" -f scripts/security-test.sql   # every row must read PASS
```

## Screen coverage in the browser build

Working: Dashboard, BD Weighing Entry, BD Scan Station, Storage Map,
Stock on Hand, User Activity Log, My Account.

The remaining screens show a "not in the browser build yet" placeholder. They
exist and are tested in the Next.js server build in the same repo — the
database, permissions and write API they need are already live, so porting each
one is mechanical rather than exploratory.

If you want all 36 screens working immediately, deploy the Next.js app instead
(see `DEPLOY.md`) — it is complete and needs only a host that runs Node.

## Known limits of the browser-only approach

- **CSV export** is client-side only; large exports are built in the browser.
- **Scale bridge** still needs an agent on the weighing PC (see `DEPLOY.md`).
- **No server-side rate limiting on sign-in** — Supabase Auth applies its own
  per-IP limits at the edge; the `login_attempts` table is used by the Next.js
  build only.
