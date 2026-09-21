'use strict';

/**
 * src/db.js
 * -----------------------------------------------------------------
 * Storage layer with two interchangeable backends:
 *
 *   1. LOCAL  (default)  - SQLite in a single file using Node's
 *      built-in `node:sqlite` module. Nothing to install.
 *
 *   2. HOSTED (Vercel)   - Turso / libSQL via `@libsql/client`, a
 *      cloud SQLite that keeps the exact same SQL. Enabled by setting
 *      `TURSO_DATABASE_URL` (and `TURSO_AUTH_TOKEN` when required).
 *
 * Every statement goes through the same PROMISE-based facade, so the
 * whole application is `async`-safe on both backends. Local file
 * creation, schema creation and migrations happen lazily on first use.
 * -----------------------------------------------------------------
 */

const path = require('node:path');
const fs = require('node:fs');

const REMOTE = Boolean(process.env.TURSO_DATABASE_URL);

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'presidential_scholars.db');

// `engine` = local `DatabaseSync` instance OR `{ client }` for Turso.
// `ready`  = promise that resolves once the schema + migrations exist.
let engine = null;
let ready = null;

const SCHEMA_SQL = `
    PRAGMA foreign_keys = ON;

    -- One row per submitted semester academic report.
    CREATE TABLE IF NOT EXISTS academic_reports (
        id                      INTEGER PRIMARY KEY AUTOINCREMENT,
        student_id              TEXT NOT NULL,
        last_name               TEXT NOT NULL,
        first_name              TEXT NOT NULL,
        major                   TEXT NOT NULL,
        classification          TEXT NOT NULL,
        academic_year           TEXT NOT NULL,
        semester                TEXT NOT NULL,
        attempted_credit_hours  REAL NOT NULL,
        passed_credit_hours     REAL NOT NULL,
        semester_gpa            REAL NOT NULL,
        career_gpa              REAL NOT NULL,
        ip_address              TEXT,
        created_at              TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        updated_at              TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        confirmation_reference  TEXT,
        review_status           TEXT NOT NULL DEFAULT 'pending',
        reviewed_by             TEXT,
        reviewed_at             TEXT,
        archived_at             TEXT,
        internal_notes          TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_academic_student_id  ON academic_reports(student_id);
    CREATE INDEX IF NOT EXISTS idx_academic_last_name   ON academic_reports(last_name);
    CREATE INDEX IF NOT EXISTS idx_academic_first_name  ON academic_reports(first_name);
    CREATE INDEX IF NOT EXISTS idx_academic_major       ON academic_reports(major);
    CREATE INDEX IF NOT EXISTS idx_academic_class       ON academic_reports(classification);
    CREATE INDEX IF NOT EXISTS idx_academic_created_at  ON academic_reports(created_at);
    CREATE INDEX IF NOT EXISTS idx_academic_review      ON academic_reports(review_status);
    CREATE INDEX IF NOT EXISTS idx_academic_term        ON academic_reports(academic_year, semester);

    -- One report per student per term. Prevents accidental double submissions.
    CREATE UNIQUE INDEX IF NOT EXISTS idx_academic_unique_term
        ON academic_reports(student_id, academic_year, semester);

    CREATE TABLE IF NOT EXISTS admins (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        username      TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        full_name     TEXT,
        created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        last_login    TEXT
    );

    CREATE TABLE IF NOT EXISTS sessions (
        token      TEXT PRIMARY KEY,
        admin_id   INTEGER NOT NULL,
        csrf       TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        expires_at TEXT NOT NULL,
        FOREIGN KEY (admin_id) REFERENCES admins(id) ON DELETE CASCADE
    );

    -- Audit trail: who did what to a report and when.
    CREATE TABLE IF NOT EXISTS academic_report_audit (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        report_id  INTEGER NOT NULL,
        action     TEXT NOT NULL,
        actor      TEXT,
        note       TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        FOREIGN KEY (report_id) REFERENCES academic_reports(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_academic_audit_report ON academic_report_audit(report_id);
`;

/**
 * Create the first admin account on first run. Credentials can be
 * overridden with ADMIN_USERNAME / ADMIN_PASSWORD / ADMIN_FULL_NAME.
 */
