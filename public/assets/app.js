/* ==================================================================
   app.js - shared front-end utilities (toasts, fetch/CSRF, format)
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
            var id = String(value === null || value === undefined ? '' : value).trim();
            return /^[A-Za-z0-9-]{3,20}$/.test(id);
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

        formatDateOnly: function (value) {
            if (!value) return '-';
            var d = new Date(String(value).replace(' ', 'T'));
            if (isNaN(d)) return value;
            return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
        },

        formatTimeOnly: function (value) {
            if (!value) return '-';
            var d = new Date(String(value).replace(' ', 'T'));
            if (isNaN(d)) return value;
            return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
        },

        gpafmt: function (n) {
            var v = Number(n);
            return Number.isFinite(v) ? v.toFixed(2) : '-';
        },

        credimt: function (n) {
            var v = Number(n);
            return Number.isFinite(v) ? String(v) : '-';
        },

        initials: function (first, last) {
            var a = String(first || '').charAt(0) || '?';
            var b = String(last || '').charAt(0);
            return (a + b).toUpperCase();
        }
    };
})();