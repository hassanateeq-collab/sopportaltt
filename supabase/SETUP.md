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

The **Write a new SOP** form is a Word-like editor: the manager enters the SOP
title, number, purpose and who it applies to, then writes the body (headings,
fonts, lists, tables). On save the app composes the controlled header (logo +
metadata, matching `SOP_Format.docx`) with the body into a real **.docx** and
sends it (plus an optional video) to the `upload-sop` Edge Function
(`supabase/functions/upload-sop`), which pushes it into your **Hamsun_SOP**
folder (view-only), inserts the SOP and notifies staff. The browser never holds
Drive credentials. (Re-deploy `upload-sop` after this change — it now files a
`.docx` as well as legacy PDFs, and stores the SOP's rendered HTML.)

Apply the SOP-content migrations — `0006_sop_html.sql` and
`0007_sop_editable.sql` add `document_html` and `sop_doc` to `sops`. `sop_doc`
holds the editor body + Purpose + Who-This-Applies-To, so an editor-authored SOP
**opens as a themed page inside the portal** (not the Google Drive preview) and
can be **reopened for editing** with the ✎ Edit button (managers/admins). The
content is written **client-side under RLS**, so this needs only the migration —
no Edge Function redeploy for the native view/edit:

```bash
supabase db push        # or: supabase migration up
# upload-sop only needs redeploying for the .docx naming change (Stage 3a).
```

### Settings → Drive folders (admin)

Migration `0008_dept_drive_folder.sql` adds `departments.drive_folder_id`. The
admin **Settings** tile syncs the live Drive directory, creates folders, and sets
which Drive folder each department's SOPs upload into (test reports go to a
`Tests` sub-folder of it). Managers no longer pick or create folders. Redeploy
`test-report` so it files into the admin-set folder:

```bash
supabase db push
supabase functions deploy test-report
```

**Why not a service account?** A service account owns no Drive storage, so it
can't create files in a personal Gmail's My Drive (`storageQuotaExceeded`). So
the function uploads **as the Hamsun Google account** using an OAuth refresh
token — the files are owned by that account and use its 15 GB.

### One-time Google OAuth setup

