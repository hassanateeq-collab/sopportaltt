# Hamsun Portal — Integration API

A single REST-ish API another system (a second portal) can call to **read from**
and **write into** this portal. It covers all four content types — **SOPs,
Policies, Assessments (tests), and Training records** — in both directions.

It is one Supabase Edge Function named `api`, authenticated by a shared secret
you send in the `x-api-key` header. This portal remains the system of record and
owns the Google Drive side: when the other portal uploads a document, this
portal stores the file in Drive and notifies staff.

---

## 1. Base URL

```
https://ruqnjxxzeaazqohlpacx.supabase.co/functions/v1/api
```

Every endpoint below is a path under that base, e.g.
`GET https://ruqnjxxzeaazqohlpacx.supabase.co/functions/v1/api/sops`.

## 2. Authentication

Send the shared API key in the **`x-api-key`** header on **every** request:

```
x-api-key: <THE_INTEGRATION_API_KEY>
```

- No Supabase key or JWT is needed — just `x-api-key`.
- A missing or wrong key returns `401`. Before the key is configured on the
  portal, requests return `503`.
- The key is a secret. Store it in the other portal's server-side config
  (an environment variable / secret manager), never in its browser code and
  never in a URL. Treat it like a password.

Quick check that the key works:

```bash
curl -s https://ruqnjxxzeaazqohlpacx.supabase.co/functions/v1/api \
  -H "x-api-key: $KEY"
```

Returns the API name, version, and the list of endpoints.

## 3. Reference data — `GET /meta`

The valid **department codes** and **branch codes** every other call expects.

```bash
curl -s "$BASE/meta" -H "x-api-key: $KEY"
```

```json
{
  "departments": [
    { "code": "FD", "name": "Front Desk" },
    { "code": "HK", "name": "Housekeeping" },
    { "code": "KT", "name": "Kitchen" },
    { "code": "MT", "name": "Maintenance" },
    { "code": "QC", "name": "Quality & Compliance" }
  ],
  "branches": [
    { "code": "FSL", "name": "Shahrah-e-Faisal", "status": "open" },
    { "code": "CLF", "name": "Clifton", "status": "open" },
    { "code": "EXT", "name": "Extension", "status": "open" },
    { "code": "DHA", "name": "DHA", "status": "pre_opening" }
  ]
}
```

---

## 4. SOPs

### `GET /sops` — list SOPs

Query params (both optional): `department` (code), `branch` (code).

```bash
curl -s "$BASE/sops?department=HK&branch=CLF" -H "x-api-key: $KEY"
```

```json
{
  "sops": [
    {
      "id": "7b3f…",
      "code": "HK-001",
      "title": "Guest Room Cleaning",
      "summary": "",
      "department": { "code": "HK", "name": "Housekeeping" },
      "branches": "ALL",
      "version": 1,
      "document_url": "https://drive.google.com/file/d/<id>/view",
      "video_url": null,
      "published_by": "Owais Khan",
      "updated_at": "2026-02-10T09:12:00.000Z"
    }
  ]
}
```

`branches` is either the string `"ALL"` or an array of branch codes, e.g.
`["CLF","FSL"]`.

### `POST /sops` — create an SOP

`Content-Type: multipart/form-data`. This portal uploads the file to Google
Drive (view-only) and publishes the SOP live to its department's staff.

| Field          | Required | Notes |
|----------------|----------|-------|
| `file`         | yes      | The SOP document (PDF or DOCX). |
| `title`        | yes      | SOP title. |
| `department`   | yes      | Department **code** (see `/meta`), e.g. `HK`. |
| `branches`     | no       | Comma-separated branch codes, e.g. `CLF,FSL`. Omit = all branches. |
| `code`         | no       | Document-control code, e.g. `HK-007`. Omit = auto-numbered within the department. |
| `summary`      | no       | Short description. |
| `video`        | no       | Optional training video file. |
| `published_by` | no       | Name to credit. Defaults to `External portal`. |

