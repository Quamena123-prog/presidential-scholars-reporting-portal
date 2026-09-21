'use strict';

/**
 * src/reports.js
 * -----------------------------------------------------------------
 * All database access for semester academic reports. Every value the
 * user supplies is passed as a bound parameter to a prepared
 * statement; nothing is concatenated into SQL. The only dynamic SQL
 * (ORDER BY) is built from a strict allow-list.
 *
 * Review workflow: every new report starts as "pending". Admins approve
 * it ("verified"), reject it ("rejected"), request corrections
 * ("needs_correction"), or soft-delete it with "archived". Each
 * transition is recorded in academic_report_audit.
 * -----------------------------------------------------------------
 */

const { db } = require('./db');
const { CLASSIFICATIONS, SEMESTERS, REVIEW_STATUSES, isAcademicYear, currentAcademicTerm } = require('./validate');
const { randomCode } = require('./security');

const SORTABLE = {
    created_at: 'created_at',
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

    const academicYear = (query.academic_year || '').trim();
    if (isAcademicYear(academicYear)) {
        clauses.push('academic_year = ?');
        params.push(academicYear);
    }

    const major = (query.major || '').trim();
    if (major) {
        clauses.push('major = ?');
        params.push(major);
    }

    const reviewStatus = (query.review_status || '').trim();
    if (REVIEW_STATUSES.includes(reviewStatus)) {
        clauses.push('review_status = ?');
        params.push(reviewStatus);
    }

    const dateFrom = (query.date_from || '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateFrom)) {
        clauses.push('date(created_at) >= date(?)');
        params.push(dateFrom);
    }

    const dateTo = (query.date_to || '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateTo)) {
        clauses.push('date(created_at) <= date(?)');
        params.push(dateTo);
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

    return { rows, total, page: Math.min(page, pages), pages, per_page: perPage };
}

async function allReports(query = {}) {
    const { where, params } = buildWhere(query);
    return db
        .prepare(`SELECT * FROM academic_reports ${where} ORDER BY created_at DESC, id DESC`)
        .all(...params);
}

async function getReport(id) {
    return db.prepare('SELECT * FROM academic_reports WHERE id = ?').get(Number(id)) || null;
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

async function createReport(data, ip) {
    const reference = await uniqueReference();

    const info = await db
        .prepare(
            `INSERT INTO academic_reports
                (student_id, last_name, first_name, major, classification,
                 academic_year, semester, attempted_credit_hours, passed_credit_hours,
                 semester_gpa, career_gpa, ip_address, confirmation_reference, review_status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`
        )
        .run(
            data.student_id,
            data.last_name,
            data.first_name,
            data.major,
            data.classification,
            data.academic_year,
            data.semester,
            data.attempted_credit_hours,
            data.passed_credit_hours,
            data.semester_gpa,
            data.career_gpa,
            ip || null,
            reference
        );

    const id = Number(info.lastInsertRowid);
    await logAudit(id, 'submitted', 'Student form', null);
    return { id, reference };
}

async function updateReport(id, data, actor) {
    const info = await db
        .prepare(
            `UPDATE academic_reports SET
                student_id = ?, last_name = ?, first_name = ?, major = ?,
                classification = ?, academic_year = ?, semester = ?,
                attempted_credit_hours = ?, passed_credit_hours = ?,
                semester_gpa = ?, career_gpa = ?, internal_notes = ?,
                updated_at = datetime('now','localtime')
             WHERE id = ?`
        )
        .run(
            data.student_id,
            data.last_name,
            data.first_name,
            data.major,
            data.classification,
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
 * Duplicate guard: one report per student per academic term.
 * Optionally excludes a report id (when an admin edits a report).
 * `excludeId` lets the edit path avoid flagging the row itself.
 */
async function findSemesterDuplicate(data, excludeId) {
    const params = [data.student_id, data.academic_year, data.semester];
    let sql =
        `SELECT id FROM academic_reports
         WHERE student_id = ? AND academic_year = ? AND semester = ?`;
    if (excludeId) {
        sql += ' AND id <> ?';
        params.push(Number(excludeId));
    }
    sql += ' LIMIT 1';
    return db.prepare(sql).get(...params) || null;
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
 * Dashboard statistics for the whole database (not scoped to the
 * current filters). The five headline cards:
 *
 *   total_reports            - every submission
 *   submitted_this_semester  - reports for the term in progress
 *   avg_semester_gpa         - mean semester GPA (2dp)
 *   avg_career_gpa           - mean career GPA (2dp)
 *   total_students           - distinct reporting students
 *
 * Status/today/month counts are supplied for secondary UI labels.
 */
async function stats() {
    const term = currentAcademicTerm();

    const total = await db.prepare('SELECT COUNT(*) AS n FROM academic_reports').get();
    const termRow = await db
        .prepare(
            'SELECT COUNT(*) AS n FROM academic_reports WHERE academic_year = ? AND semester = ?'
        )
        .get(term.academic_year, term.semester);
    const avgSem = await db.prepare('SELECT AVG(semester_gpa) AS v FROM academic_reports').get();
    const avgCareer = await db.prepare('SELECT AVG(career_gpa) AS v FROM academic_reports').get();
    const students = await db.prepare('SELECT COUNT(DISTINCT student_id) AS n FROM academic_reports').get();

    const countBy = async (column, value) => {
        const row = await db
            .prepare(`SELECT COUNT(*) AS n FROM academic_reports WHERE ${column} = ?`)
            .get(value);
        return Number(row.n);
    };

    const roundGpa = (v) => {
        if (v === null || v === undefined) return null;
        return Math.round((Number(v) + Number.EPSILON) * 100) / 100;
    };

    const today = await db
        .prepare("SELECT COUNT(*) AS n FROM academic_reports WHERE date(created_at) = date('now','localtime')")
        .get();

    return {
        total: Number(total.n),
        submitted_this_semester: Number(termRow.n),
        avg_semester_gpa: roundGpa(avgSem.v),
        avg_career_gpa: roundGpa(avgCareer.v),
        total_students: Number(students.n),
        pending: await countBy('review_status', 'pending'),
        verified: await countBy('review_status', 'verified'),
        rejected: await countBy('review_status', 'rejected'),
        needs_correction: await countBy('review_status', 'needs_correction'),
        archived: await countBy('review_status', 'archived'),
        today: Number(today.n),
        current_term: term,
    };
}

async function academicYears() {
    const stored = (await db
        .prepare("SELECT DISTINCT academic_year AS y FROM academic_reports WHERE academic_year <> '' ORDER BY y DESC")
        .all()).map((row) => row.y);
    const offered = require('./validate').academicYearOptions();
    return Array.from(new Set([...stored, ...offered])).sort().reverse();
}

async function majors() {
    return (await db
        .prepare("SELECT DISTINCT major AS m FROM academic_reports WHERE major <> '' ORDER BY m COLLATE NOCASE ASC")
        .all()).map((row) => row.m);
}

async function semesters() {
    return SEMESTERS;
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
    findSemesterDuplicate,
    stats,
    academicYears,
    majors,
    semesters,
};