/* ==================================================================
   login.js - admin sign-in. On success the browser is taken to the
   separate /admin/dashboard page (a different page, not a swapped
   view), exactly as requested.
   ================================================================== */
(function () {
    'use strict';

    var $ = function (id) { return document.getElementById(id); };
    var form = $('loginForm');
    if (!form) return;

    var btn = $('loginBtn');

    function goDashboard() {
        window.location.href = '/admin/dashboard';
    }

    function checkSession() {
        window.PS.api('/api/admin/me')
            .then(function (res) {
                if (res.authenticated) goDashboard();
            })
            .catch(function () {});
    }

    form.addEventListener('submit', function (e) {
        e.preventDefault();

        var errBox = $('loginError');
        errBox.classList.remove('show');

        btn.disabled = true;
        btn.innerHTML = '<span class="spinner" aria-hidden="true"></span><span>Signing in&hellip;</span>';

        window.PS.ensureCsrf()
            .then(function () {
                return window.PS.api('/api/admin/login', {
                    method: 'POST',
                    body: { username: $('loginUser').value, password: $('loginPass').value }
                });
            })
            .then(function (res) {
                window.PS.toast('success', 'Welcome back, ' + (res.admin.full_name || res.admin.username) + '.');
                goDashboard();
            })
            .catch(function (err) {
                btn.disabled = false;
                btn.textContent = 'Log In';
                errBox.textContent = err.message || 'Unable to sign in.';
                errBox.classList.add('show');
            });
    });

    $('pwToggle').addEventListener('click', function () {
        var input = $('loginPass');
        var showing = input.type === 'text';
        input.type = showing ? 'password' : 'text';
        this.innerHTML = showing ? '&#128065;' : '&#128683;';
        this.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
    });

    checkSession();
})();