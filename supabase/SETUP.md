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

## Stage 2 — Frontend client + real manager/admin auth  (next)

Add `@supabase/supabase-js`, wire the manager/admin login to your real Supabase
Auth, and read the boards from Supabase — all behind an env flag so the demo
stays up until we flip it. You'll set two env vars (URL + anon key) in Vercel.

## Stage 3 — Edge Functions

`staff-directory`, `staff-login` (bcrypt code + server-side lockout + a
short-lived staff JWT), `sign-sop`, `submit-attempt` (retest gate + certificate),
`grant-retest`. Deployed with the Supabase CLI; the `service_role` and any
Anthropic key live only in their secrets.

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
