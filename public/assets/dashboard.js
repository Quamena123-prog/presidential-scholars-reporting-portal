/* ==================================================================
   dashboard.js - admin dashboard: stats, search, filters, sort,
   pagination, report drawer, review workflow, exports, password.
   ================================================================== */
(function () {
    'use strict';

    var $ = function (id) { return document.getElementById(id); };

    var state = {
        q: '',
        year: '',
        semester: '',
        classification: '',
        major: '',
        status: '',
        sort: 'created_at',
        dir: 'desc',
        page: 1,
        per: 10,
        total: 0,
        pages: 1,
        admin: null,
        timer: null,
    };

    var STATUS_LABELS = {
        pending: 'Pending Review',
        verified: 'Verified',
        rejected: 'Rejected',
        needs_correction: 'Needs Correction',
        archived: 'Archived',
    };

    /* ----------------------------------------------------------------
       Session bootstrap
       ---------------------------------------------------------------- */
    function boot() {
        window.PS.api('/api/admin/me')
            .then(function (res) {
                if (!res.authenticated) {
                    window.location.href = '/admin/login';
                    return;
                }
                state.admin = res.admin;
                var name = res.admin.full_name || res.admin.username;
                $('sideAdminName').textContent = name;
                $('topUserName').textContent = name;
                $('topAvatar').textContent = window.PS.initials(
                    String(name).split(' ')[0], String(name).split(' ')[1] || ''
                );
                init();
            })
            .catch(function () {
                window.location.href = '/admin/login';
            });
    }

    /* ----------------------------------------------------------------
       Querystring for list/stats/export calls
       ---------------------------------------------------------------- */
    function params(extra) {
        var p = new URLSearchParams();
        if (state.q) p.set('q', state.q);
        if (state.year) p.set('academic_year', state.year);
        if (state.semester) p.set('semester', state.semester);
        if (state.classification) p.set('classification', state.classification);
        if (state.major) p.set('major', state.major);
        if (state.status) p.set('review_status', state.status);
        Object.assign(p, extra || {});
        return p.toString();
    }

    function loadList() {
        return window.PS.api('/api/admin/reports?' + params({
            sort: state.sort, dir: state.dir, page: state.page, per_page: state.per,
        }));
    }

    function loadStats() {
        return window.PS.api('/api/admin/stats?' + params());
    }

    /* ----------------------------------------------------------------
       Rendering
       ---------------------------------------------------------------- */
    function badge(status) {
        var label = STATUS_LABELS[status] || status || '';
        return '<span class="badge st ' + window.PS.escape(status || '') + '">' +
            '<span class="bdot" aria-hidden="true"></span>' + window.PS.escape(label) + '</span>';
    }

    function esc(v) { return window.PS.escape(v === null || v === undefined ? '' : v); }

    function renderStats(s) {
        $('statTotal').textContent = s.total;
        $('statThisTerm').textContent = s.this_term;
        var cur = s.current_term || {};
        $('statThisTermSub').textContent = (cur.semester || '') + ' ' + (cur.academic_year || '');
        $('statSemGpa').textContent = window.PS.gpafmt(s.avg_semester_gpa);
        $('statCareerGpa').textContent = window.PS.gpafmt(s.avg_career_gpa);
        $('statStudents').textContent = s.students;

        var parts = [
            ['pending', s.pending, 'Pending'],
            ['verified', s.verified, 'Verified'],
            ['needs_correction', s.needs_correction, 'Needs Correction'],
            ['rejected', s.rejected, 'Rejected'],
            ['archived', s.archived, 'Archived'],
        ].map(function (p) {
            var pct = s.total ? Math.round((p[1] / s.total) * 100) : 0;
            return '<button class="br-item" data-status="' + p[0] + '">' +
                '<span class="badge st ' + p[0] + '"><span class="bdot" aria-hidden="true"></span>' + p[2] + '</span>' +
                '<span class="br-bar"><span class="br-fill" style="width:' + pct + '%"></span></span>' +
                '<strong>' + p[1] + '</strong></button>';
        }).join('');
        $('statusBreakdown').innerHTML = '<div class="br-head"><span class="eyebrow">Reports by Status</span></div><div class="br-grid">' + parts + '</div>';

        document.querySelectorAll('.br-item').forEach(function (el) {
            el.addEventListener('click', function () {
                var status = el.getAttribute('data-status');
                state.status = $('fStatus').value === status ? '' : status;
                $('fStatus').value = state.status;
                state.page = 1;
                refresh();
            });
        });
    }

    function renderRows(rows) {
        var body = $('tableBody');
        if (!rows.length) {
            body.innerHTML = '<tr class="empty-row"><td colspan="14">' +
                '<div class="empty-state"><span class="empty-ico" aria-hidden="true">&#128203;</span>' +
                '<h3>No reports found</h3><p>No reports match the current search or filters.</p>' +
                '<button class="btn btn-secondary btn-sm" type="button" id="emptyReset">Clear filters</button></div></td></tr>';
            var er = $('emptyReset');
            if (er) er.addEventListener('click', resetFilters);
            return;
        }

        body.innerHTML = rows.map(function (r) {
            return '<tr class="clickable" data-id="' + r.id + '" tabindex="0" role="button" aria-label="Open report">' +
                '<td class="mono">' + esc(r.student_id) + '</td>' +
                '<td>' + esc(r.last_name) + '</td>' +
                '<td>' + esc(r.first_name) + '</td>' +
                '<td>' + esc(r.major) + '</td>' +
                '<td>' + esc(r.classification) + '</td>' +
                '<td>' + esc(r.academic_year) + '</td>' +
                '<td>' + esc(r.semester) + '</td>' +
                '<td class="num">' + window.PS.credimt(r.attempted_credit_hours) + '</td>' +
                '<td class="num">' + window.PS.credimt(r.passed_credit_hours) + '</td>' +
                '<td class="num">' + window.PS.gpafmt(r.semester_gpa) + '</td>' +
                '<td class="num">' + window.PS.gpafmt(r.career_gpa) + '</td>' +
                '<td class="muted">' + esc(window.PS.formatDate(r.created_at)) + '</td>' +
                '<td>' + badge(r.review_status) + '</td>' +
                '<td class="col-actions"><button class="icon-btn" type="button" data-open="' + r.id + '" aria-label="View report">' +
                '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg></button></td>' +
                '</tr>';
        }).join('');

        body.querySelectorAll('tr[data-id]').forEach(function (tr) {
            tr.addEventListener('click', function (e) {
                if (e.target.closest('button[data-open]')) return;
                openReport(Number(tr.getAttribute('data-id')));
            });
            tr.addEventListener('keydown', function (e) {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    openReport(Number(tr.getAttribute('data-id')));
                }
            });
        });
        body.querySelectorAll('button[data-open]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                openReport(Number(btn.getAttribute('data-open')));
            });
        });

        $('resultCount').textContent = state.total;
        var first = (state.page - 1) * state.per + 1;
        var last = Math.min(state.page * state.per, state.total);
        $('rangeInfo').textContent = state.total ? ('Showing ' + first + '\u2013' + last + ' of ' + state.total) : 'No reports';
        $('pageInfo').textContent = state.pages > 1 ? ('Page ' + state.page + ' of ' + state.pages) : '';
        renderPager();

        var note = $('filterNote');
        var activeCount = [state.q, state.year, state.semester, state.classification, state.major, state.status]
            .filter(Boolean).length;
        note.textContent = activeCount ? '\u00B7 filtered' : '';
    }

    function renderPager() {
        var pager = $('pager');
        if (state.pages <= 1) { pager.innerHTML = ''; return; }
        var pages = [];
        for (var i = 1; i <= state.pages; i++) {
            if (state.pages > 9 && i > 2 && i < state.pages - 1 && Math.abs(i - state.page) > 1) continue;
            pages.push(i);
        }
        var html = [];
        html.push('<button class="pg" type="button" data-page="' + Math.max(1, state.page - 1) + '"' + (state.page === 1 ? ' disabled' : '') + '>&laquo;</button>');
        for (var j = 0; j < pages.length; j++) {
            html.push('<button class="pg' + (pages[j] === state.page ? ' active' : '') + '" type="button" data-page="' + pages[j] + '">' + pages[j] + '</button>');
        }
        html.push('<button class="pg" type="button" data-page="' + Math.min(state.pages, state.page + 1) + '"' + (state.page === state.pages ? ' disabled' : '') + '>&raquo;</button>');
        pager.innerHTML = html.join('');
        pager.querySelectorAll('.pg').forEach(function (btn) {
            btn.addEventListener('click', function () {
                if (btn.disabled) return;
                state.page = Number(btn.getAttribute('data-page'));
                loadList().then(renderRows).catch(showErr);
            });
        });
    }

    /* ----------------------------------------------------------------
       Data flow
       ---------------------------------------------------------------- */
    function refresh() {
        setLoading(true);
        Promise.all([loadStats(), loadList()])
            .then(function (results) {
                renderStats(results[0]);
                state.total = results[1].total;
                state.pages = results[1].pages;
                renderRows(results[1].rows);
                setLoading(false);
            })
            .catch(function (err) {
                setLoading(false);
                showErr(err);
            });
    }

    function setLoading(on) {
        if (on) $('resultCount').textContent = 'Loading\u2026';
        var body = $('tableBody');
        if (on && !body.children.length) {
            body.innerHTML = '<tr class="empty-row"><td colspan="14"><div class="loading-state">Loading reports\u2026</div></td></tr>';
        }
    }

    function showErr(err) {
        if (err.status === 401) {
            window.location.href = '/admin/login';
            return;
        }
        window.PS.toast('error', err.message || 'Unable to load reports.');
    }

    function loadFilterOptions() {
        window.PS.api('/api/admin/years').then(function (d) {
            var sel = $('fYear');
            (d.years || []).forEach(function (y) {
                var opt = document.createElement('option');
                opt.value = y; opt.textContent = y;
                sel.appendChild(opt);
            });
        }).catch(function () {});
        window.PS.api('/api/admin/majors').then(function (d) {
            var sel = $('fMajor');
            (d.majors || []).forEach(function (m) {
                var opt = document.createElement('option');
                opt.value = m; opt.textContent = m;
                sel.appendChild(opt);
            });
        }).catch(function () {});
    }

    function resetFilters() {
        state.q = ''; state.year = ''; state.semester = '';
        state.classification = ''; state.major = ''; state.status = '';
        state.page = 1;
        $('fQ').value = '';
        $('fYear').value = '';
        $('fSemester').value = '';
        $('fClassification').value = '';
        $('fMajor').value = '';
        $('fStatus').value = '';
        refresh();
    }

    /* ----------------------------------------------------------------
       Exports
       ---------------------------------------------------------------- */
    function exportUrl(format) {
        return '/api/admin/export?format=' + format + '&' + params();
    }
    function goExport(format) {
        window.location.href = exportUrl(format);
    }

    /* ----------------------------------------------------------------
       Report drawer
       ---------------------------------------------------------------- */
    function openReport(id) {
        window.PS.api('/api/admin/reports/' + id)
            .then(function (d) {
                renderDrawer(d.report, d.audit || []);
            })
            .catch(showErr);
    }

    function renderDrawer(r, audit) {
        var overlay = document.createElement('div');
        overlay.className = 'drawer-overlay';
        overlay.innerHTML =
            '<div class="drawer" role="dialog" aria-modal="true" aria-label="Report details">' +
            '<header class="drawer-head">' +
            '<div><p class="eyebrow">Report details</p>' +
            '<h2>' + esc(r.first_name) + ' ' + esc(r.last_name) + '</h2>' +
            '<span class="mono">' + esc(r.confirmation_reference) + '</span></div>' +
            '<button class="icon-btn" type="button" data-close aria-label="Close">&#10005;</button>' +
            '</header>' +
            '<div class="drawer-body">' +

            '<div class="drow"><div class="dgroup">' +
            '<h3>Student Information</h3>' +
            '<dl class="kv">' +
            '<div><dt>Student ID</dt><dd>' + esc(r.student_id) + '</dd></div>' +
            '<div><dt>First Name</dt><dd>' + esc(r.first_name) + '</dd></div>' +
            '<div><dt>Last Name</dt><dd>' + esc(r.last_name) + '</dd></div>' +
            '<div><dt>Major</dt><dd>' + esc(r.major) + '</dd></div>' +
            '<div><dt>Classification</dt><dd>' + esc(r.classification) + '</dd></div>' +
            '</dl></div>' +

            '<div class="dgroup"><h3>Semester</h3><dl class="kv">' +
            '<div><dt>Academic Year</dt><dd>' + esc(r.academic_year) + '</dd></div>' +
            '<div><dt>Semester</dt><dd>' + esc(r.semester) + '</dd></div>' +
            '</dl></div></div>' +

            '<div class="drow"><div class="dgroup">' +
            '<h3>Academic Performance</h3><dl class="kv">' +
            '<div><dt>Attempted Credit Hours</dt><dd>' + window.PS.credimt(r.attempted_credit_hours) + '</dd></div>' +
            '<div><dt>Passed Credit Hours</dt><dd>' + window.PS.credimt(r.passed_credit_hours) + '</dd></div>' +
            '<div><dt>Semester GPA</dt><dd>' + window.PS.gpafmt(r.semester_gpa) + '</dd></div>' +
            '<div><dt>Career GPA</dt><dd>' + window.PS.gpafmt(r.career_gpa) + '</dd></div>' +
            '</dl></div>' +

            '<div class="dgroup"><h3>Submission</h3><dl class="kv">' +
            '<div><dt>Submission Date</dt><dd>' + esc(window.PS.formatDateOnly(r.created_at)) + '</dd></div>' +
            '<div><dt>Submission Time</dt><dd>' + esc(window.PS.formatTimeOnly(r.created_at)) + '</dd></div>' +
            '<div><dt>Status</dt><dd>' + badge(r.review_status) + '</dd></div>' +
            '<div><dt>Confirmation Number</dt><dd class="mono">' + esc(r.confirmation_reference) + '</dd></div>' +
            '<div><dt>Reviewed By</dt><dd>' + esc(r.reviewed_by || '\u2014') + '</dd></div>' +
            '</dl></div></div>' +

            '<div class="dgroup"><h3>Administrator Notes <span class="opt">(private)</span></h3>' +
            '<textarea class="input" id="internalNotes" rows="3" maxlength="2000" placeholder="Add private notes for the file.">' +
            esc(r.internal_notes) + '</textarea></div>' +

            '<div class="dgroup"><h3>Review Actions</h3>' +
            '<div class="drow review-actions">' +
            '<button class="btn btn-sm btn-success" type="button" data-action="verified">Approve</button>' +
            '<button class="btn btn-sm" type="button" data-action="needs_correction">Needs Correction</button>' +
            '<button class="btn btn-sm btn-danger" type="button" data-action="rejected">Reject</button>' +
            '<button class="btn btn-sm btn-secondary" type="button" data-action="' + (r.review_status === 'archived' ? 'restore' : 'archive') + '">' +
            (r.review_status === 'archived' ? 'Restore' : 'Archive') + '</button>' +
            '<button class="btn btn-sm btn-secondary" type="button" data-action="edit">Edit</button>' +
            '<button class="btn btn-sm btn-danger-ghost" type="button" data-action="delete">Delete</button>' +
            '</div></div>' +

            '<div class="dgroup"><h3>Audit Trail</h3>' +
            '<ul class="audit">' + audit.map(function (a) {
                return '<li><span class="mono">' + esc(a.action) + '</span>' +
                    '<span class="audit-when">' + esc(window.PS.formatDate(a.created_at)) + '</span>' +
                    (a.actor ? '<span class="audit-actor">by ' + esc(a.actor) + '</span>' : '') +
                    (a.note ? '<p class="audit-note">' + esc(a.note) + '</p>' : '') + '</li>';
            }).join('') + '</ul></div>' +

            '</div></div>';

        $('overlayRoot').appendChild(overlay);

        var close = function () {
            overlay.remove();
            document.body.classList.remove('drawer-open');
        };
        overlay.querySelector('[data-close]').addEventListener('click', close);
        overlay.addEventListener('click', function (e) {
            if (e.target === overlay) close();
        });
        document.addEventListener('keydown', function listener(e) {
            if (e.key === 'Escape' && document.body.contains(overlay)) {
                close();
                document.removeEventListener('keydown', listener);
            }
        });
        document.body.classList.add('drawer-open');

        overlay.querySelectorAll('[data-action]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                handleAction(r, btn.getAttribute('data-action'), close);
            });
        });
    }

    function handleAction(r, action, close) {
        if (action === 'edit') {
            close();
            openEditModal(r);
            return;
        }
        if (action === 'delete') {
            if (!window.confirm('Delete this report permanently? This cannot be undone.')) return;
            window.PS.api('/api/admin/reports/' + r.id, { method: 'DELETE' })
                .then(function () {
                    close();
                    window.PS.toast('success', 'Report deleted.');
                    refresh();
                })
                .catch(showErr);
            return;
        }
        if (action === 'archive' || action === 'restore') {
            window.PS.api('/api/admin/reports/' + r.id + '/archive', {
                method: 'POST',
                body: { archived: action === 'archive' },
            }).then(function () {
                window.PS.toast('success', action === 'archive' ? 'Report archived.' : 'Report restored.');
                close();
                refresh();
            }).catch(showErr);
            return;
        }
        // review actions
        var note = $('internalNotes') ? $('internalNotes').value.trim() : '';
        window.PS.api('/api/admin/reports/' + r.id + '/review', {
            method: 'POST',
            body: { decision: action, note: note },
        }).then(function () {
            window.PS.toast('success', 'Report updated to ' + (STATUS_LABELS[action] || action) + '.');
            close();
            refresh();
        }).catch(showErr);
    }

    /* ----------------------------------------------------------------
       Edit modal
       ---------------------------------------------------------------- */
    function openEditModal(r) {
        var overlay = document.createElement('div');
        overlay.className = 'drawer-overlay';
        overlay.innerHTML =
            '<div class="drawer" role="dialog" aria-modal="true" aria-label="Edit report">' +
            '<header class="drawer-head"><div><p class="eyebrow">Edit report</p>' +
            '<h2>' + esc(r.first_name) + ' ' + esc(r.last_name) + '</h2></div>' +
            '<button class="icon-btn" type="button" data-close aria-label="Close">&#10005;</button></header>' +
            '<div class="drawer-body"><form id="editForm">' +
            '<div class="grid">' +
            field('Student ID', 'edit_student_id', r.student_id) +
            field('Last Name', 'edit_last_name', r.last_name) +
            field('First Name', 'edit_first_name', r.first_name) +
            field('Major', 'edit_major', r.major) +
            '<div class="field"><label for="edit_classification">Classification</label>' +
            '<select class="input" id="edit_classification">' +
            ['Freshman', 'Sophomore', 'Junior', 'Senior'].map(function (c) {
                return '<option' + (c === r.classification ? ' selected' : '') + '>' + c + '</option>';
            }).join('') + '</select></div>' +
            '<div class="field"><label for="edit_academic_year">Academic Year</label>' +
            '<select class="input" id="edit_academic_year"></select></div>' +
            '<div class="field"><label for="edit_semester">Semester</label>' +
            '<select class="input" id="edit_semester">' +
            ['Fall', 'Spring', 'Summer'].map(function (s) {
                return '<option' + (s === r.semester ? ' selected' : '') + '>' + s + '</option>';
            }).join('') + '</select></div>' +
            field('Attempted Credit Hours', 'edit_attempted', r.attempted_credit_hours) +
            field('Passed Credit Hours', 'edit_passed', r.passed_credit_hours) +
            field('Semester GPA', 'edit_semester_gpa', Number(r.semester_gpa).toFixed(2)) +
            field('Career GPA', 'edit_career_gpa', Number(r.career_gpa).toFixed(2)) +
            '</div>' +
            '<div class="form-actions"><button class="btn btn-secondary" type="button" data-cancel>Cancel</button>' +
            '<button class="btn btn-primary" type="submit">Save Changes</button></div></form></div></div>';

        $('overlayRoot').appendChild(overlay);
        var close = function () { overlay.remove(); };

        window.PS.api('/api/meta').then(function (m) {
            var sel = $('edit_academic_year');
            (m.academic_years || []).forEach(function (y) {
                var opt = document.createElement('option');
                opt.value = y; opt.textContent = y;
                if (y === r.academic_year) opt.selected = true;
                sel.appendChild(opt);
            });
        }).catch(function () {});

        overlay.querySelector('[data-close]').addEventListener('click', close);
        overlay.querySelector('[data-cancel]').addEventListener('click', close);
        overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });

        overlay.querySelector('#editForm').addEventListener('submit', function (e) {
            e.preventDefault();
            var payload = {
                student_id: $('edit_student_id').value,
                last_name: $('edit_last_name').value,
                first_name: $('edit_first_name').value,
                major: $('edit_major').value,
                classification: $('edit_classification').value,
                academic_year: $('edit_academic_year').value,
                semester: $('edit_semester').value,
                attempted_credit_hours: $('edit_attempted').value,
                passed_credit_hours: $('edit_passed').value,
                semester_gpa: $('edit_semester_gpa').value,
                career_gpa: $('edit_career_gpa').value,
                internal_notes: r.internal_notes || '',
            };
            window.PS.api('/api/admin/reports/' + r.id, { method: 'PUT', body: payload })
                .then(function () {
                    close();
                    window.PS.toast('success', 'Report updated.');
                    refresh();
                })
                .catch(function (err) {
                    if (err.status === 409) {
                        window.PS.toast('error', err.data.error || 'Duplicate term.');
                    } else if (err.data && err.data.errors) {
                        var msg = Object.keys(err.data.errors).map(function (k) {
                            return err.data.errors[k];
                        }).join(' ');
                        window.PS.toast('error', msg);
                    } else {
                        window.PS.toast('error', err.message || 'Unable to save.');
                    }
                });
        });
    }

    function field(label, id, value) {
        return '<div class="field"><label for="' + id + '">' + window.PS.escape(label) + '</label>' +
            '<input class="input" id="' + id + '" type="text" value="' + window.PS.escape(value === null || value === undefined ? '' : value) + '"></div>';
    }

    /* ----------------------------------------------------------------
       Change password modal
       ---------------------------------------------------------------- */
    function openPasswordModal() {
        var overlay = document.createElement('div');
        overlay.className = 'drawer-overlay';
        overlay.innerHTML =
            '<div class="drawer dialog" role="dialog" aria-modal="true" aria-label="Change password">' +
            '<header class="drawer-head"><div><p class="eyebrow">Account</p><h2>Change Password</h2></div>' +
            '<button class="icon-btn" type="button" data-close aria-label="Close">&#10005;</button></header>' +
            '<div class="drawer-body"><form id="pwForm">' +
            '<div class="field"><label for="pwCurrent">Current Password</label>' +
            '<input class="input" id="pwCurrent" type="password" autocomplete="current-password"></div>' +
            '<div class="field"><label for="pwNew">New Password</label>' +
            '<input class="input" id="pwNew" type="password" autocomplete="new-password"></div>' +
            '<div class="field"><label for="pwConfirm">Confirm New Password</label>' +
            '<input class="input" id="pwConfirm" type="password" autocomplete="new-password"></div>' +
            '<div class="form-actions"><button class="btn btn-secondary" type="button" data-cancel>Cancel</button>' +
            '<button class="btn btn-primary" type="submit">Update Password</button></div></form></div></div>';

        $('overlayRoot').appendChild(overlay);
        var close = function () { overlay.remove(); };
        overlay.querySelector('[data-close]').addEventListener('click', close);
        overlay.querySelector('[data-cancel]').addEventListener('click', close);
        overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });

        overlay.querySelector('#pwForm').addEventListener('submit', function (e) {
            e.preventDefault();
            window.PS.api('/api/admin/password', { method: 'POST', body: {
                current_password: $('pwCurrent').value,
                new_password: $('pwNew').value,
                confirm_password: $('pwConfirm').value,
            } }).then(function (res) {
                window.PS.toast('success', res.message || 'Password updated. Please log in again.');
                setTimeout(function () { window.location.href = '/admin/login'; }, 1500);
            }).catch(function (err) {
                window.PS.toast('error', err.message || 'Unable to update password.');
            });
        });
    }

    /* ----------------------------------------------------------------
       Wire-up
       ---------------------------------------------------------------- */
    function init() {
        loadFilterOptions();
        refresh();

        var debounce = function (fn, ms) {
            return function () {
                var args = arguments;
                clearTimeout(state.timer);
                state.timer = setTimeout(function () { fn.apply(null, args); }, ms);
            };
        };

        $('fQ').addEventListener('input', debounce(function () {
            state.q = $('fQ').value;
            state.page = 1;
            refresh();
        }, 300));

        [['fYear', 'year'], ['fSemester', 'semester'], ['fClassification', 'classification'],
            ['fMajor', 'major'], ['fStatus', 'status']].forEach(function (pair) {
            $(pair[0]).addEventListener('change', function () {
                state[pair[1]] = $(pair[0]).value;
                state.page = 1;
                refresh();
            });
        });

        $('btnReset').addEventListener('click', resetFilters);

        document.querySelectorAll('th[data-sort]').forEach(function (th) {
            th.addEventListener('click', function () {
                var key = th.getAttribute('data-sort');
                if (state.sort === key) {
                    state.dir = state.dir === 'asc' ? 'desc' : 'asc';
                } else {
                    state.sort = key;
                    state.dir = key === 'created_at' ? 'desc' : 'asc';
                }
                state.page = 1;
                document.querySelectorAll('th[data-sort]').forEach(function (o) {
                    o.classList.remove('sorted-asc', 'sorted-desc');
                });
                th.classList.add(state.dir === 'asc' ? 'sorted-asc' : 'sorted-desc');
                refresh();
            });
        });

        $('fPer').addEventListener('change', function () {
            state.per = Number($('fPer').value);
            state.page = 1;
            refresh();
        });

        $('btnExportCsv').addEventListener('click', function () { goExport('csv'); });
        $('btnExportXlsx').addEventListener('click', function () { goExport('xlsx'); });

        $('navSignOut').addEventListener('click', function () {
            window.PS.api('/api/admin/logout', { method: 'POST' })
                .then(function () { window.location.href = '/admin/login'; })
                .catch(function () { window.location.href = '/admin/login'; });
        });

        $('navPassword').addEventListener('click', openPasswordModal);

        var side = document.querySelector('.adm-side');

        function setSide(open) {
            if (open) {
                side.classList.add('open');
                var first = side.querySelector('.nav-item');
                if (first) first.focus();
            } else {
                side.classList.remove('open');
            }
        }

        $('menuToggle').addEventListener('click', function () {
            setSide(!side.classList.contains('open'));
        });

        var backdrop = $('sideBackdrop');
        if (backdrop) backdrop.addEventListener('click', function () { setSide(false); });

        document.querySelectorAll('.nav-item').forEach(function (btn) {
            btn.addEventListener('click', function () { setSide(false); });
        });
    }

    boot();
})();