async function ensureDefaultAdmin() {
    await ensureInit();
    const raw = engine.local
        ? (sql, args) => Promise.resolve(engine.local.prepare(sql).all(...(args || [])))
        : async (sql, args) => (await engine.client.execute({ sql, args: args || [] })).rows;

    const rows = await raw('SELECT COUNT(*) AS n FROM admins');
    const count = rows && rows[0] ? Number(rows[0].n) : 0;
    if (count > 0) {
        return null;
    }

    const username = process.env.ADMIN_USERNAME || 'drp';
    const password = process.env.ADMIN_PASSWORD || 'DrP2026!';
    const fullName = process.env.ADMIN_FULL_NAME || 'Dr. P';
    const hash = require('./security').hashPassword(password);

    if (engine.local) {
        engine.local
            .prepare('INSERT INTO admins (username, password_hash, full_name) VALUES (?, ?, ?)')
            .run(username, hash, fullName);
    } else {
        await engine.client.execute({
            sql: 'INSERT INTO admins (username, password_hash, full_name) VALUES (?, ?, ?)',
            args: [username, hash, fullName],
        });
    }

    return { username, password, fullName, isDefault: !process.env.ADMIN_PASSWORD };
}

/**
 * Seed a small set of realistic reports the very first time a database
 * is created so the admin dashboard is immediately readable. This only
 * runs when the academic_reports table is completely empty; delete the
 * rows from the admin table (or the database file) to start clean.
 * Seed rows keep the status/audit fields consistent.
 */
async function seedDemoRows(run) {
    const check = await run('SELECT COUNT(*) AS n FROM academic_reports');
    if (check && check[0] && Number(check[0].n) > 0) {
        return;
    }

    const { randomCode } = require('./security');
    const year = new Date().getFullYear();
    const mkRef = async () => {
        for (let attempt = 0; attempt < 10; attempt++) {
            const candidate = `PSR-${year}-${randomCode(6)}`;
            const taken = await run(
                'SELECT 1 FROM academic_reports WHERE confirmation_reference = ?',
                [candidate]
            );
            if (!taken || !taken.length) return candidate;
        }
        return `PSR-${year}-${Date.now().toString(36).toUpperCase()}`;
    };

    const rows = [
        // Current semester (Fall 2026-2027) submissions.
        { student_id: '100244279', last_name: 'Johnson', first_name: 'Aisha', major: 'Computer and Information Systems', classification: 'Senior', academic_year: '2026\u20132027', semester: 'Fall', attempted: 15, passed: 15, sem_gpa: 3.90, career_gpa: 3.92, created_at: '2026-09-06 09:12:00', status: 'verified' },
        { student_id: '100244280', last_name: 'Adams', first_name: 'Riley', major: 'Business Administration', classification: 'Junior', academic_year: '2026\u20132027', semester: 'Fall', attempted: 15, passed: 14, sem_gpa: 3.30, career_gpa: 3.46, created_at: '2026-09-05 14:20:00', status: 'pending' },
        { student_id: '100244282', last_name: 'Nguyen', first_name: 'Linh', major: 'Psychology', classification: 'Freshman', academic_year: '2026\u20132027', semester: 'Fall', attempted: 15, passed: 15, sem_gpa: 4.00, career_gpa: 4.00, created_at: '2026-09-08 08:45:00', status: 'verified' },
        { student_id: '100244283', last_name: 'Patel', first_name: 'Rohan', major: 'Computer Science', classification: 'Sophomore', academic_year: '2026\u20132027', semester: 'Fall', attempted: 16, passed: 15, sem_gpa: 3.50, career_gpa: 3.58, created_at: '2026-09-10 11:05:00', status: 'pending' },
        { student_id: '100244284', last_name: 'Williams', first_name: 'Taylor', major: 'Chemistry', classification: 'Junior', academic_year: '2026\u20132027', semester: 'Fall', attempted: 12, passed: 12, sem_gpa: 3.75, career_gpa: 3.81, created_at: '2026-09-12 10:30:00', status: 'verified' },
        { student_id: '100244285', last_name: 'Brown', first_name: 'Jordan', major: 'Mathematics', classification: 'Senior', academic_year: '2026\u20132027', semester: 'Fall', attempted: 15, passed: 15, sem_gpa: 3.92, career_gpa: 3.86, created_at: '2026-09-14 13:40:00', status: 'verified' },
        { student_id: '100244286', last_name: 'Garcia', first_name: 'Sofia', major: 'Accounting', classification: 'Sophomore', academic_year: '2026\u20132027', semester: 'Fall', attempted: 13, passed: 13, sem_gpa: 3.60, career_gpa: 3.66, created_at: '2026-09-16 16:22:00', status: 'needs_correction' },
        // Earlier terms the same cohort reported (same students, distinct terms).
        { student_id: '100244279', last_name: 'Johnson', first_name: 'Aisha', major: 'Computer and Information Systems', classification: 'Senior', academic_year: '2025\u20132026', semester: 'Fall', attempted: 15, passed: 15, sem_gpa: 3.85, career_gpa: 3.90, created_at: '2025-12-12 09:30:00', status: 'verified' },
        { student_id: '100244279', last_name: 'Johnson', first_name: 'Aisha', major: 'Computer and Information Systems', classification: 'Senior', academic_year: '2025\u20132026', semester: 'Spring', attempted: 14, passed: 14, sem_gpa: 3.78, career_gpa: 3.88, created_at: '2026-05-02 10:10:00', status: 'verified' },
        { student_id: '100244287', last_name: 'Davis', first_name: 'Elijah', major: 'Electrical Engineering', classification: 'Freshman', academic_year: '2025\u20132026', semester: 'Summer', attempted: 9, passed: 9, sem_gpa: 3.45, career_gpa: 3.52, created_at: '2026-07-21 12:50:00', status: 'verified' },
    ];

    for (const r of rows) {
        const ref = await mkRef();
        const reviewedAt = r.status === 'verified' ? r.created_at : null;
        await run(
            `INSERT INTO academic_reports
                (student_id, last_name, first_name, major, classification,
                 academic_year, semester, attempted_credit_hours, passed_credit_hours,
                 semester_gpa, career_gpa, ip_address, created_at, updated_at,
                 confirmation_reference, review_status, reviewed_by, reviewed_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '127.0.0.1', ?, ?, ?, ?, ?, ?)`,
            [
                r.student_id, r.last_name, r.first_name, r.major, r.classification,
                r.academic_year, r.semester, r.attempted, r.passed, r.sem_gpa, r.career_gpa,
                r.created_at, r.created_at, ref, r.status,
                r.status === 'verified' ? 'Dr. P' : null, reviewedAt,
            ]
        );
    }
}

