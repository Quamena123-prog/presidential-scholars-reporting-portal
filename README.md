# Presidential Scholars Academic Reporting Portal

A real, working Node.js + SQLite web application for the Presidential Scholars
Program. Scholars open a link, submit their **semester academic report**
(student info, semester, credit hours and GPAs), and the record is stored
permanently. **Dr. P** logs into a separate back office where every report can
be reviewed, searched, filtered, sorted, edited, verified, archived and
exported.

- **Student form:** http://localhost:3000/  (also `/submit`)
- **Admin login:**  http://localhost:3000/admin
- **Admin dashboard:** http://localhost:3000/admin/dashboard

### First-run login

| Field | Value |
|---|---|
| Username | `drp` |
| Password | `?Livingstone1879!` |

Change it any time from **Change Password** in the admin sidebar, or set your
own with `ADMIN_PASSWORD` (see below). On hosted deployments the admin
password is kept in sync with `ADMIN_PASSWORD` automatically.

---

## What the application does

### Student form (no account needed)

A three-step flow — **Fill In → Review → Submitted**:

1. **Student Information** — Student ID, Last Name, First Name, Major,
   Classification (Freshman / Sophomore / Junior / Senior).
2. **Semester Information** — Academic Year (e.g. `2026–2027`), Semester
   (Fall / Spring / Summer).
3. **Academic Performance** — Attempted credit hours, Passed credit hours
   (never more than attempted), Semester GPA and Career GPA (0.00–4.00).

- Inline validation with an accessible error summary; each section shows a
  completed tick as it is filled in.
- **Review screen** shows the whole report with **Edit Information** and
  **Submit Report** before anything is saved.
- The report is **saved first**, then a confirmation page shows the reference
  (e.g. `PSR-2026-A7K2Q9`), Student ID, name, semester, academic year, and the
  submission date and time — plus **Submit Another Report**.
- **Duplicate protection:** one report per student per term. A second attempt
  is blocked with *"A report for this student and semester has already been
  submitted."* (An administrator may still edit the row.)
- Hidden honeypot field and rate limiting deter bots and abuse. There is no
  public lookup, so references cannot be enumerated.
- No student accounts, no login, no registration.

### Admin portal (separate login + dashboard pages)

- `/admin` is a dedicated sign-in page; on success it goes to the separate
  `/admin/dashboard` page. Logged-in visitors are taken straight to the
  dashboard, and the dashboard bounces unsigned visitors back.
- **Five stat cards** computed from real records: Total Reports, Reports
  Submitted This Semester (auto-detects the current term), Average Semester
  GPA, Average Career GPA, and Total Students.
- **Reports by Status** breakdown (Pending / Verified / Needs Correction /
  Rejected / Archived); clicking one filters the table.
- Debounced **search** across Student ID, First Name, Last Name and Major, plus
  combinable filters for Academic Year, Semester, Classification, Major and
  Status with a **Clear Filters** button. Sorting on every column with
  server-side pagination and per-page size.
- Click any row (keyboard accessible) for the **Report drawer**: student
  information, semester, academic performance, submission details, private
  administrator notes (never exported), review actions, and a full audit trail
  of who did what and when.
- Review workflow: **Approve** (verified), **Needs Correction**, **Reject**,
  **Archive / Restore**, plus **Edit** (in a modal) and **Delete** (with a
  confirmation). Every action is recorded in the audit trail.
- Real exports of the current filtered set across all pages: **CSV** and
  genuine **.xlsx** (Excel), with readable headings and spreadsheet-formula
  protection. Internal notes are excluded.

---

## About the database (read this first)

This app uses **SQLite**, a full relational database stored as a single file:

```
data/presidential_scholars.db
```

When a student submits the form, a row is written to the `academic_reports`
table. When you restart the server, the data is still there. Nothing else needs
installing — everything is built into Node.js.

Tables created automatically:

- `academic_reports` — every submission: student, classification, major,
  academic year and semester, attempted/passed credit hours, semester and
  career GPAs, `confirmation_reference`, `review_status`
  (`pending`/`verified`/`rejected`/`needs_correction`/`archived`),
  `reviewed_by`, `reviewed_at`, `archived_at` and private `internal_notes`.
  A unique index enforces **one report per student per term**.
- `academic_report_audit` — submit/edit/review/archive history per report
- `admins` — back office accounts (passwords stored as scrypt hashes)
- `sessions` — active logins

Upgrading keeps your data: on startup the server adds any missing columns and
indexes without touching existing rows, and backfills unique confirmation
references for legacy rows.

> The server talks to regular SQLite on your machine. It can also run on
> Vercel's serverless platform against a Turso (libSQL) cloud database by
> setting `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` — the same SQL runs on
> both.

---

## Requirements

- **Node.js 22.5 or newer** (this machine already has Node 25). Check with:
  ```
  node --version
  ```

The default local backend uses only Node's built-in modules, but
`npm install` is still required once so `@libsql/client` is available for
hosted (Turso) deployments.

## Run the app

```
node server.js
```

Then open <http://localhost:3000/> for the student form and
<http://localhost:3000/admin> for the admin portal. To keep it running in the
background on Windows:

```
start /b node server.js
```

### Change the port or credentials

PowerShell example:

