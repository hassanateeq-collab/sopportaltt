# Supabase setup — stage by stage

This portal is being moved from the browser-only demo onto Supabase. We're doing
it in stages so the **live Vercel site keeps working** the whole time. This file
tracks what to run and in what order.

Project: `ruqnjxxzeaazqohlpacx` · URL `https://ruqnjxxzeaazqohlpacx.supabase.co`

> **Security reminder.** The `anon` key is public and safe in the browser. The
> `service_role` key is a master key — it only ever goes into Edge Function
> secrets, never the frontend, never a commit. Since it was shared in chat once,
> rotate it when convenient: Dashboard → Settings → API → *Reset service_role*.

---

## Stage 1 — Schema + row-level security  ← you are here

**File:** [`migrations/0001_init.sql`](./migrations/0001_init.sql)

This creates all 13 tables, turns on row-level security with real policies, and
seeds the four branches and five departments. It was verified end-to-end on
Postgres 17: admins see everything, a manager sees only her own department +
branch, staff see only their own rows, and a manager is physically blocked from
publishing group-wide or to another branch.

### Run it

1. Open your project → **SQL Editor** → **New query**.
2. Paste the whole file, **Run**. It's safe to re-run if you need to.

No email to edit: the admin link **auto-detects**. Because your project has a
single Auth user (your admin), the migration links that user as the admin
automatically — you'll see a `Linked admin: <your email>` notice in the output.
(If you later have several Auth users it won't guess; it prints them and the
one-line snippet to link the right one.)

### Check it worked

- **Table Editor** should now list `branches` (4 rows), `departments` (5 rows),
  `staff`, `sops`, `tests`, and the rest.
- Run this to confirm your admin is linked (should return one row):
  ```sql
  select a.name, a.email, u.email as auth_email
  from public.admins a join auth.users u on u.id = a.auth_user_id;
  ```

Once the tables are there and the admin row is linked, tell me and we move to
Stage 2.

---

## Stage 2 — Frontend client + real manager/admin auth  ✅ built

The app now has a Supabase client and switches on automatically when two public
env vars are present. With them set, the manager/admin login authenticates
against **your real Supabase Auth**, and the boards show **live data** from your
database (scoped by RLS). Without them, the app stays the localStorage demo — so
the current live site is unaffected until you set the vars and redeploy.

What works after this stage: real admin/manager sign-in, and viewing your live
branches, departments, staff, SOPs, tests and certification data. What's
deliberately deferred to Stage 3 (needs Edge Functions): **staff sign-in** and
**saving edits** (publishing SOPs/tests, adding staff, approvals) — those need
server-side hashing, auth-user creation and notification writes. Until then those
actions show a friendly "switches on in the next update" message instead of
silently changing only the local cache.

### Turn it on

1. **Vercel → your project `hamsun-sop-portal` → Settings → Environment
   Variables.** Add both (safe to expose — the anon key is public and RLS
   protects the data):

   | Name | Value |
   | --- | --- |
   | `VITE_SUPABASE_URL` | `https://ruqnjxxzeaazqohlpacx.supabase.co` |
   | `VITE_SUPABASE_ANON_KEY` | your anon **public** key (Supabase → Settings → API) |

   Apply them to **Production** (and Preview/Development if you use those).
2. These are read at **build time**, so you must redeploy after adding them:
   ```bash
   git pull
   vercel --prod
   ```
3. Open the live URL → **Manager or admin sign in** → use your real Supabase
   email + password. You should land on the boards showing your real data.

For local development, copy `.env.example` to `.env.local` and put the same two
values in it, then `npm run dev`.

## Stage 3a — Drive upload (the `upload-sop` function)  ← turns on Add SOP

The Add-SOP form uploads a PDF + optional video and picks a Drive folder. The
files are pushed into your **Hamsun_SOP** folder (view-only) by the
`upload-sop` Edge Function (`supabase/functions/upload-sop`), which then inserts
the SOP and notifies staff. The browser never holds Drive credentials — the
function uses a **Google service account**.

### One-time Google setup

1. **Google Cloud Console** (console.cloud.google.com) → create or pick a project.
2. **APIs & Services → Library → enable the “Google Drive API”.**
3. **APIs & Services → Credentials → Create credentials → Service account.**
   Give it a name; no roles needed. Open the new service account → **Keys → Add
   key → Create new key → JSON** and download the file.
4. Copy the service account’s **email** (looks like
   `name@project.iam.gserviceaccount.com`). In Google Drive, open the
   **Hamsun_SOP** folder → **Share** → add that email as **Editor** (this
   cascades to the department sub-folders). This is what lets the function upload.

### Give the function its secrets and deploy

From the repo root (after `supabase login` and `supabase link --project-ref
ruqnjxxzeaazqohlpacx`):

```bash
# store the service-account key as a secret (never committed, never in the browser)
supabase secrets set GOOGLE_SERVICE_ACCOUNT="$(cat /path/to/your-service-account.json)"

# deploy the function
supabase functions deploy upload-sop
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are injected
automatically — you only set `GOOGLE_SERVICE_ACCOUNT`.

After it deploys, the **Add SOP** form on the live site really uploads: choose a
PDF + video + folder → the files land in Hamsun_SOP view-only and the SOP appears
on the board. (Keep videos reasonably sized; very large files may exceed the
function request limit — resumable upload is a later enhancement.)

## Stage 3b — the remaining Edge Functions

`staff-directory`, `staff-login` (bcrypt code + server-side lockout + a
short-lived staff JWT), `sign-sop`, `submit-attempt` (retest gate + certificate),
`grant-retest`. Deployed the same way; the `service_role` and any Anthropic key
live only in their secrets.

## Stage 4 — Cut over + redeploy

Flip the data layer to Supabase, set the Vercel env vars, redeploy, verify each
flow on the live URL.

## Stage 5 — AI Edge Functions

`generate-test` and `translate-test` on the Claude API (needs an Anthropic key in
the function secrets).

---

### CLI prep (needed from Stage 3 on)

```bash
npm i -g supabase          # or: scoop install supabase (Windows)
supabase login             # opens the browser to your Supabase account
supabase link --project-ref ruqnjxxzeaazqohlpacx
```

You can do Stage 1 entirely in the dashboard — the CLI isn't needed until we
deploy Edge Functions.
