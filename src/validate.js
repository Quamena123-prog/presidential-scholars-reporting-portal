'use strict';

/**
 * src/validate.js
 * -----------------------------------------------------------------
 * Server-side validation for the Presidential Scholars Academic
 * Reporting Portal. This is the validation that actually protects
 * the database - client-side checks are only a convenience.
 * -----------------------------------------------------------------
 */

const CLASSIFICATIONS = ['Freshman', 'Sophomore', 'Junior', 'Senior'];

const SEMESTERS = ['Fall', 'Spring', 'Summer'];

const REVIEW_STATUSES = ['pending', 'verified', 'rejected', 'needs_correction', 'archived'];

const LIMITS = {
    student_id: 20,
    last_name: 100,
    first_name: 100,
    major: 150,
    internal_notes: 2000,
};

const MAX_CREDIT_HOURS = 200;
const MAX_GPA = 4.0;

function clean(value, max) {
    if (typeof value !== 'string') {
        return '';
    }
    // Remove control characters and trim.
    let out = value.replace(/[\u0000-\u001F\u007F]/g, '').trim();
    if (max) {
        out = out.slice(0, max * 2); // hard guard against huge payloads
    }
    return out;
}

/**
 * Student ID: letters, numbers and dashes, 3-20 characters.
 * Kept in sync with window.PS.isValidStudentId in app.js.
 */
function isValidStudentId(value) {
    return /^[A-Za-z0-9-]{3,20}$/.test(String(value === null || value === undefined ? '' : value).trim());
}

function normalizeStudentId(value) {
    return clean(value).replace(/\s+/g, '');
}

