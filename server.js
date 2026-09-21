'use strict';

/**
 * server.js
 * -----------------------------------------------------------------
 * Presidential Scholars Academic Reporting Portal - Node.js + SQLite
 * server.
 *
 *   Student portal : http://localhost:3000/   (also /submit)
 *   Admin area     : http://localhost:3000/admin
 *
 * Run with:  node server.js
 * -----------------------------------------------------------------
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const { ensureDefaultAdmin } = require('./src/db');
const { createSession, getSession, destroySession, cleanupSessions, authenticate, changePassword } = require('./src/auth');
const { validateReport, validatePassword, academicYearOptions, CLASSIFICATIONS, SEMESTERS } = require('./src/validate');
const { buildWorkbook } = require('./src/xlsx');
const reports = require('./src/reports');

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const PUBLIC_DIR = path.join(__dirname, 'public');

/* ================================================================
 |  Small helpers
 * ============================================================== */
function parseCookies(req) {
    const header = req.headers.cookie || '';
    const out = {};
    header.split(';').forEach((pair) => {
        const idx = pair.indexOf('=');
        if (idx > -1) {
            const k = pair.slice(0, idx).trim();
            const v = pair.slice(idx + 1).trim();
            if (k) out[k] = decodeURIComponent(v);
        }
    });
    return out;
}

function sendJson(res, status, payload, extraHeaders = {}) {
    const body = JSON.stringify(payload);
    res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        ...extraHeaders,
    });
    res.end(body);
}

function readJsonBody(req) {
    return new Promise((resolve, reject) => {
        let size = 0;
        const chunks = [];
        req.on('data', (chunk) => {
            size += chunk.length;
            if (size > 64 * 1024) {
                reject(new Error('Payload too large'));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => {
            const raw = Buffer.concat(chunks).toString('utf8');
            if (!raw) return resolve({});
            try {
                resolve(JSON.parse(raw));
            } catch {
                reject(new Error('Invalid JSON'));
            }
        });
        req.on('error', reject);
    });
}

function clientIp(req) {
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) {
        return String(forwarded).split(',')[0].trim().replace('::ffff:', '');
    }
    return (req.socket.remoteAddress || '').replace('::ffff:', '');
}

/* ================================================================
 |  Security headers, CSRF cookie, origin checks
 * ============================================================== */
const SECURITY_HEADERS = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin',
    'Content-Security-Policy':
        "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; base-uri 'self'; form-action 'self'",
};

function applySecurityHeaders(res) {
    for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
        res.setHeader(key, value);
    }
}

function ensureCsrfCookie(req, res) {
    const cookies = parseCookies(req);
    if (!cookies.ps_csrf) {
        const token = crypto.randomBytes(32).toString('hex');
        res.setHeader(
            'Set-Cookie',
            `ps_csrf=${token}; Path=/; SameSite=Lax; Max-Age=${60 * 60 * 12}`
        );
        return token;
    }
    return cookies.ps_csrf;
}

function checkCsrf(req) {
    const cookies = parseCookies(req);
    const header = req.headers['x-csrf-token'];
    return Boolean(cookies.ps_csrf && header && cookies.ps_csrf === header);
}

function checkOrigin(req) {
    const origin = req.headers.origin;
    if (!origin) return true; // same-origin fetches may omit it in some browsers
    try {
        const host = req.headers.host;
        return new URL(origin).host === host;
    } catch {
        return false;
    }
}

/* ================================================================
 |  Simple in-memory rate limiter
 * ============================================================== */
const rateBuckets = new Map();

function rateLimit(key, max, windowMs) {
    const now = Date.now();
    const bucket = rateBuckets.get(key);

    if (!bucket || now > bucket.reset) {
        rateBuckets.set(key, { count: 1, reset: now + windowMs });
        return true;
    }
    bucket.count += 1;
    return bucket.count <= max;
}

setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of rateBuckets) {
        if (now > bucket.reset) rateBuckets.delete(key);
    }
    cleanupSessions();
}, 10 * 60 * 1000).unref();

/* ================================================================
 |  Static file serving
 * ============================================================== */
const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.png': 'image/png',
    '.woff2': 'font/woff2',
};