/* =====================================================================
 |  Initialization
 * =================================================================== */

async function localInit() {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const { DatabaseSync } = require('node:sqlite');
    const local = new DatabaseSync(DB_FILE);
    local.exec('PRAGMA journal_mode = WAL;');
    local.exec(SCHEMA_SQL);

    const run = async (sql, args) => local.prepare(sql).all(...(args || []));
    await seedDemoRows(run);
    engine = { local };
}

async function remoteInit() {
    const { createClient } = require('@libsql/client');
    const client = createClient({
        url: process.env.TURSO_DATABASE_URL,
        authToken: process.env.TURSO_AUTH_TOKEN || undefined,
    });
    await client.executeMultiple(SCHEMA_SQL);

    const run = async (sql, args) => (await client.execute({ sql, args: args || [] })).rows;
    await seedDemoRows(run);
    engine = { client };
}

function ensureInit() {
    if (!ready) {
        ready = REMOTE ? remoteInit() : localInit();
    }
    return ready;
}

/* =====================================================================
 |  Statement facade (promise-based, backend-agnostic)
 * =================================================================== */

function makeRemoteStmt(sql) {
    return {
        all: async (...args) => {
            await ensureInit();
            const r = await engine.client.execute({ sql, args });
            return r.rows;
        },
        get: async (...args) => {
            await ensureInit();
            const r = await engine.client.execute({ sql, args });
            return r.rows[0] === undefined ? undefined : r.rows[0];
        },
        run: async (...args) => {
            await ensureInit();
            const r = await engine.client.execute({ sql, args });
            let lid = r.lastInsertRowid;
            if (typeof lid === 'bigint') lid = Number(lid);
            return { changes: r.rowsAffected, lastInsertRowid: lid };
        },
    };
}

function makeLocalStmt(sql) {
    return {
        all: async (...args) => {
            await ensureInit();
            return engine.local.prepare(sql).all(...args);
        },
        get: async (...args) => {
            await ensureInit();
            return engine.local.prepare(sql).get(...args);
        },
        run: async (...args) => {
            await ensureInit();
            const out = engine.local.prepare(sql).run(...args);
            return {
                changes: Number(out.changes),
                lastInsertRowid: Number(out.lastInsertRowid),
            };
        },
    };
}

function prepare(sql) {
    return REMOTE ? makeRemoteStmt(sql) : makeLocalStmt(sql);
}

async function exec(sql) {
    await ensureInit();
    if (engine.local) {
        engine.local.exec(sql);
        return;
    }
    await engine.client.executeMultiple(sql);
}

function backend() {
    return REMOTE ? `Turso (${process.env.TURSO_DATABASE_URL})` : `SQLite file (${DB_FILE})`;
}

module.exports = { db: { prepare, exec, backend }, DB_FILE, DATA_DIR, ensureDefaultAdmin };