/* ==================================================================
   app.js - shared front-end utilities (CSRF, fetch, toasts, helpers)
   Used by form.js, login.js and dashboard.js.
   ================================================================== */
(function () {
    'use strict';

    window.PS = {
        /* ---------- CSRF ---------- */
        csrf: function () {
            var match = document.cookie.match(/(?:^|;\s*)ps_csrf=([^;]+)/);
            return match ? decodeURIComponent(match[1]) : '';
        },

        ensureCsrf: function () {
            if (window.PS.csrf()) return Promise.resolve(window.PS.csrf());
            return fetch('/api/csrf', { credentials: 'same-origin' })
                .then(function (r) { return r.json(); })
                .then(function (d) { return d.token; });
        },

        /* ---------- JSON API helper ---------- */
        api: function (path, options) {
            options = options || {};
            var headers = Object.assign(
                { 'Content-Type': 'application/json' },
                options.headers || {}
            );
            if (options.method && options.method !== 'GET') {
                headers['x-csrf-token'] = window.PS.csrf();
            }
            return fetch(path, {
                method: options.method || 'GET',
                credentials: 'same-origin',
                headers: headers,
                body: options.body ? JSON.stringify(options.body) : undefined
            }).then(function (res) {
                return res.json().catch(function () { return {}; }).then(function (data) {
                    if (!res.ok) {
                        var err = new Error(data.error || 'Request failed');
                        err.status = res.status;
                        err.data = data;
                        throw err;
                    }
                    return data;
                });
            });
        },

        /* ---------- Toast ---------- */
        toast: function (type, message, timeout) {
            var wrap = document.getElementById('toasts');
            if (!wrap) return;
            var icons = { success: '\u2713', error: '\u2715', info: 'i' };
            var el = document.createElement('div');
            el.className = 'toast ' + (type || 'info');
            el.innerHTML =
                '<span class="t-icon">' + (icons[type] || 'i') + '</span>' +
                '<span class="t-msg"></span>';
            el.querySelector('.t-msg').textContent = message;
            wrap.appendChild(el);
            setTimeout(function () {
                el.classList.add('hide');
                setTimeout(function () { el.remove(); }, 220);
            }, timeout || 4200);
        },

        /* ---------- Helpers ---------- */
        isValidStudentId: function (value) {
            return /^[A-Za-z0-9-]{3,20}$/.test(
                String(value === null || value === undefined ? '' : value).trim()
            );
        },

        escape: function (value) {
            return String(value === null || value === undefined ? '' : value)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
        },

        formatDate: function (value) {
            if (!value) return '-';
            var d = new Date(String(value).replace(' ', 'T'));
            if (isNaN(d)) return value;
            return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) +
                ', ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
        },

        fmt2: function (value) {
            if (value === null || value === undefined || value === '') return '—';
            return Number(value).toFixed(2);
        },

        /* Status label + badge class (must match server statusLabel). */
        statusInfo: function (status) {
            return {
                pending: { label: 'Submitted', cls: 'info' },
                verified: { label: 'Reviewed', cls: 'success' },
                rejected: { label: 'Rejected', cls: 'danger' },
                needs_correction: { label: 'Needs Correction', cls: 'warn' },
                archived: { label: 'Archived', cls: 'muted' }
            }[status] || { label: status || 'Submitted', cls: 'muted' };
        }
    };
})();