# Hamsun Hospitality — SOP & Training Portal

A staff SOP and training portal for Hamsun Hospitality, a boutique hotel group in
Karachi with four branches (FSL, EXT, CLF and pre-opening DHA). Staff read their
department's standard operating procedures, sign that they've understood them,
watch the attached training video, and take certification tests. Managers publish
SOPs and tests for their own department; admins oversee everything and manage the
org itself.

The core purpose is a **compliance trail** — being able to answer, from a screen,
"has every housekeeping attendant at Clifton read and signed the current
room-standard SOP, and is everyone's food-safety certification still valid?"

> **This build is the portal (frontend), first.** Every screen and flow from the
> reference prototype is implemented and working. Data currently lives in a local,
> browser-side store that is **shaped deliberately to become Supabase**: each
> method on the data layer already looks like the Edge Function that will replace
> it. Supabase (Postgres, Auth, Edge Functions, Storage) and the Google Drive
> integration are **stage two** — see [Stage two](#stage-two-wiring-supabase--drive).

## Running it

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # type-check + production build into dist/
npm run preview  # serve the production build
```

No environment variables, no backend, no keys. It runs entirely in the browser
and persists to `localStorage`. Use **Reset demo data** on the landing page to
return to the seeded starting state.

### Demo sign-ins

**Staff** pick their way in — branch → department → name → numeric code. A few
seeded codes:

| Staff | Branch · Dept | Code |
| --- | --- | --- |
| Imran Yousuf | FSL · Kitchen | `648120` |
| Nadia Kamal | FSL · Housekeeping | `295637` |
| Salma Bibi | CLF · Housekeeping | `640917` (has a failed test awaiting a retest) |
| Waqas Idrees | CLF · Kitchen | `306814` (certificate expiring soon) |

**Managers / admins** sign in with email + password (buttons on the sign-in
screen fill these in):

| Role | Email | Password |
| --- | --- | --- |
| Group admin | `admin@hamsun.example` | `admin123` |
| Kitchen manager (FSL) | `mehreen.kitchen.fsl@hamsun.example` | `kitchen123` |
| Housekeeping manager (Clifton) | `owais.housekeeping.clf@hamsun.example` | `housekeeping123` |

> These demo passwords exist only to make the frontend clickable without a
> backend. They vanish the moment Supabase Auth is wired up.

## What's implemented

- **Three roles, two auth styles.** Staff sign in by branch/department/name/code
  (no emails or passwords); managers and admins sign in by email/password. A
  manager is confined to exactly one department at one branch; an admin sees and
  does everything and manages the org.
- **Branch-scoped SOPs and tests, with derived eligibility.** An SOP that applies
  across branches is **one record with a scope** (`ALL` or an explicit branch
  list), never a copy per branch. Whether a staff member owes a sign-off is
  derived at query time: department matches and scope includes their branch. A
  new branch inherits every `ALL`-scope record the instant it's added — nothing is
  copied or re-assigned. (`src/lib/scope.ts`.)
- **SOP = document + video, one unit, one sign-off.** Each SOP tile shows its
  document-control code and a Video button along its bottom edge. The in-portal
  viewer toggles document/video; the read-and-understood sign-off sits under both.
- **Document-control codes.** Per-department sequences (FD-001, HK-001, …),
  auto-assigned as the next free number, overridable, duplicates rejected.
  (`src/lib/codes.ts`.)
- **Versioning.** Bumping an SOP's version reopens every eligible person's
  obligation to re-sign; old signatures are retained as the trail.
- **Tests, assignment, scores, certification.** Tests are branch-scoped like SOPs,
  but eligibility alone doesn't surface a test — a manager assigns it by name.
  Passing issues a certificate with an expiry; the certification board shows
  valid / expiring-soon / expired; staff get an alert within 30 days of expiry.
- **The retest gate.** One free first attempt, one free renewal once a pass is
  held. After a failure the test **locks** — only a manager/admin can approve
  exactly one attempt, consumed when taken. Enforced in the data layer's
  `submitAttempt`, not just the UI. (`src/data/store.ts`.)
- **Notifications.** A bell with an unread badge; written when a retest is
  approved, a test assigned, an SOP published, or a score recorded. Opening marks
  read. Each notification carries a `whatsapp_pending` flag so the existing Hamsun
  WhatsApp pipeline can later mirror it — a worker reading a queue, not a schema
  change.
- **AI test generation from an SOP.** Pick a source SOP, a difficulty (low =
  recall, medium = on-shift scenario, high = exception/near-miss), and a count.
  Generation **never auto-publishes** — it returns a draft the manager reviews
  with each correct answer highlighted, edits, and only then publishes. Returned
  questions are strictly validated (four options, exactly one correct index) and
  anything invalid is dropped with a warning, falling back to manual authoring.
- **Multiple languages + read-aloud.** English is the canonical copy; Urdu and
  Pashto render right-to-left. Translations are regenerated from the English at
  publish time and never edited independently. Each question has a speaker button
  using the browser's speech synthesis, and the UI is honest when a device has no
  voice for a language (common for Pashto).

## Project layout

```
src/
  types.ts              Data model — every interface maps 1:1 to a future Postgres table
  data/
    seed.ts             Demonstration branches, departments, staff, SOPs, tests, questions
    store.ts            The data layer: reads + the `api.*` methods that become Edge Functions
  lib/
    scope.ts            Branch-scope derivation — the central architectural rule
    codes.ts            Document-control code sequences
    certs.ts            Certificate expiry + status
    hash.ts             Employee-code hashing (see the production note inside)
    tts.ts              Read-aloud, honest about per-language voice availability
    drive.ts            Google Drive embeds + the real story on view-only enforcement
  components/           Shared UI: TopBar, badges, Viewer, notification bell
  screens/
    StaffLogin, StaffPortal, TestRunner       The staff experience
    ManagerLogin, ManagerPortal               Manager/admin shell
    manager/                                  SOP board, test board, composer, org board
```

## Security model (built into the data layer, ready for the real backend)

These rules are implemented in `src/data/store.ts` so that porting them to Edge
Functions is a move, not a redesign:

- **Employee codes are hashed, never stored or logged in plaintext.** The admin
  sees a generated code exactly once. Codes are non-sequential (drawn from the
  CSPRNG) so they can't be guessed from a colleague's.
- **Wrong-code lockout is counted server-side.** Three wrong codes lock a record;
  the counter lives in the data layer, not the browser.
- **The retest gate, the lockout counter, and certificate issuance are all
  enforced in the data layer**, re-checked independently of the UI.
- **Managers are confined by scope.** Every manager-facing method re-checks that
  the target row is in her department and branch — the stand-in for the row-level
  security policy that will enforce it in Postgres.

## Stage two: wiring Supabase & Drive

The eventual architecture, which this frontend is built to drop onto:

### Supabase project

A **dedicated** project for this portal only — it must never share a database
with Hamsun's live systems (the PMS, the CORTI POS, the maintenance portal, or
the WhatsApp system). Tables mirror the interfaces in `src/types.ts`:
`branches`, `departments`, `staff`, `managers`, `sops`, `acknowledgments`,
`tests`, `questions`, `test_assignments`, `attempts`, `certifications`,
`retest_grants`, `notifications`. **Row-level security on from the start** on
every table, with policies that scope managers to their department and branch,
restrict staff to their own rows via the signed staff-login token, and give
admins full access.

### Edge Functions (each `api.*` method maps to one)

| Data-layer method | Edge Function | What moves server-side |
| --- | --- | --- |
| `staffLogin` | `staff-login` | bcrypt-verify the code, count lockout server-side, return a ~one-shift signed token |
| `signSop` | `sign-sop` | write the timestamped acknowledgment |
| `submitAttempt` | `submit-attempt` | score, enforce the retest gate, issue the certificate, write the notification |
| `grantRetest` | `grant-retest` | unlock exactly one attempt, notify the staff member |
| `generateTestDraft` | `generate-test` | fetch the SOP PDF from Drive, call the Claude API at the chosen difficulty, strictly validate the JSON |
| `translateTest` | `translate-test` | call the Claude API to render the question set into Urdu/Pashto |

The **Anthropic API key** and the **Supabase service-role key** live only in Edge
Function environment variables — never in the browser, never committed. Employee
codes move from SHA-256 (this build's browser-only placeholder, see
`src/lib/hash.ts`) to **bcrypt inside `staff-login`**, so a hash never reaches the
browser.

### Google Drive

Documents and videos live in Drive and are **embedded, never re-hosted**. The
staff viewer hides download/print/pop-out controls, but that is only deterrence —
**the real view-only lock is the Drive share setting on each file**: shared as
*Viewer* (never Editor), with "Viewers cannot download, print, or copy" enabled,
kept in a locked folder. In production the upload action pushes the file into that
folder through the Drive API from an Edge Function, stores the returned file ID on
the SOP record, and serves staff only the `/preview` embed. See `src/lib/drive.ts`.

### Read-aloud audio

The browser speech-synthesis version is built now. Pashto voices are rare on
devices, so the production path is to pre-generate audio server-side (Azure TTS
has Pashto voices), store one file per question per language, and have the speaker
button play it. `Question.audio` already holds that field, and `playQuestion`
already prefers a recorded file when present.

## Build order (as shipped, and as recommended for the trial)

1. Branch/department/staff structure, staff code login, SOP library with viewing
   and the read-and-understood sign-off, and the manager/admin sign-off boards.
2. Tests with assignment by name, score history, certification with expiry, the
   retest gate, and notifications.
3. The training-video button on each SOP.
4. AI test generation from a PDF.
5. Multiple languages and read-aloud audio.

All five stages are present in this frontend. Trial each with real staff before
turning on the next; a real thumb on a phone teaches more than the next feature.