function serveStatic(req, res, urlPath) {
    const relative = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
    const filePath = path.join(PUBLIC_DIR, relative);

    // Prevent path traversal outside the public folder.
    if (!filePath.startsWith(PUBLIC_DIR)) {
        res.writeHead(403).end('Forbidden');
        return;
    }

    fs.stat(filePath, (err, stat) => {
        if (err || !stat.isFile()) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Not found');
            return;
        }

        res.writeHead(200, {
            'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
            'Cache-Control': 'no-cache',
        });
        fs.createReadStream(filePath).pipe(res);
    });
}

/* ================================================================
 |  Admin session from cookie
 * ============================================================== */
async function currentAdmin(req) {
    const cookies = parseCookies(req);
    return getSession(cookies.ps_admin);
}

async function requireAdmin(req, res) {
    const admin = await currentAdmin(req);
    if (!admin) {
        sendJson(res, 401, { error: 'Authentication required.' });
        return null;
    }
    return admin;
}

/* ================================================================
 |  CSV helpers
 * ============================================================== */
function csvCell(value) {
    let v = value === null || value === undefined ? '' : String(value);
    if (/^[=+\-@]/.test(v)) {
        v = `'${v}`;
    }
    return `"${v.replace(/"/g, '""')}"`;
}

function statusLabel(s) {
    return {
        pending: 'Submitted',
        verified: 'Reviewed',
        rejected: 'Rejected',
        needs_correction: 'Needs Correction',
        archived: 'Archived',
    }[s] || s || 'Submitted';
}

/* ================================================================
 |  API routes
 * ============================================================== */
