'use strict';

/**
 * src/reports.js
 * -----------------------------------------------------------------
 * All database access for semester academic reports. Every value the
 * user supplies is passed as a bound parameter to a prepared
 * statement; nothing is concatenated into SQL. The only dynamic SQL
 * (ORDER BY) is built from a strict allow-list.
 *
 * Review workflow: every new report starts as "pending". Admins
 * approve it ("verified"), reject it ("rejected"), request corrections
 * ("needs_correction"), or soft-delete it with "archived". Each
 * transition is recorded in academic_report_audit.
 *
 * Duplicate protection: one report per student per academic term is
 * enforced by a UNIQUE index on (student_id, academic_year, semester)
 * and checked up front so the student sees a friendly message.
 * -----------------------------------------------------------------
 */

const { db } = require('./db');
const { CLASSIFICATIONS, SEMESTERS, REVIEW_STATUSES } = require('./validate');
const { randomCode } = require('./security');

const SORTABLE = {
    id: 'id',
    student_id: 'student_id',
    first_name: 'first_name',
    last_name: 'last_name',
    name: 'name', // virtual: last_name, first_name
    classification: 'classification',
    major: 'major',
    academic_year: 'academic_year',
    semester: 'semester',
    attempted_credit_hours: 'attempted_credit_hours',
    passed_credit_hours: 'passed_credit_hours',
    semester_gpa: 'semester_gpa',
    career_gpa: 'career_gpa',
    review_status: 'review_status',
    created_at: 'created_at',
};

function orderClause(sort, dir) {
    const direction = String(dir).toLowerCase() === 'asc' ? 'ASC' : 'DESC';
    const tie = direction === 'ASC' ? 'ASC' : 'DESC';
    const key = SORTABLE[sort] || 'created_at';
    if (key === 'name') {
        return `ORDER BY last_name ${direction}, first_name ${direction}, id ${tie}`;
    }
    return `ORDER BY ${key} ${direction}, id ${tie}`;
}

function gpaRound(value) {
    const n = Number(value);
    return Number.isFinite(n) ? Number(n.toFixed(2)) : 0;
}

function decorate(row) {
    if (!row) return null;
    return Object.assign({}, row, {
        semester_gpa: gpaRound(row.semester_gpa),
        career_gpa: gpaRound(row.career_gpa),
        attempted_credit_hours: Number(row.attempted_credit_hours || 0),
        passed_credit_hours: Number(row.passed_credit_hours || 0),
    });
}

function buildWhere(query) {
    const clauses = [];
    const params = [];

    const q = (query.q || '').trim();
    if (q) {
        const like = `%${q}%`;
        clauses.push(`(
            student_id LIKE ? OR first_name LIKE ? OR last_name LIKE ? OR major LIKE ?
        )`);
        params.push(like, like, like, like);
    }

    const classification = (query.classification || '').trim();
    if (CLASSIFICATIONS.includes(classification)) {
        clauses.push('classification = ?');
        params.push(classification);
    }

    const semester = (query.semester || '').trim();
    if (SEMESTERS.includes(semester)) {
        clauses.push('semester = ?');
        params.push(semester);
    }

    const reviewStatus = (query.review_status || '').trim();
    if (REVIEW_STATUSES.includes(reviewStatus)) {
        clauses.push('review_status = ?');
        params.push(reviewStatus);
    }

    const academicYear = (query.academic_year || '').trim();
    if (/^\d{4}\u2013\d{4}$/.test(academicYear)) {
        clauses.push('academic_year = ?');
        params.push(academicYear);
    }

    const major = (query.major || '').trim();
    if (major) {
        clauses.push('major = ?');
        params.push(major);
    }

    return {
        where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '',
        params,
    };
}

async function listReports(query = {}) {
    const { where, params } = buildWhere(query);

    const page = Math.max(1, parseInt(query.page, 10) || 1);
    const perPage = Math.min(100, Math.max(5, parseInt(query.per_page, 10) || 10));
    const offset = (page - 1) * perPage;

    const totalRow = await db
        .prepare(`SELECT COUNT(*) AS n FROM academic_reports ${where}`)
        .get(...params);
    const total = Number(totalRow.n);

    const rows = await db
        .prepare(
            `SELECT * FROM academic_reports ${where}
             ${orderClause(query.sort, query.dir)}
             LIMIT ? OFFSET ?`
        )
        .all(...params, perPage, offset);

    const pages = Math.max(1, Math.ceil(total / perPage));

    return { rows: rows.map(decorate), total, page: Math.min(page, pages), pages, per_page: perPage };
}

