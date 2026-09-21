# Presidential Scholars Academic Reporting Portal

A semester academic reporting system built with **Node.js + SQLite**. Scholars use a
public, no-login form to submit their academic performance for a semester (student
information, semester information, and academic performance), review it, and receive
a confirmation with a reference number. **Dr. P** logs into the admin portal to
oversee, search, filter, edit, review, archive and export every report.

- **Student form:** http://localhost:3000/  (also `/submit`)
- **Admin login:** http://localhost:3000/admin
- **Admin dashboard:** http://localhost:3000/admin/dashboard

### First-run login

| Field | Value |
|---|---|
| Username | `drp` |
| Password | `DrP2026!` |

Change it any time from **Change Password** in the dashboard menu, or set your own
before first run with `ADMIN_PASSWORD` (see below).

---

## What the application does

### Student form (no account needed)

A three-step flow — **Fill In → Review → Submitted** — made of three numbered
sections:

1. **Student Information** — Student ID, Last Name, First Name, Major, Classification.
2. **Semester Information** — Academic Year (e.g. `2026–2027`), Semester (Fall / Spring / Summer).
3. **Academic Performance** — Attempted Credit Hours, Passed Credit Hours, Semester GPA, Career GPA.

- Inline validation with field-level messages and an accessible error summary; the
  server re-validates everything on submit.
- Each completed section is ticked off as you fill it in.
- A **review screen** shows every value before submission with an **Edit Information**
  button to go back and fix anything.
- Submitting state prevents duplicate clicks; a hidden honeypot field and rate
  limiting deter bots and abuse.
- **Duplicate protection:** one report per student per academic term. A second
  submission for the same student, academic year and semester is refused with a
  clear message.
- On success a **confirmation page** shows the confirmation reference
  (e.g. `PSR-2026-A7K2Q9`), submission date and time, a summary of the record, and
  a **Submit Another Report** button. There is no public lookup — the confirmation
  is rendered from the saved response only, so references cannot be enumerated.

### Admin portal (separate login + dashboard pages)

- `/admin` is a dedicated sign-in page; on success you are taken to the separate
  `/admin/dashboard` page. Logged-in visitors are taken straight to the dashboard,
  and the dashboard bounces unsigned visitors back.
- Five stat cards computed from real records: **Total Reports**, **Submitted This
  Semester**, **Avg Semester GPA**, **Avg Career GPA** and **Total Students**, plus a
  status breakdown line (Pending / Reviewed / Corrections / Archived) and today's
  submissions.
- Debounced search across **student ID, name and major**, plus combinable filters —
  Academic Year, Semester, Classification, Major and Status — with a **Clear filters**
  button.
- Click any column heading to sort (point up/down shows the active sort); server-side
  pagination with a per-page selector.
- Click a row for the **report drawer**: the full record (student, semester, GPA,
  special effort), confirmation reference, submission IP, reviewer details, private
  administrator notes (never exported or shown publicly), the complete **audit trail**,
  and the review workflow.
- Review actions: **Approve** (verified), **Reject** (declined), **Needs Correction**,
  plus **Archive / Restore**, **Edit** in a modal, and **Delete** with confirmation.
  Every action records who did it, when, and any note, in the audit trail.
- Real exports of the current filtered set: **CSV** and genuine **.xlsx** (Excel),
  with readable headings and spreadsheet-formula protection. Internal notes are never
  included.

---

## About the database (read this first)

This app uses **SQLite**, a full relational database stored as a single file:

```
data/presidential_scholars.db
```

When a scholar submits the form, a row is written to the `academic_reports` table.
When you restart the server the data is still there. **You do not need XAMPP or
MySQL** — everything is included with Node.js, so there is nothing to install.

Tables created automatically on first run:

- `academic_reports` — every submission: student ID, names, major, classification,
  academic year, semester, credit hours, semester/career GPA, confirmation reference,
  review status (`pending`/`verified`/`rejected`/`needs_correction`/`archived`),
  reviewed by/at, archived at, submitted IP, and internal notes. A unique index
  enforces **one report per student per academic term**.
- `academic_report_audit` — submit/edit/review/archive history per report.
- `admins` — back office accounts (passwords stored as scrypt hashes).
- `sessions` — active logins.

The existing database file is reused; the reporting tables are added alongside the
legacy `opportunity_reports` tables, which are no longer used by the app. A few demo
rows are seeded on first run so the dashboard is populated — delete them from the
admin table to start with an empty state.