async function handleApi(req, res, url) {
    const { pathname } = url;
    const method = req.method;
    const mutating = !['GET', 'HEAD', 'OPTIONS'].includes(method);

    // CSRF + origin protection on every request that changes data.
    if (mutating) {
        if (!checkOrigin(req)) {
            return sendJson(res, 403, { error: 'Request blocked (origin).' });
        }
        if (!checkCsrf(req)) {
            return sendJson(res, 419, { error: 'Your session expired. Please refresh the page.' });
        }
    }

    /* ---------- session / csrf bootstrap ---------- */
    if (pathname === '/api/csrf' && method === 'GET') {
        return sendJson(res, 200, { token: ensureCsrfCookie(req, res) });
    }

    /* ---------- public: fixed option lists (single source of truth) ---------- */
    if (pathname === '/api/meta' && method === 'GET') {
        return sendJson(res, 200, {
            classifications: CLASSIFICATIONS,
            semesters: SEMESTERS,
            academic_years: academicYearOptions(),
        });
    }

    /* ---------- public: submit a report ---------- */
    if (pathname === '/api/reports' && method === 'POST') {
        const ip = clientIp(req);
        if (!rateLimit(`submit:${ip}`, 20, 60 * 60 * 1000)) {
            return sendJson(res, 429, { error: 'Too many submissions. Please try again later.' });
        }

        let body;
        try {
            body = await readJsonBody(req);
        } catch {
            return sendJson(res, 400, { error: 'Invalid request.' });
        }

        // Honeypot: real users never fill this hidden field.
        if (body.website_url) {
            return sendJson(res, 200, { ok: true, message: 'Your report has been submitted successfully. Thank you.' });
        }

        const { data, errors } = validateReport(body);
        if (Object.keys(errors).length) {
            return sendJson(res, 422, { error: 'Please correct the highlighted fields.', errors });
        }

        // Duplicate protection: one report per student per academic term.
        if (await reports.findSemesterDuplicate(data)) {
            return sendJson(res, 409, {
                error: 'A report for this student and semester has already been submitted.',
                code: 'duplicate_term',
            });
        }

        const { id, reference } = await reports.createReport(data, ip);
        const saved = await reports.getReport(id);

        return sendJson(res, 201, {
            ok: true,
            id,
            reference,
            submitted_at: saved.created_at,
            review_status: 'pending',
            summary: {
                student_id: saved.student_id,
                student_name: `${saved.first_name} ${saved.last_name}`,
                major: saved.major,
                classification: saved.classification,
                academic_year: saved.academic_year,
                semester: saved.semester,
                attempted_credit_hours: saved.attempted_credit_hours,
                passed_credit_hours: saved.passed_credit_hours,
                semester_gpa: saved.semester_gpa,
                career_gpa: saved.career_gpa,
                reference,
            },
            message: 'Your report has been submitted successfully. Thank you.',
        });
    }

    /* ---------- admin: login / logout / me ---------- */
    if (pathname === '/api/admin/login' && method === 'POST') {
        const ip = clientIp(req);
        if (!rateLimit(`login:${ip}`, 10, 15 * 60 * 1000)) {
            return sendJson(res, 429, { error: 'Too many attempts. Please wait a few minutes.' });
        }

        let body;
        try {
            body = await readJsonBody(req);
        } catch {
            return sendJson(res, 400, { error: 'Invalid request.' });
        }

        const admin = await authenticate(body.username, body.password);
        if (!admin) {
            return sendJson(res, 401, { error: 'Invalid username or password.' });
        }

        const { token, csrf } = await createSession(admin.id);
        return sendJson(
            res,
            200,
            { ok: true, admin: { username: admin.username, full_name: admin.full_name } },
            {
                'Set-Cookie': `ps_admin=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${8 * 3600}`,
                'X-CSRF-Token': csrf,
            }
        );
    }

    if (pathname === '/api/admin/logout' && method === 'POST') {
        const cookies = parseCookies(req);
        await destroySession(cookies.ps_admin);
        return sendJson(res, 200, { ok: true }, {
            'Set-Cookie': 'ps_admin=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0',
        });
    }

    if (pathname === '/api/admin/me' && method === 'GET') {
        const admin = await currentAdmin(req);
        if (!admin) return sendJson(res, 200, { authenticated: false });
        return sendJson(res, 200, {
            authenticated: true,
            admin: { username: admin.username, full_name: admin.full_name },
            csrf: admin.csrf,
        });
    }

    if (pathname === '/api/admin/password' && method === 'POST') {
        const admin = await requireAdmin(req, res);
        if (!admin) return;

        let body;
        try {
            body = await readJsonBody(req);
        } catch {
            return sendJson(res, 400, { error: 'Invalid request.' });
        }

        const problem = validatePassword(body.new_password);
        if (problem) return sendJson(res, 422, { error: problem });
        if (body.new_password !== body.confirm_password) {
            return sendJson(res, 422, { error: 'The two new passwords do not match.' });
        }

        const err = await changePassword(admin.admin_id, body.current_password, body.new_password);
        if (err) return sendJson(res, 422, { error: err });

        const cookies = parseCookies(req);
        await destroySession(cookies.ps_admin);
        return sendJson(res, 200, { ok: true, message: 'Password updated. Please log in again.' }, {
            'Set-Cookie': 'ps_admin=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0',
        });
    }

    /* ---------- admin: everything below needs a session ---------- */
    if (pathname === '/api/admin/stats' && method === 'GET') {
        if (!(await requireAdmin(req, res))) return;
        return sendJson(res, 200, await reports.stats());
    }

    if (pathname === '/api/admin/years' && method === 'GET') {
        if (!(await requireAdmin(req, res))) return;
        return sendJson(res, 200, { years: await reports.academicYears() });
    }

    if (pathname === '/api/admin/majors' && method === 'GET') {
        if (!(await requireAdmin(req, res))) return;
        return sendJson(res, 200, { majors: await reports.majors() });
    }

    if (pathname === '/api/admin/export' && method === 'GET') {
        const admin = await requireAdmin(req, res);
        if (!admin) return;

        const filters = {
            q: url.searchParams.get('q') || '',
            classification: url.searchParams.get('classification') || '',
            semester: url.searchParams.get('semester') || '',
            academic_year: url.searchParams.get('academic_year') || '',
            major: url.searchParams.get('major') || '',
            review_status: url.searchParams.get('review_status') || '',
            date_from: url.searchParams.get('date_from') || '',
            date_to: url.searchParams.get('date_to') || '',
        };
        const rows = await reports.allReports(filters);
        const stamp = new Date().toISOString().slice(0, 10);

        // Internal administrator notes are never included in exports.
        const columns = [
            'Student ID', 'Last Name', 'First Name', 'Major', 'Classification',
            'Academic Year', 'Semester', 'Attempted Credit Hours', 'Passed Credit Hours',
            'Semester GPA', 'Career GPA', 'Submission Date', 'Status',
            'Confirmation Reference', 'Reviewed By', 'Reviewed At', 'Last Updated',
        ];

        const rowValues = (r) => [
            r.student_id, r.last_name, r.first_name, r.major, r.classification,
            r.academic_year, r.semester, r.attempted_credit_hours, r.passed_credit_hours,
            r.semester_gpa, r.career_gpa, r.created_at,
            statusLabel(r.review_status), r.confirmation_reference,
            r.reviewed_by || '', r.reviewed_at || '', r.updated_at,
        ];

        const format = (url.searchParams.get('format') || 'csv').toLowerCase();
        if (format === 'xlsx') {
            const book = buildWorkbook(columns, rows.map(rowValues));
            res.writeHead(200, {
                'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                'Content-Disposition': `attachment; filename="presidential-scholars-reports-${stamp}.xlsx"`,
                'Cache-Control': 'no-store',
            });
            res.end(book);
            return;
        }

        const lines = [columns.map(csvCell).join(',')];
        for (const r of rows) {
            lines.push(rowValues(r).map(csvCell).join(','));
        }

        const filename = `presidential-scholars-reports-${stamp}.csv`;
        res.writeHead(200, {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': `attachment; filename="${filename}"`,
            'Cache-Control': 'no-store',
        });
        res.end('\uFEFF' + lines.join('\r\n'));
        return;
    }

    if (pathname === '/api/admin/reports' && method === 'GET') {
        if (!(await requireAdmin(req, res))) return;
        const result = await reports.listReports({
            q: url.searchParams.get('q') || '',
            classification: url.searchParams.get('classification') || '',
            semester: url.searchParams.get('semester') || '',
            academic_year: url.searchParams.get('academic_year') || '',
            major: url.searchParams.get('major') || '',
            review_status: url.searchParams.get('review_status') || '',
            date_from: url.searchParams.get('date_from') || '',
            date_to: url.searchParams.get('date_to') || '',
            sort: url.searchParams.get('sort') || '',
            dir: url.searchParams.get('dir') || '',
            page: url.searchParams.get('page') || '',
            per_page: url.searchParams.get('per_page') || '',
        });
        return sendJson(res, 200, result);
    }

    // Review workflow: verify, request corrections, archive / restore.
    const reviewMatch = pathname.match(/^\/api\/admin\/reports\/(\d+)\/(review|archive)$/);
    if (reviewMatch) {
        const admin = await requireAdmin(req, res);
        if (!admin) return;
        const id = Number(reviewMatch[1]);
        const action = reviewMatch[2];
        const actor = admin.full_name || admin.username;

        if (!(await reports.getReport(id))) {
            return sendJson(res, 404, { error: 'Report not found.' });
        }

        let body;
        try {
            body = await readJsonBody(req);
        } catch {
            return sendJson(res, 400, { error: 'Invalid request.' });
        }

        if (action === 'review') {
            const updated = await reports.reviewReport(id, body.decision, actor, body.note);
            if (!updated) {
                return sendJson(res, 422, { error: 'Choose Approve, Reject, or Needs Correction.' });
            }
            return sendJson(res, 200, { ok: true, report: updated });
        }

        const updated = await reports.archiveReport(id, body.archived !== false, actor);
        if (!updated) {
            return sendJson(res, 404, { error: 'Report not found.' });
        }
        return sendJson(res, 200, { ok: true, report: updated });
    }

    const reportMatch = pathname.match(/^\/api\/admin\/reports\/(\d+)$/);
    if (reportMatch) {
        const admin = await requireAdmin(req, res);
        if (!admin) return;
        const id = Number(reportMatch[1]);
        const actor = admin.full_name || admin.username;

        if (method === 'GET') {
            const report = await reports.getReport(id);
            if (!report) return sendJson(res, 404, { error: 'Report not found.' });
            return sendJson(res, 200, { report, audit: await reports.getAudit(id) });
        }

        if (method === 'PUT' || method === 'PATCH') {
            if (!(await reports.getReport(id))) return sendJson(res, 404, { error: 'Report not found.' });
            let body;
            try {
                body = await readJsonBody(req);
            } catch {
                return sendJson(res, 400, { error: 'Invalid request.' });
            }
            const { data, errors } = validateReport(body);
            if (Object.keys(errors).length) {
                return sendJson(res, 422, { error: 'Please correct the highlighted fields.', errors });
            }
            // Editing into another student's term is a duplicate.
            if (await reports.findSemesterDuplicate(data, id)) {
                return sendJson(res, 409, {
                    error: 'A report for this student and semester has already been submitted.',
                    code: 'duplicate_term',
                });
            }
            // Internal notes ride along with the edit payload (admin-only route).
            data.internal_notes = body.internal_notes;
            await reports.updateReport(id, data, actor);
            return sendJson(res, 200, { ok: true, message: 'The report has been updated.' });
        }

        if (method === 'DELETE') {
            if (!(await reports.deleteReport(id, actor))) return sendJson(res, 404, { error: 'Report not found.' });
            return sendJson(res, 200, { ok: true, message: 'The report has been deleted.' });
        }
    }

    return sendJson(res, 404, { error: 'Not found.' });
}

