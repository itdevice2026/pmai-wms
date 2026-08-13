# Deploying PMAI WMS

Three steps: push to GitHub, connect Vercel, set two environment variables.
The database is already provisioned and seeded — nothing to run against it.

---

## 1. Push to GitHub

Create an empty repository at **https://github.com/new** named `pmai-wms`
(private). Do not add a README, .gitignore or licence — the repo already has them.

Then, in the project folder:

```bash
git remote add origin https://github.com/itdevice2026/pmai-wms.git
git branch -M main
git push -u origin main
```

GitHub will ask for your username and a password. **The password field wants a
Personal Access Token, not your account password** — GitHub stopped accepting
account passwords for git in 2021. Create one at
**Settings → Developer settings → Personal access tokens → Tokens (classic)**
with the `repo` scope, and paste that as the password.

---

## 2. Connect Vercel

1. Go to **https://vercel.com/new** and sign in with GitHub.
2. Import the `pmai-wms` repository.
3. Leave every build setting at its default — `vercel.json` already sets the
   framework and the Singapore region (`sin1`), which is the closest to the plant.
4. **Do not deploy yet.** Add the environment variables first (next step),
   or the first build will succeed but every page will error at runtime.

---

## 3. Environment variables

In Vercel: **Project → Settings → Environment Variables**. Add both to
Production, Preview and Development.

### `AUTH_SECRET`

Generate a fresh one — never reuse the development value:

```bash
openssl rand -base64 32
```

The app refuses to serve production traffic without this. That is deliberate:
a predictable signing key would let anyone forge a session cookie.

### `DATABASE_URL`

In Supabase: **Project `pmai-warehouse-wms` → Connect → Connection string →
Transaction pooler**. Copy the URI and replace `[YOUR-PASSWORD]` with your
database password (Supabase → Settings → Database → Reset database password if
you don't have it).

It must look like this — note **port 6543** and the `pooler` host:

```
postgresql://postgres.cayhkmnjlvifogaiksvg:YOUR-PASSWORD@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres
```

> **Use the pooler, not the direct connection.** Vercel runs each request in its
> own instance. Against a direct connection (port 5432) a busy shift opens
> hundreds of Postgres connections and the database starts refusing them. The
> app logs a warning if it detects this, but the pooler is the fix.

Then click **Deploy**.

---

## 4. First sign-in

| | |
|---|---|
| URL | `https://<your-project>.vercel.app` |
| Email | `itdevice@meatplus.ph` |
| Temporary password | *(sent separately — change it immediately)* |

**Change the password on first sign-in** at **System → My Account**. The
temporary one was generated during setup and should not survive your first
session.

Then create the real users under **System → Admin**, and set each role's access
under **System → RBAC**.

### Verify the deployment

```
https://<your-project>.vercel.app/healthz
```

Should return `{"status":"ok","database":"up",...}`. If it says `"database":"down"`,
`DATABASE_URL` is wrong — that endpoint exists precisely so a monitor catches a
broken database link rather than reporting a green app that cannot serve a page.

---

## What is already done

- Full schema, 49 tables, 7 views, 7 functions
- Reference data: 7 roles, 46 permissions, 125 grants, 4 storage rooms,
  420 slots (Room 1 = 132, matching the live plant), 85 SKUs, stations,
  growers, customers
- Login rate limiting: 5 failures per email or 20 per IP in 15 minutes
- Security headers: CSP, HSTS, X-Frame-Options, nosniff, Referrer-Policy
- `/healthz` for uptime monitoring
- GitHub Actions CI: lint, typecheck, build, plus the workflow and route tests

## What is not done

- **The weighing scale is not wired up.** Operators key the weight today.
  See "Connecting the scale" below.
- **No automated backups.** Supabase's free tier does not include point-in-time
  recovery. Take a nightly dump until you upgrade:
  `pg_dump "$DATABASE_URL" | gzip > wms-$(date +%F).sql.gz`
- **Sessions last 12 hours with no idle timeout.** Fine for office use, worth
  shortening if plant-floor terminals are shared and unattended.

---

## Connecting the scale

`src/lib/scale.ts` is the only file that has to change. Set on the weighing PC's
browser (or as Vercel env vars):

```
NEXT_PUBLIC_SCALE_MODE=bridge
NEXT_PUBLIC_SCALE_URL=ws://127.0.0.1:8787
```

Then run a small agent on that PC that reads the indicator's serial port and
emits one JSON frame per reading over a websocket:

```json
{"weightKg": 1.234, "stable": true}
```

The weighing screen fills the weight field automatically when `stable` is true.
The CSP already allows `ws:`/`wss:` connections for exactly this.

> Because the bridge runs on the weighing PC and the browser connects to
> `127.0.0.1`, this works even though the app itself is hosted in the cloud —
> the scale traffic never leaves the plant.

---

## Running it on your own server instead

If you would rather keep it beside `pmaiwarehouse.meatplus.ph`:

```bash
docker build -t pmai-wms .
docker run -d --name pmai-wms -p 3000:3000 \
  -e DATABASE_URL='postgresql://...' \
  -e AUTH_SECRET='...' \
  --restart unless-stopped \
  pmai-wms
```

The image is a standalone Next.js build with a built-in `HEALTHCHECK`. Put it
behind your existing reverse proxy and terminate TLS there.

This is the better option if the plant must keep weighing during an internet
outage.
