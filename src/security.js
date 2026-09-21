'use strict';

/**
 * src/security.js
 * -----------------------------------------------------------------
 * Password hashing, session tokens and CSRF helpers.
 *
 * Passwords are hashed with scrypt (Node's built-in, memory-hard KDF)
 * salted with a random value per user. Plain text passwords are never
 * stored. Verification uses a timing-safe comparison.
 * -----------------------------------------------------------------
 */

const crypto = require('node:crypto');

const SCRYPT_KEYLEN = 64;

function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const derived = crypto.scryptSync(String(password), salt, SCRYPT_KEYLEN).toString('hex');
    return `scrypt$${salt}$${derived}`;
}

function verifyPassword(password, stored) {
    if (typeof stored !== 'string') {
        return false;
    }

    const parts = stored.split('$');
    if (parts.length !== 3 || parts[0] !== 'scrypt') {
        return false;
    }

    const [, salt, expected] = parts;
    let derived;
    try {
        derived = crypto.scryptSync(String(password), salt, SCRYPT_KEYLEN).toString('hex');
    } catch {
        return false;
    }

    const a = Buffer.from(expected, 'hex');
    const b = Buffer.from(derived, 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function randomToken(bytes = 32) {
    return crypto.randomBytes(bytes).toString('hex');
}

/**
 * Short unambiguous code for confirmation references, e.g. "A7K2Q9".
 * Crockford-style alphabet without 0/O and 1/I to avoid misreading.
 */
function randomCode(length = 6) {
    const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    const bytes = crypto.randomBytes(length);
    let out = '';
    for (let i = 0; i < length; i++) {
        out += alphabet[bytes[i] % alphabet.length];
    }
    return out;
}

function safeEqual(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') {
        return false;
    }
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

module.exports = { hashPassword, verifyPassword, randomToken, randomCode, safeEqual };