```
$env:PORT = "4000"
$env:ADMIN_USERNAME = "drp"
$env:ADMIN_PASSWORD = "YourStrongPass1"
$env:ADMIN_FULL_NAME = "Dr. P"
node server.js
```

The default admin is only created the first time, when the `admins` table is
empty. To reset it later, delete `data/presidential_scholars.db` and start
again (or use **Change Password** inside the app).

---

## Features

### Student form
- No account needed; clean, mobile-first, institutional design
- Three-step flow with a progress bar and per-section completion ticks
- Inline validation plus an accessible error summary
- Review-before-submit with **Edit Information**
- Confirmation page with reference number and timestamp,
  **no public look-up**
- Duplicate protection per student per term (also enforced in the database)
- Hidden honeypot field and rate limiting against bots

### Admin back office
- Separate login page (`/admin`) and dashboard page (`/admin/dashboard`)
- Five stat cards computed from real records, synced to the active filters
- Reports-by-status breakdown charts to click-filter the table
- Debounced search plus combinable filters and **Clear Filters**
- Sortable columns and server-side pagination
- Click any row (keyboard accessible) for the report drawer with audit trail
- Review workflow: Approve / Needs Correction / Reject / Archive / Restore /
  Edit / Delete, each recorded with reviewer name and timestamp
- Private administrator notes, kept out of exports
- Real CSV and genuine .xlsx exports of the filtered set across all pages

---

## Security

- **Passwords** — hashed with scrypt + a random per-user salt; verified with a
  timing-safe comparison. Plain text is never stored.
- **SQL injection** — every query uses prepared statements with bound
  parameters; the only dynamic SQL (sorting) is restricted to an allow-list.
- **XSS** — output is escaped in the browser and the server sends a strict
  `Content-Security-Policy`.
- **CSRF** — a double-submit cookie plus a per-session token; every request
  that changes data must present it.
- **Sessions** — stored server-side, `HttpOnly` cookie, 8-hour expiry, separate
  CSRF token, and invalidated on password change.
- **Server-side validation** — the browser checks are a convenience; the server
  re-validates every field (student ID format, classification/semester
  allow-lists, credit-hour and GPA ranges, cross-field "passed ≤ attempted").
- **Rate limiting** — on login, public submissions and general abuse.
- **Security headers** — `X-Content-Type-Options`, `X-Frame-Options`,
  `Referrer-Policy`, CSP.

---

## Project structure

```
presidential-scholars-node/
├── server.js                 HTTP server + API routes
├── package.json
├── src/
│   ├── db.js                 SQLite connection + schema + migrations + seed
│   ├── auth.js               sessions + login
│   ├── security.js           scrypt hashing + tokens
│   ├── validate.js           server-side validation + option lists
│   ├── reports.js            report queries + CRUD + stats
│   └── xlsx.js               genuine .xlsx workbook builder
├── public/
│   ├── index.html            public student form + review + confirmation
│   ├── login.html            admin sign-in page (/admin)
│   ├── dashboard.html        admin dashboard page (/admin/dashboard)
│   └── assets/
│       ├── styles.css        institutional design system (navy + gold)
│       ├── app.js            shared utilities (toasts, fetch/CSRF, format)
│       ├── form.js           student form behaviour
│       ├── login.js          admin sign-in behaviour
│       └── dashboard.js      dashboard behaviour
└── data/
    └── presidential_scholars.db   <-- the database file (created on first run)
```

---

## API reference (all JSON)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/csrf` | – | Get the CSRF token |
| GET | `/api/meta` | – | Option lists (classifications, semesters, years) |
| POST | `/api/reports` | – | Submit a semester report (returns reference + summary) |
| POST | `/api/admin/login` | – | Log in |
| POST | `/api/admin/logout` | session | Log out |
| GET | `/api/admin/me` | session | Current session |
| POST | `/api/admin/password` | session | Change password |
| GET | `/api/admin/stats` | session | Statistics (respects search/filters) |
| GET | `/api/admin/years` | session | Academic years in use |
| GET | `/api/admin/majors` | session | Distinct majors |
| GET | `/api/admin/reports` | session | List (search/filter/sort/page) |
| GET | `/api/admin/reports/:id` | session | One report + audit trail |
| PUT | `/api/admin/reports/:id` | session | Update a report (+ private notes) |
| POST | `/api/admin/reports/:id/review` | session | Approve / Reject / Needs Correction |
| POST | `/api/admin/reports/:id/archive` | session | Archive / restore |
| DELETE | `/api/admin/reports/:id` | session | Delete a report |
| GET | `/api/admin/export?format=csv` | session | CSV download (filtered set) |
| GET | `/api/admin/export?format=xlsx` | session | Genuine .xlsx download (filtered set) |

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `node: command not found` | Install Node.js from nodejs.org, then reopen the terminal. |
| Port already in use | Run with a different port: `$env:PORT="4000"; node server.js` |
| Forgot the password | Delete `data/presidential_scholars.db` and restart, or set `ADMIN_PASSWORD`. |
| I want an empty database | Stop the server and delete `data/presidential_scholars.db`, then start it again. |

> A few rows already exist in the database so you can see the dashboard
> populated. Delete them from the admin table to start with an empty state.