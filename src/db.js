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
 * whole application is `async`-safe on both backends.
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

/** Semester academic reports for the Presidential Scholars Program. */
const ACADEMIC_SCHEMA_SQL = `
    PRAGMA foreign_keys = ON;

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

    -- One report per student per academic term.
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

    CREATE INDEX IF NOT EXISTS idx_audit_report ON academic_report_audit(report_id);
`;

/**
 * Non-destructive migration for academic_reports: adds review-workflow
 * columns only when missing and backfills confirmation references so
 * legacy rows remain readable.
 */
async function migrateAcademic(run) {
    const cols = await run('PRAGMA table_info(academic_reports)');
    const existing = new Set(cols.map((c) => c.name));

    const additions = [
        ['confirmation_reference', 'TEXT'],
        ['review_status', "TEXT NOT NULL DEFAULT 'pending'"],
        ['reviewed_by', 'TEXT'],
        ['reviewed_at', 'TEXT'],
        ['archived_at', 'TEXT'],
        ['internal_notes', 'TEXT'],
    ];

    for (const [column, type] of additions) {
        if (!existing.has(column)) {
            await run(`ALTER TABLE academic_reports ADD COLUMN ${column} ${type}`);
        }
    }

    // One statement per call: HTTP-backed remote providers don't allow
    // multi-statement strings through a single execute().
    await run('CREATE UNIQUE INDEX IF NOT EXISTS idx_academic_unique_term ON academic_reports(student_id, academic_year, semester)');
    await run('CREATE INDEX IF NOT EXISTS idx_academic_review ON academic_reports(review_status)');
    await run('CREATE INDEX IF NOT EXISTS idx_academic_term ON academic_reports(academic_year, semester)');

    // Backfill: every legacy row gets its own unique confirmation reference.
    const missing = await run(
        'SELECT id FROM academic_reports WHERE confirmation_reference IS NULL'
    );
    if (missing && missing.length) {
        const { randomCode } = require('./security');
        for (const row of missing) {
            let ref = null;
            for (let attempt = 0; attempt < 10 && !ref; attempt++) {
                const candidate = `PSR-${new Date().getFullYear()}-${randomCode(6)}`;
                const taken = await run(
                    'SELECT 1 FROM academic_reports WHERE confirmation_reference = ?',
                    [candidate]
                );
                if (!taken || !taken.length) ref = candidate;
            }
            if (ref) {
                await run(
                    'UPDATE academic_reports SET confirmation_reference = ? WHERE id = ?',
                    [ref, row.id]
                );
            }
        }
    }
}

/**
 * Seed a handful of demo rows so a brand-new database shows a
 * populated dashboard. Existing rows are never touched.
 */
async function seedDemo(run) {
    const countRow = await run('SELECT COUNT(*) AS n FROM academic_reports');
    if (countRow && countRow[0] && Number(countRow[0].n) > 0) {
        return false;
    }

    const demo = [
        ['100244279', 'Johnson', 'Aisha', 'Computer and Information Systems', 'Senior', '2026\u20132027', 'Fall', 15, 15, 3.9, 3.92, 'verified', 'Dr. P'],
        ['100244280', 'Adams', 'Riley', 'Business Administration', 'Junior', '2026\u20132027', 'Fall', 15, 14, 3.3, 3.46, 'pending', null],
        ['100244281', 'Smith', 'Marcus', 'Biology', 'Senior', '2025\u20132026', 'Spring', 18, 18, 3.75, 3.81, 'verified', 'Dr. P'],
        ['100244282', 'Garcia', 'Lily', 'Political Science', 'Freshman', '2026\u20132027', 'Fall', 12, 12, 3.1, 3.05, 'needs_correction', 'Dr. P'],
        ['100244283', 'Brown', 'Ethan', 'Mathematics', 'Sophomore', '2025\u20132026', 'Fall', 16, 15, 2.95, 3.22, 'pending', null],
        ['100244284', 'Davis', 'Olivia', 'Communication Studies', 'Junior', '2026\u20132027', 'Fall', 14, 14, 3.6, 3.6, 'rejected', 'Dr. P'],
    ];

    const { randomCode } = require('./security');
    for (const [student_id, last_name, first_name, major, classification, academic_year, semester, attempted, passed, sgpa, cgpa, status, by] of demo) {
        const ref = `PSR-${new Date().getFullYear()}-${randomCode(6)}`;
        const info = await run(
            `INSERT INTO academic_reports
                (student_id, last_name, first_name, major, classification,
                 academic_year, semester, attempted_credit_hours,
                 passed_credit_hours, semester_gpa, career_gpa,
                 confirmation_reference, review_status, reviewed_by, reviewed_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now','localtime'))`,
            [student_id, last_name, first_name, major, classification, academic_year, semester,
             attempted, passed, sgpa, cgpa, ref, status, by]
        );
        const lid = typeof info.lastInsertRowid === 'bigint' ? Number(info.lastInsertRowid) : Number(info.lastInsertRowid);
        await run(
            'INSERT INTO academic_report_audit (report_id, action, actor) VALUES (?, ?, ?)',
            [lid, 'submitted', 'Student form']
        );
        if (status !== 'pending') {
            await run(
                'INSERT INTO academic_report_audit (report_id, action, actor) VALUES (?, ?, ?)',
                [lid, status, by || 'Dr. P']
            );
        }
    }
    return true;
}

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

/* =====================================================================
 |  Initialization
 * =================================================================== */

async function localInit() {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const { DatabaseSync } = require('node:sqlite');
    const local = new DatabaseSync(DB_FILE);
    local.exec('PRAGMA journal_mode = WAL;');
    local.exec(ACADEMIC_SCHEMA_SQL);

    const run = async (sql, args) => local.prepare(sql).all(...(args || []));
    await migrateAcademic(run);
    await seedDemo(run);
    engine = { local };
}

async function remoteInit() {
    const { createClient } = require('@libsql/client');
    const client = createClient({
        url: process.env.TURSO_DATABASE_URL,
        authToken: process.env.TURSO_AUTH_TOKEN || undefined,
    });
    await client.executeMultiple(ACADEMIC_SCHEMA_SQL);

    const run = async (sql, args) => (await client.execute({ sql, args: args || [] })).rows;
    await migrateAcademic(run);
    await seedDemo(run);
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