async function allReports(query = {}) {
    const { where, params } = buildWhere(query);
    const rows = await db
        .prepare(`SELECT * FROM academic_reports ${where} ORDER BY created_at DESC, id DESC`)
        .all(...params);
    return rows.map(decorate);
}

async function getReport(id) {
    const row = await db.prepare('SELECT * FROM academic_reports WHERE id = ?').get(Number(id)) || null;
    return decorate(row);
}

async function getAudit(reportId) {
    return db
        .prepare(
            `SELECT action, actor, note, created_at FROM academic_report_audit
              WHERE report_id = ? ORDER BY id ASC`
        )
        .all(Number(reportId));
}

async function logAudit(reportId, action, actor, note) {
    await db.prepare(
        'INSERT INTO academic_report_audit (report_id, action, actor, note) VALUES (?, ?, ?, ?)'
    ).run(Number(reportId), action, actor || null, note || null);
}

async function uniqueReference() {
    const year = new Date().getFullYear();
    for (let attempt = 0; attempt < 25; attempt++) {
        const candidate = `PSR-${year}-${randomCode(6)}`;
        const taken = await db
            .prepare('SELECT 1 FROM academic_reports WHERE confirmation_reference = ?')
            .get(candidate);
        if (!taken) return candidate;
    }
    // Extremely unlikely fallback: timestamp-based.
    return `PSR-${year}-${Date.now().toString(36).toUpperCase()}`;
}

/**
 * Duplicate guard used by the public form: does this student already
 * have a report for the same academic year + semester?
 */
async function findTermDuplicate(data) {
    return db
        .prepare(
            `SELECT id FROM academic_reports
             WHERE student_id = ? AND academic_year = ? AND semester = ?
             LIMIT 1`
        )
        .get(data.student_id, data.academic_year, data.semester) || null;
}

async function createReport(data, ip) {
    const reference = await uniqueReference();

    const info = await db
        .prepare(
            `INSERT INTO academic_reports
                (student_id, last_name, first_name, classification, major,
                 academic_year, semester, attempted_credit_hours,
                 passed_credit_hours, semester_gpa, career_gpa,
                 confirmation_reference, review_status, ip_address)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`
        )
        .run(
            data.student_id,
            data.last_name,
            data.first_name,
            data.classification,
            data.major,
            data.academic_year,
            data.semester,
            data.attempted_credit_hours,
            data.passed_credit_hours,
            data.semester_gpa,
            data.career_gpa,
            reference,
            ip || null
        );

    const id = Number(info.lastInsertRowid);
    await logAudit(id, 'submitted', 'Student form', null);
    return { id, reference };
}

async function updateReport(id, data, actor) {
    const info = await db
        .prepare(
            `UPDATE academic_reports SET
                student_id = ?, last_name = ?, first_name = ?, classification = ?,
                major = ?, academic_year = ?, semester = ?,
                attempted_credit_hours = ?, passed_credit_hours = ?,
                semester_gpa = ?, career_gpa = ?, internal_notes = ?,
                updated_at = datetime('now','localtime')
             WHERE id = ?`
        )
        .run(
            data.student_id,
            data.last_name,
            data.first_name,
            data.classification,
            data.major,
            data.academic_year,
            data.semester,
            data.attempted_credit_hours,
            data.passed_credit_hours,
            data.semester_gpa,
            data.career_gpa,
            typeof data.internal_notes === 'string' && data.internal_notes.trim() !== ''
                ? data.internal_notes.trim().slice(0, 2000)
                : null,
            Number(id)
        );

    if (info.changes > 0) {
        await logAudit(Number(id), 'edited', actor || null, null);
        return true;
    }
    return false;
}

/**
 * Move a report through the review workflow.
 * decision: 'verified' | 'rejected' | 'needs_correction'
 */