function round2(n) {
    return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Parse a numeric form value into a finite number, or null.
 * Accepts strings and numbers; strips commas. Rejects NaN/Infinity.
 */
function toFiniteNumber(value) {
    let n;
    if (typeof value === 'number') {
        n = value;
    } else if (typeof value === 'string') {
        const v = value.replace(/,/g, '').trim();
        if (v === '') return null;
        n = Number(v);
    } else {
        return null;
    }
    return Number.isFinite(n) ? n : null;
}

/**
 * Academic year labels use an en dash, e.g. "2026\u20132027".
 */
function isAcademicYear(value) {
    const m = /^(\d{4})\u2013(\d{4})$/.exec(value);
    if (!m) return false;
    return Number(m[2]) === Number(m[1]) + 1;
}

/**
 * Labels offered in the academic-year dropdown: this year plus the four
 * following years, e.g. ["2026\u20132027", ..., "2030\u20132031"].
 */
function academicYearOptions() {
    const start = new Date().getFullYear();
    return [0, 1, 2, 3, 4].map((i) => `${start + i}\u2013${start + i + 1}`);
}

/**
 * The academic term in progress right now, used by the "Submitted This
 * Semester" dashboard card. Aug-Dec = Fall of Y-(Y+1); Jan-Apr = Spring
 * of (Y-1)-Y; May-Jul = Summer of (Y-1)-Y.
 */
function currentAcademicTerm() {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth() + 1;
    if (m >= 8) return { academic_year: `${y}\u2013${y + 1}`, semester: 'Fall' };
    if (m >= 5) return { academic_year: `${y - 1}\u2013${y}`, semester: 'Summer' };
    return { academic_year: `${y - 1}\u2013${y}`, semester: 'Spring' };
}

function validateReport(input) {
    const src = input && typeof input === 'object' ? input : {};

    const data = {
        student_id: normalizeStudentId(src.student_id),
        first_name: clean(src.first_name),
        last_name: clean(src.last_name),
        major: clean(src.major),
        classification: clean(src.classification),
        academic_year: clean(src.academic_year),
        semester: clean(src.semester),
        attempted_credit_hours: toFiniteNumber(src.attempted_credit_hours),
        passed_credit_hours: toFiniteNumber(src.passed_credit_hours),
        semester_gpa: toFiniteNumber(src.semester_gpa),
        career_gpa: toFiniteNumber(src.career_gpa),
    };

    const errors = {};

    // ---- Student information ----
    if (data.student_id === '') {
        errors.student_id = 'Student ID is required.';
    } else if (!isValidStudentId(data.student_id)) {
        errors.student_id = 'Enter a valid student ID (letters and numbers only).';
    }

    if (data.first_name === '') {
        errors.first_name = 'First name is required.';
    } else if (data.first_name.length > LIMITS.first_name) {
        errors.first_name = `First name must be ${LIMITS.first_name} characters or fewer.`;
    }

    if (data.last_name === '') {
        errors.last_name = 'Last name is required.';
    } else if (data.last_name.length > LIMITS.last_name) {
        errors.last_name = `Last name must be ${LIMITS.last_name} characters or fewer.`;
    }

    if (data.major === '') {
        errors.major = 'Major is required.';
    } else if (data.major.length > LIMITS.major) {
        errors.major = `Major must be ${LIMITS.major} characters or fewer.`;
    }

    if (data.classification === '') {
        errors.classification = 'Classification is required.';
    } else if (!CLASSIFICATIONS.includes(data.classification)) {
        errors.classification = 'Please choose a valid classification.';
    }

    // ---- Semester information ----
    if (data.academic_year === '') {
        errors.academic_year = 'Please select an academic year.';
    } else if (!isAcademicYear(data.academic_year)) {
        errors.academic_year = 'Please select a valid academic year.';
    }

    if (data.semester === '') {
        errors.semester = 'Please select a semester.';
    } else if (!SEMESTERS.includes(data.semester)) {
        errors.semester = 'Please select a valid semester.';
    }

    // ---- Academic performance ----
    if (data.attempted_credit_hours === null) {
        errors.attempted_credit_hours = 'Attempted credit hours are required.';
    } else if (data.attempted_credit_hours < 0) {
        errors.attempted_credit_hours = 'Attempted credit hours cannot be negative.';
    } else if (data.attempted_credit_hours > MAX_CREDIT_HOURS) {
        errors.attempted_credit_hours = `Attempted credit hours must be ${MAX_CREDIT_HOURS} or fewer.`;
    } else {
        data.attempted_credit_hours = round2(data.attempted_credit_hours);
    }

    const attemptedOk = data.attempted_credit_hours !== null && Number.isFinite(data.attempted_credit_hours)
        && data.attempted_credit_hours >= 0 && data.attempted_credit_hours <= MAX_CREDIT_HOURS;

    if (data.passed_credit_hours === null) {
        errors.passed_credit_hours = 'Passed credit hours are required.';
    } else if (data.passed_credit_hours < 0) {
        errors.passed_credit_hours = 'Passed credit hours cannot be negative.';
    } else if (attemptedOk && data.passed_credit_hours > data.attempted_credit_hours) {
        errors.passed_credit_hours = 'Passed credit hours cannot exceed attempted credit hours.';
    } else if (data.passed_credit_hours > MAX_CREDIT_HOURS) {
        errors.passed_credit_hours = `Passed credit hours must be ${MAX_CREDIT_HOURS} or fewer.`;
    } else {
        data.passed_credit_hours = round2(data.passed_credit_hours);
    }

    if (data.semester_gpa === null) {
        errors.semester_gpa = 'Semester GPA is required.';
    } else if (data.semester_gpa < 0 || data.semester_gpa > MAX_GPA) {
        errors.semester_gpa = 'Please enter a GPA between 0.00 and 4.00.';
    } else {
        data.semester_gpa = round2(data.semester_gpa);
    }

    if (data.career_gpa === null) {
        errors.career_gpa = 'Career GPA is required.';
    } else if (data.career_gpa < 0 || data.career_gpa > MAX_GPA) {
        errors.career_gpa = 'Please enter a GPA between 0.00 and 4.00.';
    } else {
        data.career_gpa = round2(data.career_gpa);
    }

    return { data, errors };
}

function validatePassword(password) {
    const value = typeof password === 'string' ? password : '';
    if (value.length < 8) {
        return 'Password must be at least 8 characters long.';
    }
    if (!/[A-Za-z]/.test(value) || !/[0-9]/.test(value)) {
        return 'Password must contain at least one letter and one number.';
    }
    return null;
}

module.exports = {
    CLASSIFICATIONS,
    SEMESTERS,
    REVIEW_STATUSES,
    isValidStudentId,
    isAcademicYear,
    academicYearOptions,
    currentAcademicTerm,
    validateReport,
    validatePassword,
};