```bash
curl -s -X POST "$BASE/sops" \
  -H "x-api-key: $KEY" \
  -F "title=Guest Room Cleaning" \
  -F "department=HK" \
  -F "branches=CLF,FSL" \
  -F "file=@/path/to/sop.pdf"
```

Returns `201` with `{ "sop": { …same shape as the list… } }`.

---

## 5. Policies

### `GET /policies` — list policies

Query params (both optional): `department` (code), `status` (`published` or `draft`).

```bash
curl -s "$BASE/policies?status=published" -H "x-api-key: $KEY"
```

```json
{
  "policies": [
    {
      "id": "a91c…",
      "code": "POL-HK-001",
      "title": "Lost & Found",
      "summary": "How we log and return guest property.",
      "department": { "code": "HK", "name": "Housekeeping" },
      "version": 1,
      "status": "published",
      "document_url": "https://drive.google.com/file/d/<id>/view",
      "published_by": "Nida Farooq",
      "updated_at": "2026-02-11T10:00:00.000Z",
      "created_at": "2026-02-11T10:00:00.000Z",
      "acknowledgments": {
        "version": 1,
        "count": 1,
        "people": [
          { "name": "Altamash", "role": "manager", "acknowledged_at": "2026-02-12T07:30:00.000Z" }
        ]
      }
    }
  ]
}
```

**Acknowledgments.** Each policy carries who has read & acknowledged its **current
version** — `count` plus a `people` array of `{ name, role, acknowledged_at }`.
`role` is one of `admin`, `hr`, `manager`, `branch_manager`, or `staff`. When
someone clicks **Read & acknowledge** in this portal, they appear here on the
next read, so the other portal can display e.g. "Altamash has acknowledged." (A
re‑issue bumps `version` and reopens the obligation, so the list resets.) The
other portal sees changes by re‑reading this endpoint — there is no push/webhook.

### `POST /policies` — publish a policy

`Content-Type: multipart/form-data`. Uploads the file to Drive and publishes the
policy; **every active staff member is notified** to read and acknowledge it.

| Field          | Required | Notes |
|----------------|----------|-------|
| `file`         | yes      | The policy document (PDF or DOCX). |
| `title`        | yes      | Policy title. |
| `department`   | yes      | Department **code**, e.g. `HK`. |
| `code`         | no       | e.g. `POL-HK-002`. Omit = auto-numbered. |
| `summary`      | no       | Short description. |
| `published_by` | no       | Name to credit. Defaults to `External portal`. |

```bash
curl -s -X POST "$BASE/policies" \
  -H "x-api-key: $KEY" \
  -F "title=Lost & Found" \
  -F "department=HK" \
  -F "summary=How we log and return guest property." \
  -F "file=@/path/to/policy.pdf"
```

Returns `201` with `{ "policy": { …same shape as the list… } }`.

---

## 6. Assessments (tests)

### `GET /assessments` — list tests with results

Query param (optional): `department` (code).

```bash
curl -s "$BASE/assessments?department=HK" -H "x-api-key: $KEY"
```

```json
{
  "assessments": [
    {
      "id": "c4d2…",
      "title": "Room Cleaning Standards",
      "department": { "code": "HK", "name": "Housekeeping" },
      "branches": "ALL",
      "pass_mark": 80,
      "validity_months": 12,
      "languages": ["en", "ur"],
      "status": "published",
      "question_count": 10,
      "results": {
        "total_attempts": 34,
        "staff_attempted": 22,
        "staff_passed": 19,
        "pass_rate": 86
      }
    }
  ]
}
```

`results` counts the **latest** attempt per staff member (`pass_rate` is
`staff_passed / staff_attempted`).

### `POST /assessments` — create a test (quiz)

`Content-Type: application/json`.

| Field             | Required | Notes |
|-------------------|----------|-------|
| `title`           | yes      | Test title. |
| `department`      | yes      | Department **code**, e.g. `HK`. |
| `questions`       | yes      | Array; each `{ "text", "options": [4 strings], "correct_index": 0–3 }`. |
| `pass_mark`       | no       | 1–100. Default `80`. |
| `validity_months` | no       | 1–120. Default `12`. |
| `branches`        | no       | Array or comma-string of branch codes. Omit = all branches. |
| `languages`       | no       | e.g. `["en","ur"]`. Default `["en"]`. |
| `status`          | no       | `published` (default) or `draft`. |

