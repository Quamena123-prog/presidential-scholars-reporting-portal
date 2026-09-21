/* ==================================================================
   dashboard.js - admin dashboard: stats, search/filter, table,
   detail drawer, edit, review workflow, archive, delete, export,
   password change and sign-out.  All API calls go through PS.api.
   ================================================================== */
(function () {
    'use strict';

    function $(id) { return document.getElementById(id); }
    function esc(v) { return window.PS.escape(v); }

    var state = {
        q: '', classification: '', semester: '', academic_year: '',
        major: '', review_status: '', sort: 'created_at', dir: 'desc',
        page: 1, per_page: 10
    };

    var yearsCache = [];
    var currentReport = null;
    var currentAudit = [];
    var searchTimer = null;

    /* ================= Session guard / boot ================= */
    function boot() {
        window.PS.api('/api/admin/me')
            .then(function (res) {
                if (!res.authenticated) {
                    window.location.href = '/admin';
                    return;
                }
                var name = res.admin.full_name || res.admin.username;
                var parts = String(name).split(/\s+/);
                $('userName').textContent = name;
                $('userAvatar').textContent =
                    ((parts[0] || 'A').charAt(0) + (parts[1] ? parts[1].charAt(0) : '')).toUpperCase();
                initFilters();
                loadStats();
                loadReports();
            })
            .catch(function () { window.location.href = '/admin'; });
    }

    /* ================= Filters ================= */
    function initFilters() {
        window.PS.api('/api/admin/years').then(function (d) {
            yearsCache = d.years || [];
            fillSelect($('dYear'), yearsCache);
        });
        window.PS.api('/api/admin/majors').then(function (d) {
            fillSelect($('dMajor'), d.majors || []);
        });
    }

    function fillSelect(select, items) {
        var keep = [select.options[0]];
        (items || []).forEach(function (v) {
            var o = document.createElement('option');
            o.value = v; o.textContent = v;
            keep.push(o);
        });
        select.innerHTML = '';
        keep.forEach(function (o) { select.appendChild(o); });
    }

    /* ================= Stats ================= */
    function loadStats() {
        window.PS.api('/api/admin/stats').then(function (s) {
            $('statTotal').textContent = s.total.toLocaleString();
            $('statToday').textContent = s.today + ' submitted today';
            $('statTerm').textContent = s.submitted_this_semester.toLocaleString();
            var term = s.current_term || {};
            $('statTermLabel').textContent = 'Submitted This Semester';
            $('statTermSub').textContent = (term.semester || '') + ' ' + (term.academic_year || '');
            $('statAvgSem').textContent = s.avg_semester_gpa === null || s.avg_semester_gpa === undefined ? '—' : s.avg_semester_gpa.toFixed(2);
            $('statAvgCareer').textContent = s.avg_career_gpa === null || s.avg_career_gpa === undefined ? '—' : s.avg_career_gpa.toFixed(2);
            $('statStudents').textContent = s.total_students.toLocaleString();
            $('statusLine').textContent = 'Pending ' + s.pending +
                ' · Reviewed ' + s.verified +
                ' · Corrections ' + s.needs_correction +
                ' · Archived ' + s.archived;
        });
    }

    /* ================= Reports table ================= */
    function queryString() {
        var p = new URLSearchParams();
        if (state.q) p.set('q', state.q);
        if (state.classification) p.set('classification', state.classification);
        if (state.semester) p.set('semester', state.semester);
        if (state.academic_year) p.set('academic_year', state.academic_year);
        if (state.major) p.set('major', state.major);
        if (state.review_status) p.set('review_status', state.review_status);
        p.set('sort', state.sort);
        p.set('dir', state.dir);
        p.set('page', String(state.page));
        p.set('per_page', String(state.per_page));
        return p.toString();
    }

    function loadReports() {
        window.PS.api('/api/admin/reports?' + queryString()).then(function (res) {
            $('tbodyReports').innerHTML = '';
            res.rows.forEach(function (r) { $('tbodyReports').appendChild(rowEl(r)); });
            $('emptyState').hidden = res.total !== 0;
            $('pagination').hidden = res.total === 0;
            $('countTotal').textContent = res.total.toLocaleString() + ' report' + (res.total === 1 ? '' : 's');
            updateRange(res);
            renderPager(res);
        }).catch(function (err) {
            window.PS.toast('error', err.message || 'Could not load reports.');
        });
    }

    function statusBadge(status) {
        var info = window.PS.statusInfo(status);
        return '<span class="badge ' + info.cls + '">' + esc(info.label) + '</span>';
    }

    function rowEl(r) {
        var tr = document.createElement('tr');
        tr.className = 'row-link';
        tr.setAttribute('data-id', r.id);
        tr.innerHTML =
            '<td class="td-main">' + esc(r.student_id) + '</td>' +
            '<td>' + esc(r.last_name) + '</td>' +
            '<td>' + esc(r.first_name) + '</td>' +
            '<td>' + esc(r.major) + '</td>' +
            '<td>' + esc(r.classification) + '</td>' +
            '<td class="td-num">' + esc(r.academic_year) + '</td>' +
            '<td>' + esc(r.semester) + '</td>' +
            '<td class="td-num">' + window.PS.fmt2(r.attempted_credit_hours) + '</td>' +
            '<td class="td-num">' + window.PS.fmt2(r.passed_credit_hours) + '</td>' +
            '<td class="td-num">' + window.PS.fmt2(r.semester_gpa) + '</td>' +
            '<td class="td-num">' + window.PS.fmt2(r.career_gpa) + '</td>' +
            '<td>' + esc(window.PS.formatDate(r.created_at)) + '</td>' +
            '<td>' + statusBadge(r.review_status) + '</td>' +
            '<td><span class="actions-cell">' +
            '<button class="icon-btn view-btn" type="button" title="View report" aria-label="View report ' + esc(r.student_id) + '">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>' +
            '</button></span></td>';
        tr.addEventListener('click', function (e) {
            if (e.target.closest('.icon-btn')) return;
            openDrawer(r.id);
        });
        tr.querySelector('.view-btn').addEventListener('click', function (e) {
            e.stopPropagation();
            openDrawer(r.id);
        });
        return tr;
    }

    function updateRange(res) {
        var from = res.total === 0 ? 0 : (res.page - 1) * res.per_page + 1;
        var to = Math.min(res.page * res.per_page, res.total);
        $('rangeLabel').textContent = 'Showing ' + from + '\u2013' + to + ' of ' + res.total.toLocaleString();
    }

    function renderPager(res) {
        var pager = $('pager');
        pager.innerHTML = '';
        if (res.pages <= 1) return;

        var mk = function (label, page, active, disabled) {
            var b = document.createElement('button');
            b.textContent = label;
            b.disabled = !!disabled;
            if (active) b.classList.add('active');
            if (!active && !disabled) {
                b.addEventListener('click', function () {
                    state.page = page;
                    loadReports();
                });
            }
            return b;
        };

        pager.appendChild(mk('\u2039', res.page - 1, false, res.page <= 1));

        var start = Math.max(1, res.page - 2);
        var end = Math.min(res.pages, start + 4);
        start = Math.max(1, end - 4);
        if (start > 1) pager.appendChild(mk('1', 1, false));
        if (start > 2) { var g = document.createElement('span'); g.className = 'gap'; g.textContent = '…'; pager.appendChild(g); }
        for (var i = start; i <= end; i++) pager.appendChild(mk(String(i), i, i === res.page));
        if (end < res.pages - 1) { var g2 = document.createElement('span'); g2.className = 'gap'; g2.textContent = '…'; pager.appendChild(g2); }
        if (end < res.pages) pager.appendChild(mk(String(res.pages), res.pages, false));

        pager.appendChild(mk('\u203a', res.page + 1, false, res.page >= res.pages));
    }

    /* ================= Drawer ================= */
    function openDrawer(id) {
        setDrawerBusy(true);
        window.PS.api('/api/admin/reports/' + id).then(function (res) {
            currentReport = res.report;
            currentAudit = res.audit || [];
            renderDrawer();
            $('drawerBackdrop').hidden = false;
            $('reportDrawer').hidden = false;
            requestAnimationFrame(function () {
                $('drawerBackdrop').classList.add('show');
                $('reportDrawer').classList.add('show');
            });
            setDrawerBusy(false);
        }).catch(function (err) {
            window.PS.toast('error', err.message || 'Could not load the report.');
            setDrawerBusy(false);
        });
    }

    function closeDrawer() {
        $('drawerBackdrop').classList.remove('show');
        $('reportDrawer').classList.remove('show');
        setTimeout(function () {
            $('drawerBackdrop').hidden = true;
            $('reportDrawer').hidden = true;
        }, 220);
        currentReport = null;
    }

    function setDrawerBusy(busy) {
        $('drawerBody').innerHTML = busy
            ? '<p class="muted">Loading report…</p>'
            : $('drawerBody').innerHTML;
    }

    function dlItem(label, value, opts) {
        opts = opts || {};
        var v = value === null || value === undefined || value === '' ? '—' : value;
        if (opts.mono) v = '<span class="mono">' + esc(v) + '</span>';
        else if (!opts.raw) v = esc(v);
        return '<div class="dl-item' + (opts.full ? ' full' : '') + '"><dt>' + esc(label) + '</dt><dd>' + v + '</dd></div>';
    }

    function auditLabel(action) {
        return {
            submitted: 'Submitted',
            edited: 'Edited',
            verified: 'Approved',
            rejected: 'Rejected',
            needs_correction: 'Corrections requested',
            archived: 'Archived',
            restored: 'Restored',
            deleted: 'Deleted'
        }[action] || action || '';
    }

    function renderDrawer() {
        var r = currentReport;
        var info = window.PS.statusInfo(r.review_status);
        var isArchived = r.review_status === 'archived';

        var html = '';
        html += '<div class="dl-item" style="display:flex;align-items:center;gap:.7rem;flex-wrap:wrap">' +
            '<h2 style="font-size:1.05rem;margin:0">' + esc(r.first_name + ' ' + r.last_name) + '</h2>' +
            '<span class="badge ' + info.cls + '">' + esc(info.label) + '</span>' +
            '</div>';

        html += '<span class="section-title">Report Details</span>';
        html += '<div class="dl-grid">' +
            dlItem('Student ID', r.student_id, { mono: true }) +
            dlItem('Classification', r.classification) +
            dlItem('Major', r.major) +
            dlItem('Academic Year', r.academic_year) +
            dlItem('Semester', r.semester) +
            dlItem('Attempted Credit Hours', window.PS.fmt2(r.attempted_credit_hours), { raw: true }) +
            dlItem('Passed Credit Hours', window.PS.fmt2(r.passed_credit_hours), { raw: true }) +
            dlItem('Semester GPA', window.PS.fmt2(r.semester_gpa), { raw: true }) +
            dlItem('Career GPA', window.PS.fmt2(r.career_gpa), { raw: true }) +
            dlItem('Confirmation Reference', r.confirmation_reference, { mono: true }) +
            dlItem('Submitted', window.PS.formatDate(r.created_at), { raw: true }) +
            dlItem('Last Updated', window.PS.formatDate(r.updated_at), { raw: true }) +
            dlItem('Reviewed By', r.reviewed_by) +
            dlItem('Reviewed At', window.PS.formatDate(r.reviewed_at), { raw: true }) +
            dlItem('Submission IP', r.ip_address, { mono: true, full: true }) +
            '</div>';

        if (r.internal_notes) {
            html += '<span class="section-title">Internal Notes</span>' +
                '<p class="small" style="background:var(--warn-bg);border:1px solid #efd9a0;border-radius:8px;padding:.7rem .9rem;margin:0">' +
                esc(r.internal_notes) + '</p>';
        }

        html += '<span class="section-title">Actions</span>';
        html += '<div class="review-actions-row">' +
            '<button class="btn btn-success btn-sm" type="button" id="approveBtn">Approve</button>' +
            '<button class="btn btn-secondary btn-sm" type="button" id="correctBtn">Needs Correction</button>' +
            '<button class="btn btn-danger btn-sm" type="button" id="rejectBtn">Reject</button>' +
            '</div>';
        html += '<div class="field" style="margin-top:.7rem">' +
            '<label for="reviewNote">Review note (optional)</label>' +
            '<textarea class="input notes-ta" id="reviewNote" maxlength="2000" placeholder="Note recorded in the audit trail" style="min-height:64px"></textarea>' +
            '</div>';
        html += '<div class="review-actions-row" style="margin-top:.9rem">' +
            '<button class="btn btn-secondary btn-sm" type="button" id="archiveBtn">' +
            (isArchived ? 'Restore Report' : 'Archive Report') + '</button>' +
            '<button class="btn btn-secondary btn-sm" type="button" id="editBtn">Edit Details</button>' +
            '<button class="btn btn-danger btn-sm" type="button" id="deleteBtn">Delete Report</button>' +
            '</div>';

        html += '<span class="section-title">Audit Trail</span>';
        if (!currentAudit.length) {
            html += '<p class="muted small" style="margin:0">No audit entries recorded.</p>';
        } else {
            html += '<ul class="audit-list">' + currentAudit.map(function (a) {
                var meta = window.PS.formatDate(a.created_at) + (a.actor ? ' · ' + esc(a.actor) : '');
                var note = a.note ? '<span class="muted"> — ' + esc(a.note) + '</span>' : '';
                return '<li><span class="audit-action">' + esc(auditLabel(a.action)) + '</span>' +
                    note + '<span class="audit-meta">' + esc(meta) + '</span></li>';
            }).join('') + '</ul>';
        }

        $('drawerBody').innerHTML = html;
        $('drawerTitle').textContent = 'Report' + (r.student_id ? ' · ' + r.student_id : '');

        $('approveBtn').addEventListener('click', function () { reviewAction('verified'); });
        $('correctBtn').addEventListener('click', function () { reviewAction('needs_correction'); });
        $('rejectBtn').addEventListener('click', function () { reviewAction('rejected'); });
        $('archiveBtn').addEventListener('click', function () {
            if (isArchived) archiveAction(true);
            else archiveAction(false);
        });
        $('editBtn').addEventListener('click', openEditModal);
        $('deleteBtn').addEventListener('click', function () {
            askConfirm('Delete this report permanently? This cannot be undone.', function () { deleteReport(); });
        });
    }

    function reviewAction(decision) {
        var note = $('reviewNote') ? $('reviewNote').value : '';
        window.PS.api('/api/admin/reports/' + currentReport.id + '/review', {
            method: 'POST',
            body: { decision: decision, note: note }
        }).then(function (res) {
            res.report.id = currentReport.id;
            currentReport = Object.assign(currentReport, res.report);
            window.PS.toast('success', 'Report marked ' + window.PS.statusInfo(decision).label.toLowerCase() + '.');
            renderDrawer();
            loadReports();
            loadStats();
        }).catch(function (err) {
            window.PS.toast('error', err.message || 'Action failed.');
        });
    }

    function archiveAction(restore) {
        window.PS.api('/api/admin/reports/' + currentReport.id + '/archive', {
            method: 'POST',
            body: { archived: !restore }
        }).then(function (res) {
            currentReport = Object.assign(currentReport, res.report);
            window.PS.toast('success', restore ? 'Report restored.' : 'Report archived.');
            renderDrawer();
            loadReports();
            loadStats();
        }).catch(function (err) {
            window.PS.toast('error', err.message || 'Action failed.');
        });
    }

    function deleteReport() {
        window.PS.api('/api/admin/reports/' + currentReport.id, {
            method: 'DELETE'
        }).then(function () {
            window.PS.toast('success', 'Report deleted.');
            closeDrawer();
            loadReports();
            loadStats();
        }).catch(function (err) {
            window.PS.toast('error', err.message || 'Could not delete the report.');
        });
    }

    /* ================= Confirm modal ================= */
    var confirmCallback = null;

    function askConfirm(message, cb) {
        $('confirmMsg').textContent = message;
        $('confirmTitle').textContent = 'Are you sure?';
        confirmCallback = cb;
        $('confirmModal').hidden = false;
        $('modalBackdrop').hidden = false;
        $('confirmOk').focus();
    }

    function hideConfirm() {
        $('confirmModal').hidden = true;
        $('modalBackdrop').hidden = true;
        confirmCallback = null;
    }

    /* ================= Edit modal ================= */
    function openEditModal() {
        var r = currentReport;
        $('eStudentId').value = r.student_id;
        $('eLastName').value = r.last_name || '';
        $('eFirstName').value = r.first_name || '';
        $('eMajor').value = r.major || '';
        $('eClass').value = r.classification || 'Freshman';
        var years = yearsCache.slice();
        if (r.academic_year && years.indexOf(r.academic_year) === -1) years.push(r.academic_year);
        fillSelect($('eYear'), years);
        $('eYear').value = r.academic_year || '';
        $('eSemester').value = r.semester || 'Fall';
        $('eAttempted').value = r.attempted_credit_hours;
        $('ePassed').value = r.passed_credit_hours;
        $('eSemGpa').value = r.semester_gpa;
        $('eCareerGpa').value = r.career_gpa;
        $('eNotes').value = r.internal_notes || '';
        $('editError').textContent = '';
        $('editModal').hidden = false;
        $('modalBackdrop').hidden = false;
        $('eStudentId').focus();
    }

    function hideEditModal() {
        $('editModal').hidden = true;
        $('modalBackdrop').hidden = true;
    }

    function submitEdit(e) {
        e.preventDefault();
        var body = {
            student_id: $('eStudentId').value.trim(),
            last_name: $('eLastName').value.trim(),
            first_name: $('eFirstName').value.trim(),
            major: $('eMajor').value.trim(),
            classification: $('eClass').value,
            academic_year: $('eYear').value,
            semester: $('eSemester').value,
            attempted_credit_hours: $('eAttempted').value,
            passed_credit_hours: $('ePassed').value,
            semester_gpa: $('eSemGpa').value,
            career_gpa: $('eCareerGpa').value,
            internal_notes: $('eNotes').value
        };
        window.PS.api('/api/admin/reports/' + currentReport.id, {
            method: 'PUT',
            body: body
        }).then(function () {
            window.PS.toast('success', 'The report has been updated.');
            hideEditModal();
            if (currentReport) openDrawer(currentReport.id);
            loadReports();
            loadStats();
        }).catch(function (err) {
            if (err.status === 409) {
                $('editError').textContent = err.data.error || 'Duplicate report.';
                window.PS.toast('error', $('editError').textContent);
                return;
            }
            var msg = err.data && err.data.errors
                ? Object.keys(err.data.errors).map(function (k) { return err.data.errors[k]; }).join(' ')
                : (err.message || 'Could not save changes.');
            $('editError').textContent = msg;
        });
    }

    /* ================= Change password ================= */
    function openPwModal() {
        $('pwError').textContent = '';
        $('pwForm').reset();
        $('pwModal').hidden = false;
        $('modalBackdrop').hidden = false;
        $('pwCurrent').focus();
    }
    function hidePwModal() {
        $('pwModal').hidden = true;
        $('modalBackdrop').hidden = true;
    }
    function submitPw(e) {
        e.preventDefault();
        if ($('pwNew').value !== $('pwConfirm').value) {
            $('pwError').textContent = 'The two new passwords do not match.';
            return;
        }
        window.PS.api('/api/admin/password', {
            method: 'POST',
            body: { current_password: $('pwCurrent').value, new_password: $('pwNew').value, confirm_password: $('pwConfirm').value }
        }).then(function () {
            window.PS.toast('success', 'Password updated. Please log in again.');
            setTimeout(function () { window.location.href = '/admin'; }, 900);
        }).catch(function (err) {
            $('pwError').textContent = err.data && err.data.error ? err.data.error : (err.message || 'Could not change password.');
        });
    }

    /* ================= Export ================= */
    function exportData(format) {
        var p = new URLSearchParams();
        if (state.q) p.set('q', state.q);
        if (state.classification) p.set('classification', state.classification);
        if (state.semester) p.set('semester', state.semester);
        if (state.academic_year) p.set('academic_year', state.academic_year);
        if (state.major) p.set('major', state.major);
        if (state.review_status) p.set('review_status', state.review_status);
        p.set('format', format);
        window.location.href = '/api/admin/export?' + p.toString();
    }

    /* ================= Wire events ================= */
    function wire() {
        $('fSearch').addEventListener('input', function () {
            clearTimeout(searchTimer);
            $('searchClear').hidden = this.value === '';
            searchTimer = setTimeout(function () {
                state.q = $('fSearch').value.trim();
                state.page = 1;
                loadReports();
            }, 260);
        });
        $('searchClear').addEventListener('click', function () {
            $('fSearch').value = '';
            $('searchClear').hidden = true;
            state.q = '';
            state.page = 1;
            loadReports();
        });

        ['dYear', 'dSemester', 'dClassification', 'dMajor', 'dStatus'].forEach(function (sid) {
            $(sid).addEventListener('change', function () {
                var map = {
                    dYear: 'academic_year', dSemester: 'semester',
                    dClassification: 'classification', dMajor: 'major', dStatus: 'review_status'
                };
                state[map[sid]] = this.value;
                state.page = 1;
                loadReports();
            });
        });

        $('clearFiltersBtn').addEventListener('click', function () {
            ['dYear', 'dSemester', 'dClassification', 'dMajor', 'dStatus'].forEach(function (sid) {
                $(sid).value = '';
            });
            state = Object.assign(state, {
                classification: '', semester: '', academic_year: '', major: '',
                review_status: '', q: '', page: 1
            });
            $('fSearch').value = '';
            $('searchClear').hidden = true;
            loadReports();
        });

        document.querySelectorAll('#reportsTable th.sortable').forEach(function (th) {
            th.addEventListener('click', function () {
                var sort = th.getAttribute('data-sort');
                if (state.sort === sort) {
                    state.dir = state.dir === 'asc' ? 'desc' : 'asc';
                } else {
                    state.sort = sort;
                    state.dir = 'asc';
                }
                signalSort();
                state.page = 1;
                loadReports();
            });
        });

        $('perPageSel').addEventListener('change', function () {
            state.per_page = parseInt(this.value, 10) || 10;
            state.page = 1;
            loadReports();
        });

        $('exportCsvBtn').addEventListener('click', function () { exportData('csv'); });
        $('exportXlsxBtn').addEventListener('click', function () { exportData('xlsx'); });

        $('drawerClose').addEventListener('click', closeDrawer);
        $('drawerBackdrop').addEventListener('click', closeDrawer);
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') {
                if (!$('editModal').hidden) hideEditModal();
                else if (!$('pwModal').hidden) hidePwModal();
                else if (!$('confirmModal').hidden) hideConfirm();
                else if (!$('reportDrawer').hidden) closeDrawer();
                else closeUserMenu();
            }
        });

        $('editCancel').addEventListener('click', hideEditModal);
        $('editForm').addEventListener('submit', submitEdit);
        $('pwCancel').addEventListener('click', hidePwModal);
        $('pwForm').addEventListener('submit', submitPw);
        $('confirmCancel').addEventListener('click', hideConfirm);
        $('modalBackdrop').addEventListener('click', function () {
            if (!$('editModal').hidden) hideEditModal();
            else if (!$('pwModal').hidden) hidePwModal();
            else if (!$('confirmModal').hidden) hideConfirm();
        });
        $('confirmOk').addEventListener('click', function () {
            var cb = confirmCallback;
            hideConfirm();
            if (cb) cb();
        });

        $('userMenuBtn').addEventListener('click', function () {
            var menu = $('userMenu');
            menu.hidden = !menu.hidden;
            this.setAttribute('aria-expanded', String(!menu.hidden));
        });
        document.addEventListener('click', function (e) {
            if (!e.target.closest('.user-menu')) closeUserMenu();
        });
        function closeUserMenu() {
            $('userMenu').hidden = true;
            $('userMenuBtn').setAttribute('aria-expanded', 'false');
        }
        $('pwChangeBtn').addEventListener('click', openPwModal);
        $('logoutBtn').addEventListener('click', function () {
            window.PS.api('/api/admin/logout', { method: 'POST' })
                .catch(function () {})
                .finally(function () { window.location.href = '/admin'; });
        });

        document.getElementById('footYear').textContent = String(new Date().getFullYear());
    }

    function signalSort() {
        document.querySelectorAll('#reportsTable th.sortable').forEach(function (th) {
            var caret = th.querySelector('.th-caret');
            var active = th.getAttribute('data-sort') === state.sort;
            caret.textContent = active ? (state.dir === 'asc' ? '\u25b2' : '\u25bc') : '';
        });
    }

    wire();
    boot();
})();