1. **Google Cloud Console → APIs & Services → OAuth consent screen.** User type
   **External** → fill app name + your email. Add your Gmail under **Test users**.
   Then **Publish app** (production) so the refresh token doesn't expire after 7
   days. (Accept the "unverified app" notice — it's your own account.)
2. **APIs & Services → Library → enable “Google Drive API”.**
3. **Credentials → Create credentials → OAuth client ID → Web application.**
   Under **Authorized redirect URIs** add:
   `https://developers.google.com/oauthplayground`
   Create it, then copy the **Client ID** and **Client secret**.
4. Get a refresh token at **developers.google.com/oauthplayground**:
   - Click the gear (top right) → tick **Use your own OAuth credentials** → paste
     the Client ID + secret.
   - In the left "Input your own scopes" box enter
     `https://www.googleapis.com/auth/drive` → **Authorize APIs** → sign in as the
     Hamsun Google account and allow.
   - Click **Exchange authorization code for tokens** → copy the **Refresh token**.
5. The **Hamsun_SOP** folder is already owned by that account, so no sharing step
   is needed.

### Give the function its secrets and deploy

**Terminal** commands (PowerShell / bash), in the `sopportaltt` folder — not the
SQL Editor. Prefix with `npx ` if you don't have the CLI installed.

```bash
supabase login
supabase link --project-ref ruqnjxxzeaazqohlpacx

supabase secrets set GOOGLE_CLIENT_ID=your-client-id
supabase secrets set GOOGLE_CLIENT_SECRET=your-client-secret
supabase secrets set GOOGLE_REFRESH_TOKEN=your-refresh-token

supabase functions deploy upload-sop
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are injected
automatically — you only set the three `GOOGLE_*` values.

After it deploys, the **Add SOP** form on the live site really uploads: choose a
PDF + video + folder → the files land in Hamsun_SOP view-only, owned by the
Hamsun account, and the SOP appears on the board. (Keep videos reasonably sized;
very large files may exceed the function request limit — resumable upload is a
later enhancement.)

### Optional: live folder list + create folders from the form

The Add-SOP folder picker can list your real Drive sub-folders and create new
ones (the **＋ New folder** button). Deploy the `drive-folders` function (same
secrets) to turn that on:

```bash
supabase functions deploy drive-folders
```

Until it's deployed, the picker falls back to the five department folders and
creating a folder explains that this function is needed.

### Optional: delete SOPs from Drive too

By default, deleting an SOP in the portal removes only the database record; the
Drive file stays. Deploy the `delete-sop` function (same secrets, no new setup)
to also remove the document/video from Drive on delete:

```bash
supabase functions deploy delete-sop
```

Until it's deployed, delete still works — it just leaves the file in the folder.

### Optional: PDF test reports (filed to Drive)

A staff member's result on a test — their details, the test, the latest result,
the per-question breakdown, the full attempt history and any certificate — can be
downloaded as a PDF from **Tests → a test → Download reports** by an admin or the
owning manager. The PDF is built **in the browser** (so Urdu/Pashto render
correctly), and the `test-report` function files a copy in the department's Drive
folder, named by SOP + date + person. Reuses the `GOOGLE_*` secrets:

```bash
supabase functions deploy test-report
```

If Drive isn't configured the download still works — only the filed copy is
skipped.

To include the **per-question breakdown** (each question with the correct option
and the one the person picked), run migration `0003` and re-deploy the two
functions below, so new attempts store the selected answers:

```bash
# in the SQL Editor: run migrations/0003_attempt_answers.sql
supabase functions deploy submit-attempt
supabase functions deploy test-report
```

Attempts taken before this still report fine — they just note the breakdown
isn't available for those older attempts.

### Optional: add / replace / remove an SOP's training video

The **Manage this SOP** panel can add a training video to an SOP that has none,
replace an existing one, or remove it — without bumping the version (a video
change isn't a new revision, so it doesn't reopen sign-off). The new video lands
in the same Drive folder as the SOP's document, view-only, and replacing/removing
deletes the old Drive file. Deploy it (reuses the `GOOGLE_*` secrets):

```bash
supabase functions deploy attach-video
```

### Optional: the SOP format template (the **SOP format** tile)

The home **SOP format** tile opens a popup where an admin uploads a single
org-wide template document (Word or PDF) that managers write their SOPs in.
Drive is the source of truth — the file lives in a `SOP Format` folder created
under the Hamsun_SOP root; there is no database table. Managers (and admins) can
view/download it; only an admin can upload, replace or remove it. Deploy it
(reuses the `GOOGLE_*` secrets):

```bash
supabase functions deploy sop-format
```

## Stage 5 — AI test generation (Gemini)

`generate-test` reads an SOP's PDF from Drive and drafts questions with the
Google Gemini API (free tier). Generation never auto-publishes — the manager
reviews and edits the draft.

1. Get a **free** Gemini key at **aistudio.google.com → Get API key** (no billing
   needed for the free tier).
2. Set the secret and deploy (the GOOGLE_* secrets are reused to read the PDF):
   ```bash
   supabase secrets set GEMINI_API_KEY=AIza-your-key
   supabase functions deploy generate-test
   ```

Then, in **Create a test → Generate the test from an SOP**, pick a source SOP,
difficulty, count and **language** → **Generate questions** drafts them from the
real document. Choose **Urdu** or **Pashto** and the questions come back written
in that language, and the test is offered to staff in it. Until it's deployed,
the button explains it's needed.

> Re-deploy `generate-test` (same command) after pulling to pick up the language
> option.

### On-demand translation while taking a test

`translate-question` lets a staff member translate any question + its options
into Urdu or Pashto on the spot (a "Read in اردو / پښتو" control on each
question), with the speaker reading the translated text. The option order is
preserved, so scoring is unchanged. It reuses `GEMINI_API_KEY`:

```bash
supabase functions deploy translate-question
```

## Stage 3b — staff sign-in + admin management  ✅ built

This turns on the **staff side** (sign in by name + code, see assigned SOPs and
tests, sign SOPs, take tests) and the **admin management** of managers and staff.

Staff have no Supabase Auth account, so they can't hold a JWT and can't be served
by RLS directly. Instead `staff-login` verifies the bcrypt-hashed code and mints
an **opaque session token** (only its SHA-256 is stored, in `staff_sessions`);
every staff read/write then goes through an Edge Function carrying that token,
and the function returns exactly what that member may see — computed server-side
with the same derived-eligibility rule the RLS policies use. No employee-code
hash ever reaches the browser.

### 1. Run the second migration

Open **SQL Editor → New query**, paste
[`migrations/0002_staff_functions.sql`](./migrations/0002_staff_functions.sql),
**Run**. It adds the `staff_sessions` table and three bcrypt helpers
(`create_staff`, `set_staff_code`, `verify_staff_code`) that hash and verify
employee codes inside Postgres with pgcrypto. Safe to re-run.

### 2. Deploy the functions

No new secrets — every function below runs on the auto-injected `SUPABASE_URL`
and `SUPABASE_SERVICE_ROLE_KEY`.

```bash
# staff side
supabase functions deploy staff-directory   # names for the sign-in dropdown
supabase functions deploy staff-login        # bcrypt verify + lockout + session
supabase functions deploy staff-data         # the signed-in member's portal payload
supabase functions deploy sign-sop           # record an SOP acknowledgment
supabase functions deploy submit-attempt     # score + retest gate + certificate

# manager / admin
supabase functions deploy grant-retest        # approve one retest (grant + notify)
supabase functions deploy manage-staff        # add staff / re-issue a code
supabase functions deploy manage-managers     # create/delete a manager's login
```

After they deploy:

- **Staff** → pick branch, department, your name, enter your code → your SOPs and
  tests. Three wrong codes locks the record for fifteen minutes (counted
  server-side). Signing an SOP and taking a test are recorded live.
- **Admin → Staff** roster: add a member (a six-digit code is generated), see and
  re-issue each person's code, deactivate/reactivate. Only an admin issues codes.
- **Manager → Staff codes**: a manager can look up the codes of staff **in her own
  department + branch** (read-only) so she can re-tell them.
- **Admin → Managers** roster: add a manager (creates their Supabase Auth login;
  a temporary password is shown once unless you set one), reassign their
  department/branch, disable/enable, or delete (removes the login).

### Managers run their whole department (all branches)

A manager now owns their department across **every branch**, not one branch. They
get a "Viewing branch" selector, can publish an SOP or test to a single branch OR
to all branches, and see/assign staff across all branches of their department.
Department is still the wall — a Housekeeping manager never sees Kitchen, and
employee codes stay confined to the department.

1. **Run migration `0005`**
   ([`migrations/0005_manager_all_branches.sql`](./migrations/0005_manager_all_branches.sql))
   in the SQL Editor — it drops the single-branch restriction from the manager
   policies.
2. **Re-deploy** the function that enforced single-branch publishing:
   ```bash
   supabase functions deploy upload-sop
   ```

Existing managers keep their branch as a default "home" view; nothing else to
change.

### Test reports filed into a per-department "Tests" folder

Test-result PDFs are never stored in Supabase — they're generated in the browser
and filed to Google Drive. They now land in a **`Tests`** sub-folder of each
department's Drive folder (created automatically), kept separate from the SOP
documents. Re-deploy:

```bash
supabase functions deploy test-report
```

### Cross-department test assignment

A manager builds a test from their own department's SOP but can assign it to
**any staff member in any department or branch** (e.g. an HR/compliance test
everyone must pass). Assignment is the authority — an assigned person sees and
takes the test even though it's another department's test.

1. **Run migration `0004`** in the SQL Editor
   ([`migrations/0004_cross_department_assign.sql`](./migrations/0004_cross_department_assign.sql)).
   It widens a manager's *read* access just enough to see the results of people
   they assigned from other departments (assignment/attempt/certificate rows for
   the manager's own tests). Staff-row reads are **not** widened, so employee
   codes stay confined to a person's own department manager.
2. **Deploy the functions** (re-deploy `staff-data` so assigned cross-department
   tests reach the staff portal):
   ```bash
   supabase functions deploy org-staff       # names for the cross-dept picker
   supabase functions deploy assign-test      # assign/unassign any staff + notify
   supabase functions deploy staff-data       # include assigned cross-dept tests
   ```

On **Tests → a test → Assign staff by name**, the manager now searches all staff
(name / department / branch) and assigns anyone. The manager can only assign
tests **they built in their own department**; an admin can assign any test.

> **On employee codes.** These are simple sign-in PINs, so the plaintext is kept
> and shown to authorised people who need to hand them out. Row-level security
> makes the code readable only by an admin, by the manager of that person's
> department + branch, and by the staff member themselves — never by the public,
> and the sign-in name dropdown never includes it. (The bcrypt hash is still what
> verifies a sign-in.)

Deactivating a staff member and reassigning a manager are plain column changes an
admin makes directly under RLS — only the writes that touch a bcrypt hash or a
Supabase Auth user need the functions above.

> **Sessions.** A staff token lasts about one shift (9 h) and is cleared from the
> browser on sign-out. There's no separate revoke endpoint — the token simply
> expires. On a shared device, always sign out.

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