/* ================================================================
 |  Server
 * ============================================================== */
function handler(req, res) {
    applySecurityHeaders(res);

    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    // Make sure a CSRF cookie exists for the front end to read.
    ensureCsrfCookie(req, res);

    if (url.pathname.startsWith('/api/')) {
        if (req.method === 'OPTIONS') {
            res.writeHead(204).end();
            return;
        }
        handleApi(req, res, url).catch((err) => {
            console.error('[api]', err);
            sendJson(res, 500, { error: 'Something went wrong. Please try again.' });
        });
        return;
    }

    // Friendly aliases for the admin area: login and dashboard are separate pages.
    if (url.pathname === '/admin' || url.pathname === '/admin/' ||
        url.pathname === '/admin/login' || url.pathname === '/admin/login/') {
        return serveStatic(req, res, '/login.html');
    }
    if (url.pathname === '/admin/dashboard' || url.pathname === '/admin/dashboard/') {
        return serveStatic(req, res, '/dashboard.html');
    }

    // Friendly aliases for the public submission portal.
    if (url.pathname === '/submit' || url.pathname === '/submit/' || url.pathname === '/') {
        return serveStatic(req, res, '/index.html');
    }

    serveStatic(req, res, url.pathname);
}

const server = http.createServer(handler);

async function main() {
    const created = await ensureDefaultAdmin();
    server.listen(PORT, HOST, () => {
        console.log('');
        console.log('  Presidential Scholars Academic Reporting Portal');
        console.log('  ----------------------------------------------');
        console.log(`  Student portal : http://${HOST}:${PORT}/`);
        console.log(`  Admin login    : http://${HOST}:${PORT}/admin`);
        console.log(`  Dashboard      : http://${HOST}:${PORT}/admin/dashboard`);
        console.log('');
        if (created) {
            console.log(`  Admin account -> ${created.fullName} (username: ${created.username}  password: ${created.password})`);
            if (created.isDefault) {
                console.log('  (Set ADMIN_PASSWORD to choose your own, or change it after logging in.)');
            }
        }
        const { db } = require('./src/db');
        console.log(`  Database       : ${db.backend()}`);
        console.log('');
    });
}

// On Vercel the request handler is exported and invoked per request;
// there is no long-running listen(). Vercel's custom-server build
// requires the default export to be a function or http.Server.
if (!process.env.VERCEL) {
    main();
}

// On Vercel there is no bootstrap step, so the default admin account is
// seeded lazily on the first request (it self-checks and only inserts once).
let seedPromise = null;
function seedDefaultAdmin() {
    const { ensureDefaultAdmin } = require('./src/db');
    if (!seedPromise) {
        seedPromise = ensureDefaultAdmin().catch((e) => {
            console.error('[seed]', e);
            seedPromise = null;
        });
    }
    return seedPromise;
}

async function vercelHandler(req, res) {
    await seedDefaultAdmin();
    return handler(req, res);
}
vercelHandler.handler = handler;
vercelHandler.server = server;

module.exports = vercelHandler;