async function reviewReport(id, decision, actor, note) {
    if (decision !== 'verified' && decision !== 'rejected' && decision !== 'needs_correction') {
        return null;
    }
    const cleanNote = typeof note === 'string' ? note.trim().slice(0, 2000) : '';
    const info = await db
        .prepare(
            `UPDATE academic_reports SET
                review_status = ?, reviewed_by = ?, reviewed_at = datetime('now','localtime'),
                archived_at = NULL, updated_at = datetime('now','localtime')
             WHERE id = ?`
        )
        .run(decision, actor || null, Number(id));
    if (info.changes === 0) return null;
    await logAudit(Number(id), decision, actor || null, cleanNote || null);
    return getReport(id);
}

/** Soft-delete (archive) or restore a report. */
async function archiveReport(id, archived, actor) {
    const info = await db
        .prepare(
            archived
                ? `UPDATE academic_reports SET
                       review_status = 'archived', archived_at = datetime('now','localtime'),
                       updated_at = datetime('now','localtime')
                   WHERE id = ?`
                : `UPDATE academic_reports SET
                       review_status = 'pending', archived_at = NULL,
                       reviewed_by = NULL, reviewed_at = NULL,
                       updated_at = datetime('now','localtime')
                   WHERE id = ?`
        )
        .run(Number(id));
    if (info.changes === 0) return null;
    await logAudit(Number(id), archived ? 'archived' : 'restored', actor || null, null);
    return getReport(id);
}

async function deleteReport(id, actor) {
    const info = await db.prepare('DELETE FROM academic_reports WHERE id = ?').run(Number(id));
    const ok = Number(info.changes) > 0;
    if (ok) {
        try {
            await logAudit(Number(id), 'deleted', actor || null, null);
        } catch {
            // The report row (and its cascade audit rows) is already gone.
        }
    }
    return ok;
}

/**
 * Dashboard statistics, optionally constrained by the active
 * search/filter set so the toolbar stays in sync.
 */
async function stats(query = {}) {
    const { where, params } = buildWhere(query);
    const { academic_year, semester } = require('./validate').currentAcademicTerm();

    const row = await db
        .prepare(
            `SELECT
                COUNT(*)                                   AS total,
                COUNT(DISTINCT student_id)                 AS students,
                COALESCE(AVG(semester_gpa), 0)             AS avg_semester_gpa,
                COALESCE(AVG(career_gpa), 0)               AS avg_career_gpa,
                SUM(CASE WHEN academic_year = ? AND semester = ? THEN 1 ELSE 0 END) AS this_term
             FROM academic_reports ${where}`
        )
        .get(...params, academic_year, semester);

    const count = async (extra) => {
        const r = await db
            .prepare(
                `SELECT COUNT(*) AS n FROM academic_reports ${where}${
                    where ? ' AND ' : 'WHERE '
                }${extra}`
            )
            .get(...params);
        return Number(r.n);
    };

    return {
        total: Number(row.total),
        students: Number(row.students),
        avg_semester_gpa: Number(Number(row.avg_semester_gpa || 0).toFixed(2)),
        avg_career_gpa: Number(Number(row.avg_career_gpa || 0).toFixed(2)),
        this_term: Number(row.this_term),
        current_term: { academic_year, semester },
        pending: await count(`review_status = 'pending'`),
        verified: await count(`review_status = 'verified'`),
        rejected: await count(`review_status = 'rejected'`),
        needs_correction: await count(`review_status = 'needs_correction'`),
        archived: await count(`review_status = 'archived'`),
        today: await count(`date(created_at) = date('now','localtime')`),
    };
}

async function majors() {
    const rows = await db
        .prepare("SELECT DISTINCT major FROM academic_reports WHERE major <> '' ORDER BY major COLLATE NOCASE ASC")
        .all();
    return rows.map((row) => row.major);
}

async function academicYears() {
    const rows = await db
        .prepare("SELECT DISTINCT academic_year AS y FROM academic_reports WHERE academic_year IS NOT NULL AND academic_year <> '' ORDER BY y DESC")
        .all();
    return rows.map((row) => row.y);
}

module.exports = {
    listReports,
    allReports,
    getReport,
    getAudit,
    createReport,
    updateReport,
    reviewReport,
    archiveReport,
    deleteReport,
    findTermDuplicate,
    stats,
    majors,
    academicYears,
};