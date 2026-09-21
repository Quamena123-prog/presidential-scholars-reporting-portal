/* ==================================================================
   form.js - public scholar semester-report form behaviour.
   Client-side checks are a convenience; the server validates again.
   Flow: Fill in -> Review -> Submit -> Confirmation.
   Confirmation is rendered from the saved POST response only - there
   is no public lookup, so references cannot be enumerated.
   ================================================================== */
(function () {
    'use strict';

    var form = document.getElementById('reportForm');
    if (!form) return;

    var FIELDS = ['student_id', 'last_name', 'first_name', 'major', 'classification',
        'academic_year', 'semester', 'attempted_credit_hours', 'passed_credit_hours',
        'semester_gpa', 'career_gpa'];

    var STEP = {
        FORM: 'stepForm',
        REVIEW: 'stepReview',
        CONFIRM: 'stepConfirm'
    };

    function $(id) { return document.getElementById(id); }

    var errorSummary = $('errorSummary');
    var errorList = $('errorList');
    var duplicateAlert = $('duplicateAlert');

    /* ---------------- Academic years from the server ---------------- */
    function loadMeta() {
        fetch('/api/meta', { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (meta) {
                var select = $('fYear');
                (meta.academic_years || []).forEach(function (y) {
                    var opt = document.createElement('option');
                    opt.value = y;
                    opt.textContent = y;
                    select.appendChild(opt);
                });
            })
            .catch(function () {});
    }

    /* ---------------- Field helpers ---------------- */
    function el(name) { return form.querySelector('[name="' + name + '"]'); }

    function labelFor(name) {
        var input = el(name);
        if (!input) return 'This field';
        var field = input.closest('.field');
        var label = field ? field.querySelector('label') : null;
        return label ? label.textContent.replace('*', '').replace('(optional)', '').replace(/\s+/g, ' ').trim() : 'This field';
    }

    function fieldEl(name) {
        var input = el(name);
        return input ? input.closest('.field') : null;
    }

    function setError(name, message) {
        var field = fieldEl(name);
        if (!field) return;
        var input = field.querySelector('.input');
        var error = field.querySelector('.error-text');

        if (message) {
            field.classList.add('has-err');
            if (input) { input.classList.add('invalid'); input.setAttribute('aria-invalid', 'true'); }
            if (error) { error.textContent = message; error.classList.add('show'); }
        } else {
            field.classList.remove('has-err');
            if (input) { input.classList.remove('invalid'); input.setAttribute('aria-invalid', 'false'); }
            if (error) { error.classList.remove('show'); }
        }
    }

    function clearAllErrors() {
        FIELDS.forEach(function (name) { setError(name, null); });
        errorSummary.hidden = true;
        errorList.innerHTML = '';
    }

    function showSummary(errors) {
        errorList.innerHTML = '';
        Object.keys(errors).forEach(function (name) {
            var li = document.createElement('li');
            var a = document.createElement('a');
            a.href = '#' + name;
            a.textContent = errors[name].message || errors[name];
            a.addEventListener('click', function (e) {
                e.preventDefault();
                showStep(STEP.FORM);
                var target = document.getElementById('f' + (name === 'student_id' ? 'StudentId' : name.toLowerCase()));
                target = target || document.getElementById('f' + name);
                var map = {
                    student_id: 'fStudentId', last_name: 'fLastName', first_name: 'fFirstName',
                    major: 'fMajor', classification: 'fClassification', academic_year: 'fYear',
                    semester: 'fSemester', attempted_credit_hours: 'fAttempted',
                    passed_credit_hours: 'fPassed', semester_gpa: 'fSemGpa', career_gpa: 'fCareerGpa'
                };
                var input = document.getElementById(map[name]);
                if (input) setTimeout(function () { input.focus(); }, 60);
            });
            li.appendChild(a);
            errorList.appendChild(li);
        });
        errorSummary.hidden = false;
        errorSummary.focus();
    }

    function hideSummary() {
        errorSummary.hidden = true;
        errorList.innerHTML = '';
    }

    /* ---------------- Validation ---------------- */
    function toNum(v) {
        if (v === null || v === undefined) return NaN;
        if (typeof v === 'number') return v;
        var s = String(v).replace(/,/g, '').trim();
        if (s === '') return NaN;
        return Number(s);
    }

    function validateField(name, value) {
        var v = (value === null || value === undefined) ? '' : String(value).trim();

        if (v === '' && name !== 'academic_year') {
            var label = labelFor(name);
            if (name === 'academic_year') return { message: 'Please select an academic year.' };
            if (name === 'semester') return { message: 'Please select a semester.' };
            return { message: label + ' is required.' };
        }
        if (v === '' && name === 'academic_year') {
            return { message: 'Please select an academic year.' };
        }

        if (name === 'student_id' && !window.PS.isValidStudentId(v)) {
            return { message: 'Enter a valid student ID (letters and numbers only).' };
        }
        if (name === 'classification' && ['Freshman', 'Sophomore', 'Junior', 'Senior'].indexOf(v) === -1) {
            return { message: 'Please choose a valid classification.' };
        }
        if (name === 'semester' && ['Fall', 'Spring', 'Summer'].indexOf(v) === -1) {
            return { message: 'Please select a valid semester.' };
        }
        if (name === 'academic_year' && !/^\d{4}\u2013\d{4}$/.test(v)) {
            return { message: 'Please select a valid academic year.' };
        }
        if (name === 'attempted_credit_hours') {
            var at = toNum(v);
            if (isNaN(at)) return { message: 'Attempted credit hours are required.' };
            if (at < 0) return { message: 'Attempted credit hours cannot be negative.' };
            if (at > 200) return { message: 'Attempted credit hours must be 200 or fewer.' };
        }
        if (name === 'passed_credit_hours') {
            var ps = toNum(v);
            if (isNaN(ps)) return { message: 'Passed credit hours are required.' };
            if (ps < 0) return { message: 'Passed credit hours cannot be negative.' };
            var attempted = toNum(el('attempted_credit_hours').value);
            if (!isNaN(attempted) && attempted >= 0 && ps > attempted) {
                return { message: 'Passed credit hours cannot exceed attempted credit hours.' };
            }
            if (ps > 200) return { message: 'Passed credit hours must be 200 or fewer.' };
        }
        if (name === 'semester_gpa' || name === 'career_gpa') {
            var gpa = toNum(v);
            if (isNaN(gpa)) return { message: 'GPA is required.' };
            if (gpa < 0 || gpa > 4.0) return { message: 'Please enter a GPA between 0.00 and 4.00.' };
        }
        return null;
    }

    function validateAll() {
        var errors = {};
        FIELDS.forEach(function (name) {
            var err = validateField(name, el(name).value);
            setError(name, err ? err.message : null);
            if (err) errors[name] = err;
        });
        return errors;
    }

    /* ---------------- Steps ---------------- */
    function showStep(stepId) {
        var order = [STEP.FORM, STEP.REVIEW, STEP.CONFIRM];
        order.forEach(function (id) {
            var panel = $(id);
            panel.hidden = id !== stepId;
            panel.setAttribute('aria-hidden', id !== stepId ? 'true' : 'false');
        });
        var stepIndex = order.indexOf(stepId);
        document.querySelectorAll('#stepsList .step').forEach(function (s, i) {
            var active = i === stepIndex;
            var done = i < stepIndex;
            s.classList.toggle('active', active);
            s.classList.toggle('done', done);
            if (active) s.setAttribute('aria-current', 'true');
            else s.removeAttribute('aria-current');
        });
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    /* ---------------- Review render ---------------- */
    function gather() {
        var data = {};
        FIELDS.forEach(function (name) {
            data[name] = el(name).value.trim();
        });
        return data;
    }

    function fmt2(n) { return Number(n).toFixed(2); }

    function group(title, rows) {
        return '<section class="review-group">' +
            '<h3>' + window.PS.escape(title) + '</h3>' +
            '<dl class="review-list">' + rows.map(function (r) {
                return '<div><dt>' + window.PS.escape(r.k) + '</dt><dd>' + r.v + '</dd></div>';
            }).join('') + '</dl></section>';
    }

    function row(k, v) {
        return { k: k, v: window.PS.escape(v === null || v === undefined ? '—' : v) };
    }

    function renderReview(data) {
        $('reviewBody').innerHTML =
            group('Student Information', [
                row('Student ID', data.student_id),
                row('Name', data.first_name + ' ' + data.last_name),
                row('Major', data.major),
                row('Classification', data.classification)
            ]) +
            group('Semester Information', [
                row('Academic Year', data.academic_year),
                row('Semester', data.semester)
            ]) +
            group('Academic Performance', [
                row('Attempted Credit Hours', data.attempted_credit_hours),
                row('Passed Credit Hours', data.passed_credit_hours),
                row('Semester GPA', fmt2(data.semester_gpa)),
                row('Career GPA', fmt2(data.career_gpa))
            ]);
        showStep(STEP.REVIEW);
        var heading = $('reviewTitle');
        heading.setAttribute('tabindex', '-1');
        heading.focus({ preventScroll: true });
    }

    /* ---------------- Confirmation render ---------------- */
    function fmtSubmitted(value) {
        if (!value) return '—';
        var d = new Date(String(value).replace(' ', 'T'));
        if (isNaN(d)) return value;
        return d.toLocaleString(undefined, {
            year: 'numeric', month: 'long', day: 'numeric',
            hour: 'numeric', minute: '2-digit'
        });
    }

    function detail(k, v, mono) {
        return '<div><dt>' + window.PS.escape(k) + '</dt><dd' + (mono ? ' class="mono"' : '') + '>' +
            window.PS.escape(v === null || v === undefined ? '—' : v) + '</dd></div>';
    }

    function renderConfirmation(res) {
        var s = res.summary || {};
        $('confirmDetails').innerHTML =
            detail('Confirmation Number', res.reference, true) +
            detail('Student ID', s.student_id, true) +
            detail('Student Name', s.student_name) +
            detail('Semester', s.semester) +
            detail('Academic Year', s.academic_year) +
            detail('Submission Date &amp; Time', fmtSubmitted(res.submitted_at));
        showStep(STEP.CONFIRM);
        var heading = $('confirmTitle');
        heading.setAttribute('tabindex', '-1');
        heading.focus({ preventScroll: true });
        window.PS.toast('success', res.message || 'Report submitted.');
        celebrate();
    }

    function celebrate() {
        var emblem = document.querySelector('.confirm-emblem');
        if (emblem) {
            emblem.classList.remove('draw');
            void emblem.offsetWidth;
            emblem.classList.add('draw');
        }
    }

    /* ---------------- Submit ---------------- */
    var submitBtn = $('submitBtn');
    var submitText = submitBtn.querySelector('.btn-text');

    function submitLoading(on) {
        submitBtn.disabled = on;
        if (on) {
            submitText.innerHTML = '<span class="spinner" aria-hidden="true"></span> Submitting…';
        } else {
            submitText.textContent = 'Submit Report';
        }
    }

    function submitReport() {
        submitLoading(true);
        var payload = { website_url: $('website_url').value };
        FIELDS.forEach(function (name) {
            payload[name] = el(name).value.trim();
        });

        window.PS.ensureCsrf()
            .then(function () {
                return window.PS.api('/api/reports', { method: 'POST', body: payload });
            })
            .then(function (res) {
                submitLoading(false);
                renderConfirmation(res);
            })
            .catch(function (err) {
                submitLoading(false);
                if (err.status === 409) {
                    showStep(STEP.REVIEW);
                    duplicateAlert.textContent = err.data.error || 'A report for this student and semester has already been submitted.';
                    duplicateAlert.hidden = false;
                    window.PS.toast('error', duplicateAlert.textContent);
                    return;
                }
                if (err.status === 422 && err.data && err.data.errors) {
                    showStep(STEP.FORM);
                    var mapped = {};
                    Object.keys(err.data.errors).forEach(function (name) {
                        setError(name, err.data.errors[name]);
                        mapped[name] = { message: err.data.errors[name] };
                    });
                    showSummary(mapped);
                    window.PS.toast('error', 'Please fix the highlighted fields.');
                } else {
                    window.PS.toast('error', err.message || 'Something went wrong.');
                }
            });
    }

    /* ---------------- Wire events ---------------- */
    form.addEventListener('submit', function (e) {
        e.preventDefault();
        duplicateAlert.hidden = true;
        hideSummary();
        var errors = validateAll();
        if (Object.keys(errors).length) {
            showSummary(errors);
            window.PS.toast('error', 'Please fix the highlighted fields.');
            return;
        }
        renderReview(gather());
    });

    $('editBtn').addEventListener('click', function () {
        duplicateAlert.hidden = true;
        showStep(STEP.FORM);
    });

    submitBtn.addEventListener('click', function () {
        submitReport();
    });

    $('againBtn').addEventListener('click', function () {
        form.reset();
        clearAllErrors();
        duplicateAlert.hidden = true;
        showStep(STEP.FORM);
    });

    FIELDS.forEach(function (name) {
        var input = el(name);
        if (!input) return;
        input.addEventListener('blur', function () {
            var err = validateField(name, input.value);
            setError(name, err ? err.message : null);
        });
        input.addEventListener('input', function () {
            var field = fieldEl(name);
            if (field && field.classList.contains('has-err')) {
                var err = validateField(name, input.value);
                setError(name, err ? err.message : null);
            }
            markSectionDone();
        });
        input.addEventListener('change', function () {
            var field = fieldEl(name);
            if (field && field.classList.contains('has-err')) {
                var err = validateField(name, input.value);
                setError(name, err ? err.message : null);
            }
            markSectionDone();
        });
    });

    function markSectionDone() {
        var sections = {
            sec1: ['student_id', 'last_name', 'first_name', 'major', 'classification'],
            sec2: ['academic_year', 'semester'],
            sec3: ['attempted_credit_hours', 'passed_credit_hours', 'semester_gpa', 'career_gpa']
        };
        Object.keys(sections).forEach(function (secId) {
            var done = sections[secId].every(function (name) {
                return el(name) && el(name).value.trim() !== '';
            });
            var sec = $(secId);
            if (sec) sec.classList.toggle('done', done);
        });
    }

    /* ---------------- Boot ---------------- */
    loadMeta();
    markSectionDone();
    window.PS.ensureCsrf();
    document.getElementById('footYear').textContent = String(new Date().getFullYear());
})();