```bash
curl -s -X POST "$BASE/assessments" \
  -H "x-api-key: $KEY" -H "Content-Type: application/json" \
  -d '{
    "title": "Room Cleaning Standards",
    "department": "HK",
    "pass_mark": 80,
    "questions": [
      { "text": "How often are high-touch surfaces disinfected?",
        "options": ["Hourly","Every clean","Weekly","Never"],
        "correct_index": 1 }
    ]
  }'
```

Returns `201` with `{ "assessment": { … } }`.

---

## 7. Training records — `GET /training`

Per-staff training status, computed from each person's **assigned tests** and
their latest attempt. Query params (both optional): `department`, `branch`.

```bash
curl -s "$BASE/training?department=HK&branch=CLF" -H "x-api-key: $KEY"
```

```json
{
  "training": [
    {
      "staff": {
        "id": "f0a1…",
        "name": "Hina Raza",
        "job_title": "Room Attendant",
        "department": { "code": "HK", "name": "Housekeeping" },
        "branch": { "code": "CLF", "name": "Clifton" }
      },
      "summary": { "assigned": 3, "passed": 2, "failed": 0, "not_taken": 1 },
      "assessments": [
        { "test_id": "c4d2…", "title": "Room Cleaning Standards",
          "status": "passed", "percentage": 90,
          "attempted_at": "2026-02-09T08:00:00.000Z" }
      ]
    }
  ]
}
```

Each assessment `status` is `passed`, `failed`, or `not_taken`. Training records
are **read-only** here — they are derived from assessment attempts, not uploaded.
To add a result, the staff member takes the test in this portal, or create the
test with `POST /assessments` and have them sit it.

---

## 8. Errors

JSON body `{ "error": "…message…" }` with an HTTP status:

| Status | Meaning |
|--------|---------|
| `400`  | Bad input (missing field, unknown department/branch code). |
| `401`  | Missing or invalid `x-api-key`. |
| `404`  | Unknown route. |
| `409`  | A document-control code you supplied is already in use. |
| `500`  | Server/Drive error. |
| `503`  | The API key isn't configured on the portal yet. |

---

## 9. One-time setup (portal owner)

Run these once, from the project root, against the Supabase project:

**a) Generate a strong key and set it as a function secret** (never paste it in
chat or commit it):

```bash
# Generate a random 48-char key
openssl rand -hex 24

# Store it as the function secret
npx supabase secrets set INTEGRATION_API_KEY=<the-key-you-generated> \
  --project-ref ruqnjxxzeaazqohlpacx
```

The Google Drive secrets (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
`GOOGLE_REFRESH_TOKEN`) are already set for the other functions and are reused
here — no new Drive setup is needed.

**b) Deploy the function with JWT verification OFF** (so the other portal only
needs `x-api-key`, not a Supabase key):

```bash
npx supabase functions deploy api --no-verify-jwt \
  --project-ref ruqnjxxzeaazqohlpacx
```

> If your Supabase CLI version has dropped the `--no-verify-jwt` flag, add this
> to `supabase/config.toml` instead and deploy without the flag:
> ```toml
> [functions.api]
> verify_jwt = false
> ```

**c) Share with the other portal's developer:** the Base URL (section 1) and the
API key — the key over a secure channel, not in chat.

---

## 10. Security notes

- `x-api-key` is the entire security boundary: anyone with the key can read and
  write all content. Keep it server-side on the other portal, rotate it if it
  ever leaks (re-run step 9a with a new value and redeploy), and use HTTPS only
  (the Base URL already is).
- Writes run with full privileges inside the portal, so only hand the key to a
  system you control.
- Uploaded documents are stored view-only in Google Drive, exactly like
  documents added through this portal's own UI.