---

## Requirements

- **Node.js 22.5 or newer** (this machine already has Node 25). Check with:
  ```
  node --version
  ```

No `npm install` is required — the app uses only Node's built-in modules
(`node:sqlite` included).

## Run the app

```
node server.js
```

Then open <http://localhost:3000/>. To keep it running in the background on Windows:

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

The default admin is only created the first time, when the `admins` table is empty.
To reset it later, delete `data/presidential_scholars.db` and start again (or use
**Change Password** in the dashboard).

---

## Features

### Student form
- No account needed; three-step Fill In → Review → Submitted flow
- Three numbered sections (Student / Semester / Academic Performance) with live
  completion ticks and an accessible error summary
- Review screen before the final submission with Edit Information
- Confirmation page with reference number, timestamp and summary
- Duplicate protection (one report per student per term)
- Hidden honeypot field and rate limiting on submissions

### Admin back office
- Separate login page (`/admin`) and dashboard page (`/admin/dashboard`)
- Five stat cards from real records + status breakdown
- Debounced search (student ID / name / major) and five combinable filters
- Sortable columns, server-side pagination, per-page selector
- Click any row for the full-report drawer with audit trail
- Review workflow: Approve / Reject / Needs Correction / Archive-Restore / Edit / Delete
- Private administrator notes, never exported or shown publicly
- Real CSV and genuine .xlsx exports of the filtered set

---

## Security

- **Passwords** — hashed with scrypt + a random per-user salt; verified with a
  timing-safe comparison. Plain text is never stored.
- **SQL injection** — every query uses prepared statements with bound parameters;
  the only dynamic SQL (sorting) is restricted to an allow-list.
- **XSS** — output is escaped in the browser and the server sends a strict
  `Content-Security-Policy`.
- **CSRF** — a double-submit cookie token; every request that changes data must
  present it.
- **Sessions** — stored server-side, `HttpOnly` cookie, 8-hour expiry, invalidated
  on password change.
- **Server-side validation** — the browser checks are a convenience; the server
  re-validates every field (lengths, student-ID pattern, credit-hour and GPA ranges,
  en-dash academic year, allowed classification/semester).
- **Rate limiting** — on login and public submissions.
- **Security headers** — `X-Content-Type-Options`, `X-Frame-Options`,
  `Referrer-Policy`, CSP.

---

## Project structure

```
presidential-scholars-node/
├── server.js                 HTTP server + API routes
├── package.json
├── src/
│   ├── db.js                 SQLite connection + schema + demo seed
│   ├── auth.js               sessions + login
│   ├── security.js           scrypt hashing + tokens
│   ├── validate.js           server-side validation + option lists
│   ├── reports.js            report queries + CRUD + stats + exports
│   └── xlsx.js               genuine .xlsx workbook builder
├── public/
│   ├── index.html            public student form + review + confirmation
│   ├── login.html            admin sign-in page (/admin)
│   ├── dashboard.html        admin dashboard page (/admin/dashboard)
│   └── assets/
│       ├── styles.css        institutional design system
│       ├── app.js            shared utilities (CSRF, fetch, toasts)
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
| GET | `/api/meta` | – | Option lists (classifications, semesters, academic years) |
| POST | `/api/reports` | – | Submit an academic report (returns reference + summary) |
| POST | `/api/admin/login` | – | Log in |
| POST | `/api/admin/logout` | – | Log out |
| GET | `/api/admin/me` | session | Current session |
| POST | `/api/admin/password` | session | Change password |
| GET | `/api/admin/stats` | session | Dashboard statistics |
| GET | `/api/admin/years` | session | Academic years in use |
| GET | `/api/admin/majors` | session | Distinct majors |
| GET | `/api/admin/reports` | session | List (search/filter/sort/page) |
| GET | `/api/admin/reports/:id` | session | One report + audit trail |
| PUT | `/api/admin/reports/:id` | session | Update a report (+ internal notes) |
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
| `data/presidential_scholars.db` is not writeable | Remove OneDrive/read-only flags or move the folder to a normal location. |
| Forgot the password | Delete `data/presidential_scholars.db` and restart, or set `ADMIN_PASSWORD`. |
| I want an empty database | Stop the server and delete `data/presidential_scholars.db`, then start it again. |

> A few demo rows are seeded on first run so you can see the dashboard populated.
> Delete them from the admin table to start with an empty state.