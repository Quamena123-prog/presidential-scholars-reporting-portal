/* ==================================================================
   form.js - public Presidential Scholars semester report form:
   Fill In -> Review -> Submitted, with inline validation.
   ================================================================== */
(function () {
    'use strict';

    var $ = function (id) { return document.getElementById(id); };

    var viewForm = $('viewForm');
    var viewReview = $('viewReview');
    var viewSuccess = $('viewSuccess');
    if (!viewForm) return;

    var form = $('reportForm');
    var errorSummary = $('errorSummary');
    var errorList = $('errorList');
    var reviewBlocks = $('reviewBlocks');

    var META = { classifications: [], semesters: [], academic_years: [] };
    var MAX_CREDITS = 200;
    var MAX_GPA = 4.0;

    /* ----------------------------------------------------------------
       Validation (mirrors the server rules in src/validate.js)
       ---------------------------------------------------------------- */
    function clean(value) {
        return String(value === null || value === undefined ? '' : value).replace(/[\u0000-\u001F\u007F]/g, '').trim();
    }

    function toNum(value) {
        var v = clean(value).replace(/,/g, '');
        if (v === '') return null;
        var n = Number(v);
        return Number.isFinite(n) ? n : null;
    }

    function collect() {
        return {
            student_id: clean($('student_id').value).replace(/\s+/g, ''),
            last_name: clean($('last_name').value),
            first_name: clean($('first_name').value),
            major: clean($('major').value),
            classification: clean($('classification').value),
            academic_year: clean($('academic_year').value),
            semester: clean($('semester').value),
            attempted_credit_hours: toNum($('attempted_credit_hours').value),
            passed_credit_hours: toNum($('passed_credit_hours').value),
            semester_gpa: toNum($('semester_gpa').value),
            career_gpa: toNum($('career_gpa').value),
        };
    }

    function killTrailingZeros(n) {
        if (typeof n !== 'number' || !Number.isFinite(n)) return '';
        return n.toFixed(2).replace(/\.?0+$/, '');
    }

    function validate(data) {
        var errors = {};

        if (data.student_id === '') {
            errors.student_id = 'Student ID is required.';
        } else if (!window.PS.isValidStudentId(data.student_id)) {
            errors.student_id = 'Enter a valid student ID (letters and numbers only).';
        }

        if (data.last_name === '') errors.last_name = 'Last name is required.';
        if (data.first_name === '') errors.first_name = 'First name is required.';
        if (data.major === '') errors.major = 'Major is required.';
        if (data.classification === '') errors.classification = 'Classification is required.';

        if (data.academic_year === '') errors.academic_year = 'Please select an academic year.';
        if (data.semester === '') errors.semester = 'Please select a semester.';

        if (data.attempted_credit_hours === null) {
            errors.attempted_credit_hours = 'Attempted credit hours are required.';
        } else if (data.attempted_credit_hours < 0) {
            errors.attempted_credit_hours = 'Attempted credit hours cannot be negative.';
        } else if (data.attempted_credit_hours > MAX_CREDITS) {
            errors.attempted_credit_hours = 'Attempted credit hours must be ' + MAX_CREDITS + ' or fewer.';
        }

        var attemptedOk = data.attempted_credit_hours !== null &&
            data.attempted_credit_hours >= 0 && data.attempted_credit_hours <= MAX_CREDITS;

        if (data.passed_credit_hours === null) {
            errors.passed_credit_hours = 'Passed credit hours are required.';
        } else if (data.passed_credit_hours < 0) {
            errors.passed_credit_hours = 'Passed credit hours cannot be negative.';
        } else if (attemptedOk && data.passed_credit_hours > data.attempted_credit_hours) {
            errors.passed_credit_hours = 'Passed credit hours cannot exceed attempted credit hours.';
        } else if (data.passed_credit_hours > MAX_CREDITS) {
            errors.passed_credit_hours = 'Passed credit hours must be ' + MAX_CREDITS + ' or fewer.';
        }

        if (data.semester_gpa === null) {
            errors.semester_gpa = 'Semester GPA is required.';
        } else if (data.semester_gpa < 0 || data.semester_gpa > MAX_GPA) {
            errors.semester_gpa = 'Please enter a GPA between 0.00 and 4.00.';
        }

        if (data.career_gpa === null) {
            errors.career_gpa = 'Career GPA is required.';
        } else if (data.career_gpa < 0 || data.career_gpa > MAX_GPA) {
            errors.career_gpa = 'Please enter a GPA between 0.00 and 4.00.';
        }

        return errors;
    }

    /* ----------------------------------------------------------------
       Error rendering
       ---------------------------------------------------------------- */
    function applyErrors(errors) {
        var keys = ['student_id', 'last_name', 'first_name', 'major', 'classification',
            'academic_year', 'semester', 'attempted_credit_hours', 'passed_credit_hours',
            'semester_gpa', 'career_gpa'];
        keys.forEach(function (key) {
            var box = $(key + '_err');
            var wrap = document.querySelector('.field[data-field="' + key + '"]');
            if (box) box.textContent = errors[key] || '';
            if (wrap) wrap.classList.toggle('has-error', Boolean(errors[key]));
        });

        var count = Object.keys(errors).length;
        if (count) {
            errorList.innerHTML = '';
            var names = {
                student_id: 'Student ID', last_name: 'Last Name', first_name: 'First Name',
                major: 'Major', classification: 'Classification',
                academic_year: 'Academic Year', semester: 'Semester',
                attempted_credit_hours: 'Attempted Credit Hours',
                passed_credit_hours: 'Passed Credit Hours',
                semester_gpa: 'Semester GPA', career_gpa: 'Career GPA',
            };
            Object.keys(errors).forEach(function (key) {
                var li = document.createElement('li');
                var a = document.createElement('a');
                a.href = '#' + key;
                a.textContent = names[key] + ': ' + errors[key];
                a.addEventListener('click', function (e) {
                    e.preventDefault();
                    var el = $(key);
                    if (el) { el.focus(); el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
                });
                li.appendChild(a);
                errorList.appendChild(li);
            });
            errorSummary.hidden = false;
            errorSummary.focus();
        } else {
            errorSummary.hidden = true;
        }
    }

    function clearErrors() {
        applyErrors({});
    }

    /* ----------------------------------------------------------------
       Section completion ticks
       ---------------------------------------------------------------- */
    function sectionStatus(data) {
        var sec1 = data.student_id && data.last_name && data.first_name &&
            data.major && data.classification;
        var sec2 = data.academic_year && data.semester;
        var sec3 = data.attempted_credit_hours !== null && data.passed_credit_hours !== null &&
            data.semester_gpa !== null && data.career_gpa !== null;
        var checks = document.querySelectorAll('.sec-check[data-check]');
        checks.forEach(function (el) {
            var n = Number(el.getAttribute('data-check'));
            el.classList.toggle('on', n === 1 ? sec1 : n === 2 ? sec2 : sec3);
        });
    }

    /* ----------------------------------------------------------------
       Review screen
       ---------------------------------------------------------------- */
    function fmtCredits(n) {
        return n === null || n === undefined ? '-' : killTrailingZeros(n);
    }
    function fmtGpa(n) {
        return (typeof n === 'number' && Number.isFinite(n)) ? n.toFixed(2) : '-';
    }

    function buildReview(data) {
        var blocks = [
            {
                title: 'Student Information',
                rows: [
                    ['Student ID', data.student_id],
                    ['Name', (data.first_name + ' ' + data.last_name).trim()],
                    ['Major', data.major],
                    ['Classification', data.classification],
                ],
            },
            {
                title: 'Semester Information',
                rows: [
                    ['Academic Year', data.academic_year],
                    ['Semester', data.semester],
                ],
            },
            {
                title: 'Academic Performance',
                rows: [
                    ['Attempted Credit Hours', fmtCredits(data.attempted_credit_hours)],
                    ['Passed Credit Hours', fmtCredits(data.passed_credit_hours)],
                    ['Semester GPA', fmtGpa(data.semester_gpa)],
                    ['Career GPA', fmtGpa(data.career_gpa)],
                ],
            },
        ];

        reviewBlocks.innerHTML = blocks.map(function (block) {
            return '<div class="review-block">' +
                '<h3>' + window.PS.escape(block.title) + '</h3>' +
                '<dl>' + block.rows.map(function (row) {
                    return '<div class="rv-list"><dt>' + window.PS.escape(row[0]) +
                        '</dt><dd>' + window.PS.escape(row[1] === null ? '' : row[1]) + '</dd></div>';
                }).join('') + '</dl></div>';
        }).join('');
    }

    /* ----------------------------------------------------------------
       View switching
       ---------------------------------------------------------------- */
    function showView(view) {
        viewForm.hidden = view !== 'form';
        viewReview.hidden = view !== 'review';
        viewSuccess.hidden = view !== 'success';

        var step = view === 'form' ? 1 : view === 'review' ? 2 : 3;
        document.querySelectorAll('.step').forEach(function (el, i) {
            el.classList.toggle('is-active', i + 1 === step);
            el.classList.toggle('is-done', i + 1 < step);
        });

        if (view !== 'form') {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }
    }

    /* ----------------------------------------------------------------
       Submission
       ---------------------------------------------------------------- */
    function submitReport(data) {
        var btn = $('submitBtn');
        btn.disabled = true;
        btn.classList.add('is-loading');
        btn.setAttribute('aria-busy', 'true');

        window.PS.ensureCsrf()
            .then(function () {
                return window.PS.api('/api/reports', {
                    method: 'POST',
                    body: {
                        student_id: data.student_id,
                        last_name: data.last_name,
                        first_name: data.first_name,
                        major: data.major,
                        classification: data.classification,
                        academic_year: data.academic_year,
                        semester: data.semester,
                        attempted_credit_hours: data.attempted_credit_hours,
                        passed_credit_hours: data.passed_credit_hours,
                        semester_gpa: data.semester_gpa,
                        career_gpa: data.career_gpa,
                    },
                });
            })
            .then(function (res) {
                renderSuccess(res);
                showView('success');
            })
            .catch(function (err) {
                btn.disabled = false;
                btn.classList.remove('is-loading');

                if (err.status === 409) {
                    window.PS.toast('error', err.data.error || 'This report has already been submitted.');
                    showView('form');
                    return;
                }
                if (err.data && err.data.errors) {
                    applyErrors(err.data.errors);
                    window.PS.toast('error', 'Please correct the highlighted fields below.');
                    showView('form');
                    return;
                }
                window.PS.toast('error', err.message || 'Unable to submit your report. Please try again.');
                showView('form');
            });
    }

    function renderSuccess(res) {
        var s = res.summary || {};
        $('confReference').textContent = s.reference || res.reference || '';
        $('confStudentId').textContent = s.student_id || '';
        $('confStudentName').textContent = s.student_name || '';
        $('confSemester').textContent = s.semester || '';
        $('confYear').textContent = s.academic_year || '';

        var when = res.submitted_at ? new Date(String(res.submitted_at).replace(' ', 'T')) : null;
        if (when && !isNaN(when)) {
            $('confDate').textContent = when.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
            $('confTime').textContent = when.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
        } else {
            $('confDate').textContent = '';
            $('confTime').textContent = '';
        }
    }

    function resetForm() {
        form.reset();
        clearErrors();
        sectionStatus(collect());
    }

    /* ----------------------------------------------------------------
       Wire-up
       ---------------------------------------------------------------- */
    function loadMeta() {
        return window.PS.api('/api/meta').then(function (m) {
            META = m;
            var classSel = $('classification');
            var semSel = $('semester');
            var yearSel = $('academic_year');

            (m.classifications || []).forEach(function (c) {
                var opt = document.createElement('option');
                opt.value = c; opt.textContent = c;
                classSel.appendChild(opt);
            });
            (m.semesters || []).forEach(function (s) {
                var opt = document.createElement('option');
                opt.value = s; opt.textContent = s;
                semSel.appendChild(opt);
            });
            (m.academic_years || []).forEach(function (y) {
                var opt = document.createElement('option');
                opt.value = y; opt.textContent = y;
                yearSel.appendChild(opt);
            });
        });
    }

    form.addEventListener('submit', function (e) {
        e.preventDefault();
        var data = collect();
        var errors = validate(data);
        applyErrors(errors);
        sectionStatus(data);

        if (Object.keys(errors).length) {
            window.PS.toast('error', 'Please correct the highlighted fields below.');
            return;
        }

        buildReview(data);
        showView('review');
    });

    $('editBtn').addEventListener('click', function () {
        showView('form');
        $('reportForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    $('submitBtn').addEventListener('click', function () {
        var data = collect();
        var errors = validate(data);
        if (Object.keys(errors).length) {
            applyErrors(errors);
            showView('form');
            return;
        }
        submitReport(data);
    });

    $('againBtn').addEventListener('click', function () {
        resetForm();
        showView('form');
    });

    ['student_id', 'last_name', 'first_name', 'major', 'classification',
        'academic_year', 'semester', 'attempted_credit_hours', 'passed_credit_hours',
        'semester_gpa', 'career_gpa'].forEach(function (key) {
        var el = $(key);
        if (el) {
            el.addEventListener('input', function () {
                var d = collect();
                clearErrors();
                sectionStatus(d);
            });
        }
    });

    document.getElementById('footYear').textContent = new Date().getFullYear();

    loadMeta().catch(function () {
        // The page still works when meta fails only if lists were static
        // (they are not); show a message telling the user to retry.
        window.PS.toast('error', 'Unable to load the form options. Please refresh the page.');
    });
})();