'use strict';

/**
 * src/auth.js
 * -----------------------------------------------------------------
 * Session handling and admin authentication.
 *
 *   - Sessions live in the SQLite `sessions` table so they survive a
 *     server restart.
 *   - Passwords are verified with scrypt (see security.js).
 *   - Every session carries a CSRF token used by the front end.
 * -----------------------------------------------------------------
 */

const { db } = require('./db');
const { hashPassword, verifyPassword, randomToken } = require('./security');

const SESSION_HOURS = 8;

async function createSession(adminId) {
    const token = randomToken(32);
    const csrf = randomToken(32);
    const expires = new Date(Date.now() + SESSION_HOURS * 3600 * 1000);

    await db.prepare(
        `INSERT INTO sessions (token, admin_id, csrf, expires_at)
         VALUES (?, ?, ?, datetime(?))`
    ).run(token, adminId, csrf, expires.toISOString().replace('T', ' ').slice(0, 19));

    return { token, csrf };
}

async function getSession(token) {
    if (!token) {
        return null;
    }

    const session = await db
        .prepare(
            `SELECT s.token, s.csrf, s.expires_at, a.id AS admin_id,
                    a.username, a.full_name
             FROM sessions s
             JOIN admins a ON a.id = s.admin_id
             WHERE s.token = ?`
        )
        .get(token);

    if (!session) {
        return null;
    }

    // Expired?
    if (new Date(session.expires_at.replace(' ', 'T') + 'Z').getTime() < Date.now()) {
        await destroySession(token);
        return null;
    }

    return session;
}

async function destroySession(token) {
    if (token) {
        await db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    }
}

async function cleanupSessions() {
    await db.prepare("DELETE FROM sessions WHERE expires_at < datetime('now')").run();
}

/**
 * Verify credentials. Returns the admin row on success, or null.
 */
async function authenticate(username, password) {
    const admin = await db
        .prepare('SELECT * FROM admins WHERE username = ?')
        .get(String(username || '').trim());

    if (!admin || !verifyPassword(password, admin.password_hash)) {
        return null;
    }

    await db.prepare("UPDATE admins SET last_login = datetime('now','localtime') WHERE id = ?").run(admin.id);
    return admin;
}

async function changePassword(adminId, currentPassword, newPassword) {
    const admin = await db.prepare('SELECT * FROM admins WHERE id = ?').get(adminId);
    if (!admin) {
        return 'Account not found.';
    }
    if (!verifyPassword(currentPassword, admin.password_hash)) {
        return 'Your current password is incorrect.';
    }

    await db.prepare('UPDATE admins SET password_hash = ? WHERE id = ?').run(
        hashPassword(newPassword),
        adminId
    );

    // Invalidate every other session for safety.
    await db.prepare('DELETE FROM sessions WHERE admin_id = ?').run(adminId);

    return null;
}

module.exports = {
    createSession,
    getSession,
    destroySession,
    cleanupSessions,
    authenticate,
    changePassword,
};