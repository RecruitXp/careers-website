'use strict';

(function () {

  // ── 1. Apply brand colours from config ─────────────────────────────────── //
  const R = document.documentElement.style;
  R.setProperty('--color-primary',        CONFIG.colors.primary);
  R.setProperty('--color-primary-dark',   CONFIG.colors.primaryDark);
  R.setProperty('--color-secondary',      CONFIG.colors.secondary);
  R.setProperty('--color-secondary-dark', CONFIG.colors.secondaryDark);

  // ── 2. Logo ────────────────────────────────────────────────────────────── //
  // Website and e-mail links and the footer are rendered into the HTML by server.js so crawlers
  // see them; only the logo is built here.
  const logoEl = document.getElementById('company-logo');
  if (CONFIG.company.logo) {
    logoEl.innerHTML = '<img src="' + CONFIG.company.logo + '" alt="' + (CONFIG.company.logoAlt || CONFIG.company.name) + '" class="h-8 w-auto">';
  } else {
    logoEl.innerHTML = '<span class="text-xl font-bold accent-text">' + CONFIG.company.name + '</span>';
  }

  function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  // ── 3. Helpers ─────────────────────────────────────────────────────────── //
  function mdToHtml(md) {
    if (!md) return '';
    function esc(s) {
      return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
    function inline(s) {
      return esc(s)
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/\*([^*\n]+)\*/g,   '<em>$1</em>')
        .replace(/_([^_\n]+)_/g,     '<em>$1</em>')
        .replace(/`([^`]+)`/g,       '<code>$1</code>')
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    }
    const lines = md.split('\n');
    let html = '', inList = false;
    for (const line of lines) {
      if (/^### /.test(line)) {
        if (inList) { html += '</ul>'; inList = false; }
        html += '<h3>' + inline(line.slice(4).trim()) + '</h3>';
      } else if (/^## /.test(line)) {
        if (inList) { html += '</ul>'; inList = false; }
        html += '<h2>' + inline(line.slice(3).trim()) + '</h2>';
      } else if (/^# /.test(line)) {
        if (inList) { html += '</ul>'; inList = false; }
        html += '<h1>' + inline(line.slice(2).trim()) + '</h1>';
      } else if (/^- /.test(line)) {
        if (!inList) { html += '<ul>'; inList = true; }
        html += '<li>' + inline(line.slice(2)) + '</li>';
      } else if (line.trim() === '') {
        if (inList) { html += '</ul>'; inList = false; }
      } else {
        if (inList) { html += '</ul>'; inList = false; }
        html += '<p>' + inline(line) + '</p>';
      }
    }
    if (inList) html += '</ul>';
    return html;
  }

  // The job arrives as the domain shape from job-service's published-jobs endpoint (PascalCase
  // keys, the stored values) — not as schema.org. The JobPosting JSON-LD is built server-side and
  // is already in this page's <head> by the time this script runs; see server.js.
  function fmtType(t) {
    return ({ 'full-time': 'Full-time', 'part-time': 'Part-time', contract: 'Contract', temporary: 'Temporary', internship: 'Internship' })[(t || '').toLowerCase()] || t || '';
  }
  function fmtMode(m) {
    return ({ remote: 'Remote', hybrid: 'Hybrid', onsite: 'On-site', 'on-site': 'On-site' })[(m || '').toLowerCase()] || m || '';
  }
  function fmtXp(e) {
    return ({ entry: 'Entry-level', mid: 'Mid-level', senior: 'Senior', executive: 'Executive' })[(e || '').toLowerCase()] || e || '';
  }
  function fmtSalary(job) {
    const cur = job.SalaryCurrency || '';
    const k = function(n) { return n >= 1000 ? Math.round(n / 1000) + 'k' : n; };
    if (job.SalaryMin != null && job.SalaryMax != null) return cur + ' ' + k(job.SalaryMin) + '–' + k(job.SalaryMax) + '/yr';
    if (job.SalaryMin != null) return cur + ' ' + k(job.SalaryMin) + '/yr';
    if (job.SalaryMax != null) return cur + ' ' + k(job.SalaryMax) + '/yr';
    return null;
  }
  function modeColorClass(mode) {
    return { Remote: 'bg-green-50 text-green-700', Hybrid: 'bg-blue-50 text-blue-700', 'On-site': 'bg-orange-50 text-orange-700' }[mode] || 'bg-white/20 text-white';
  }
  function loc(job) {
    return job.Location || '';
  }

  // ── 4. State ────────────────────────────────────────────────────────────── //
  var currentJob   = null;
  var parsedSkills = [];

  // ── 5. Render job detail ─────────────────────────────────────────────────── //
  function renderJob(job) {
    document.title = job.Title + ' — ' + CONFIG.company.name;

    var metaDesc = document.querySelector('meta[name="description"]');
    if (metaDesc) {
      metaDesc.setAttribute('content', job.Title + ' at ' + CONFIG.company.name + (loc(job) ? ' · ' + loc(job) : ''));
    }

    setText('job-title',    job.Title);
    setText('job-location', loc(job));
    document.getElementById('job-location').classList.toggle('hidden', !loc(job));

    var mode   = fmtMode(job.WorkMode);
    var modeEl = document.getElementById('job-mode');
    if (mode) {
      modeEl.textContent = mode;
      modeEl.className   = 'text-sm px-3 py-1 rounded-full font-medium ' + modeColorClass(mode);
    } else {
      modeEl.classList.add('hidden');
    }

    var typeEl = document.getElementById('job-type');
    typeEl.textContent = fmtType(job.EmploymentType);
    typeEl.classList.toggle('hidden', !job.EmploymentType);

    var xpEl = document.getElementById('job-xp');
    xpEl.textContent = fmtXp(job.ExperienceLevel);
    xpEl.classList.toggle('hidden', !job.ExperienceLevel);

    var salary = fmtSalary(job);
    document.getElementById('job-salary').textContent = salary || '';
    document.getElementById('job-salary-wrap').classList.toggle('hidden', !salary);

    document.getElementById('job-description').innerHTML = mdToHtml(job.Description || '');

    var skillsWrap = document.getElementById('job-skills-wrap');
    if (job.Skills && job.Skills.length) {
      document.getElementById('job-skills').innerHTML = job.Skills
        .map(function(s) { return '<span class="text-sm px-3 py-1 rounded-full tag-skill font-medium">' + s + '</span>'; })
        .join('');
      skillsWrap.classList.remove('hidden');
    }

    var beneWrap = document.getElementById('job-benefits-wrap');
    if (job.Benefits && job.Benefits.length) {
      document.getElementById('job-benefits').innerHTML = job.Benefits
        .map(function(b) { return '<span class="text-sm px-3 py-1 rounded-full bg-green-50 text-green-700 font-medium">✓ ' + b + '</span>'; })
        .join('');
      beneWrap.classList.remove('hidden');
    }

    // Pre-fill hidden job ID and title for the apply modal
    document.getElementById('apply-job-id').value = job.Id;
    setText('apply-job-title', job.Title);

    document.getElementById('job-loading').classList.add('hidden');
    document.getElementById('job-content').classList.remove('hidden');
  }

  // ── 6. Take the job from the server-rendered payload ─────────────────────── //
  // No fetch and no slug parsing: server.js resolved the slug, already answered 404 if there was
  // no published job for it, and rendered both the payload and the JobPosting JSON-LD into this
  // page's <head>. window.__JOB__ === null is that 404 page.
  function show404() {
    document.getElementById('job-loading').classList.add('hidden');
    document.getElementById('job-error').classList.remove('hidden');
  }

  if (window.__JOB__) {
    currentJob = window.__JOB__;
    renderJob(currentJob);
  } else {
    show404();
  }

  // ── 7. Apply modal ───────────────────────────────────────────────────────── //
  function openApply() {
    document.getElementById('apply-form').reset();
    // Restore job ID and title after reset
    document.getElementById('apply-job-id').value = currentJob ? currentJob.Id : '';
    setText('apply-job-title', currentJob ? currentJob.Title : '');
    document.getElementById('apply-form').classList.remove('hidden');
    document.getElementById('apply-success').classList.add('hidden');
    document.getElementById('apply-error').classList.add('hidden');
    var btn = document.getElementById('apply-submit');
    btn.disabled    = false;
    btn.textContent = 'Submit Application';
    document.getElementById('f-cv-label-text').textContent = 'Click to upload or drag & drop';
    document.getElementById('f-terms').checked    = false;
    document.getElementById('f-relocate').checked = false;
    parsedSkills = [];
    document.getElementById('f-skills-tags').innerHTML = '';
    document.getElementById('f-skill-input').value = '';
    document.getElementById('f-cv-parsing').classList.add('hidden');
    document.getElementById('apply-modal').classList.add('open');
  }

  function closeApply() {
    document.getElementById('apply-modal').classList.remove('open');
  }

  // ── 8. CV upload → auto-fill ────────────────────────────────────────────── //
  function renderSkillTags() {
    var container = document.getElementById('f-skills-tags');
    container.innerHTML = parsedSkills.map(function(skill) {
      return '<button type="button" title="Remove" onclick="JS.removeSkill(\'' + skill.replace(/'/g, "\\'") + '\')"'
        + ' class="inline-flex items-center gap-1.5 text-xs px-3 py-1 rounded-full font-medium tag-skill hover:opacity-75 transition-opacity">'
        + skill
        + '<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">'
        + '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M6 18L18 6M6 6l12 12"/>'
        + '</svg></button>';
    }).join('');
  }

  document.getElementById('f-cv').addEventListener('change', function () {
    var file = this.files && this.files[0];
    if (!file) return;

    document.getElementById('f-cv-label-text').textContent = file.name;

    var cvParseUrl = CONFIG.apply.cvParseUrl;
    if (!cvParseUrl) return; // dev mode — skip parse

    document.getElementById('f-cv-parsing').classList.remove('hidden');

    var fd = new FormData();
    fd.append('file', file);

    fetch(cvParseUrl, { method: 'POST', body: fd })
      .then(function(res) { return res.json(); })
      .then(function(data) {
        var p = data.parsed || {};
        var fFirst    = document.getElementById('f-first');
        var fLast     = document.getElementById('f-last');
        var fEmail    = document.getElementById('f-email');
        var fPhone    = document.getElementById('f-phone');
        var fPosition = document.getElementById('f-position');
        var fCompany  = document.getElementById('f-company');
        var fCity     = document.getElementById('f-city');
        var fCountry  = document.getElementById('f-country');
        var fYoe      = document.getElementById('f-yoe');
        var fLinkedin = document.getElementById('f-linkedin');
        if (!fFirst.value    && p.FirstName)         fFirst.value    = p.FirstName;
        if (!fLast.value     && p.LastName)          fLast.value     = p.LastName;
        if (!fEmail.value    && p.Email)             fEmail.value    = p.Email;
        if (!fPhone.value    && p.Phone)             fPhone.value    = p.Phone;
        if (!fPosition.value && p.CurrentJobTitle)   fPosition.value = p.CurrentJobTitle;
        if (!fCompany.value  && p.CurrentCompany)    fCompany.value  = p.CurrentCompany;
        if (!fCity.value     && p.City)              fCity.value     = p.City;
        if (!fCountry.value  && p.Country)           fCountry.value  = p.Country;
        if (!fYoe.value      && p.YearsOfExperience) fYoe.value      = p.YearsOfExperience;
        if (!fLinkedin.value && p.LinkedInUrl)       fLinkedin.value = p.LinkedInUrl;
        if (p.Skills && p.Skills.length) {
          parsedSkills = p.Skills.slice();
          renderSkillTags();
        }
      })
      .catch(function() { /* silent — user fills manually */ })
      .finally(function() {
        document.getElementById('f-cv-parsing').classList.add('hidden');
      });
  });

  // ── 9. Form submit ──────────────────────────────────────────────────────── //
  document.getElementById('apply-form').addEventListener('submit', function(e) {
    e.preventDefault();
    var btn = document.getElementById('apply-submit');
    btn.disabled    = true;
    btn.textContent = 'Sending…';
    document.getElementById('apply-error').classList.add('hidden');

    var jobId     = document.getElementById('apply-job-id').value;
    var firstName = document.getElementById('f-first').value.trim();
    var lastName  = document.getElementById('f-last').value.trim();
    var email     = document.getElementById('f-email').value.trim();
    var phone     = document.getElementById('f-phone').value.trim();
    var position  = document.getElementById('f-position').value.trim();
    var company   = document.getElementById('f-company').value.trim();
    var city      = document.getElementById('f-city').value.trim();
    var country   = document.getElementById('f-country').value.trim();
    var yoe       = document.getElementById('f-yoe').value.trim();
    var linkedin  = document.getElementById('f-linkedin').value.trim();
    var remotePreference  = '';
    var willingToRelocate = document.getElementById('f-relocate').checked;
    var cvFile    = document.getElementById('f-cv').files && document.getElementById('f-cv').files[0];
    var termsChecked = document.getElementById('f-terms').checked;

    if (!termsChecked) {
      btn.disabled    = false;
      btn.textContent = 'Submit Application';
      showError('Please accept the Terms & Conditions to continue.');
      return;
    }
    if (!phone) {
      btn.disabled    = false;
      btn.textContent = 'Submit Application';
      showError('Please enter your phone number.');
      return;
    }
    var emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      btn.disabled    = false;
      btn.textContent = 'Submit Application';
      showError('Please enter a valid email address.');
      return;
    }

    function showSuccess() {
      document.getElementById('apply-form').classList.add('hidden');
      document.getElementById('apply-success').classList.remove('hidden');
    }
    function showError(msg) {
      btn.disabled    = false;
      btn.textContent = 'Submit Application';
      var el = document.getElementById('apply-error');
      el.textContent = msg || 'Something went wrong. Please try again or contact us directly.';
      el.classList.remove('hidden');
    }

    var urls = CONFIG.apply;

    if (!urls.applicantsUrl || !urls.applicationsUrl) {
      // Demo mode — simulate success without hitting the DB
      setTimeout(showSuccess, 700);
      return;
    }

    // Step 1 — create applicant (with CV file if provided, else JSON)
    var applicantPromise;
    if (cvFile) {
      var fd = new FormData();
      fd.append('file', cvFile);
      fd.append('FirstName', firstName);
      fd.append('LastName', lastName);
      fd.append('Email', email);
      if (phone)    fd.append('Phone',             phone);
      if (position) fd.append('CurrentJobTitle',   position);
      if (company)  fd.append('CurrentCompany',    company);
      if (city)     fd.append('City',              city);
      if (country)  fd.append('Country',           country);
      if (yoe)      fd.append('YearsOfExperience', yoe);
      if (linkedin) fd.append('LinkedInUrl',       linkedin);
      if (remotePreference)  fd.append('Tags',              remotePreference);
      if (willingToRelocate) fd.append('WillingToRelocate', 'true');
      if (parsedSkills.length) fd.append('Skills', JSON.stringify(parsedSkills));
      fd.append('GdprConsentGiven', 'true');

      applicantPromise = fetch(urls.applicantsUrl + '/import-cv', {
        method: 'POST',
        body:   fd,
      })
        .then(function(res) {
          if (!res.ok) return res.json().then(function(d) { throw new Error('applicant ' + res.status + ': ' + (d.error || JSON.stringify(d))); });
          return res.json();
        })
        .then(function(data) {
          var id = data.applicant && data.applicant.Id;
          if (!id) throw new Error('no applicant Id returned from import-cv: ' + JSON.stringify(data));
          return id;
        });
    } else {
      var applicantPayload = {
        FirstName: firstName,
        LastName:  lastName,
        Email:     email,
        GdprConsentGiven: true,
        GdprConsentDate:  new Date().toISOString(),
      };
      if (phone)                applicantPayload.Phone             = phone;
      if (position)             applicantPayload.CurrentJobTitle   = position;
      if (company)              applicantPayload.CurrentCompany    = company;
      if (city)                 applicantPayload.City              = city;
      if (country)              applicantPayload.Country           = country;
      if (yoe)                  applicantPayload.YearsOfExperience = parseInt(yoe, 10);
      if (linkedin)             applicantPayload.LinkedInUrl       = linkedin;
      if (remotePreference)     applicantPayload.Tags              = remotePreference;
      if (willingToRelocate)    applicantPayload.WillingToRelocate = true;
      if (parsedSkills.length)  applicantPayload.Skills            = parsedSkills.slice();

      applicantPromise = fetch(urls.applicantsUrl, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(applicantPayload),
      })
        .then(function(res) {
          if (!res.ok) return res.json().then(function(d) { throw new Error('applicant ' + res.status + ': ' + (d.error || JSON.stringify(d))); });
          return res.json();
        })
        .then(function(data) {
          var id = data.Id;
          if (!id) throw new Error('no applicant Id returned: ' + JSON.stringify(data));
          return id;
        });
    }

    applicantPromise
      .then(function(applicantId) {
        // Step 2 — create application
        return fetch(urls.applicationsUrl, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ JobId: jobId, ApplicantId: applicantId }),
        });
      })
      .then(function(res) {
        if (!res.ok) return res.json().then(function(d) { throw new Error('application ' + res.status + ': ' + (d.error || JSON.stringify(d))); });
        showSuccess();
      })
      .catch(function(err) {
        console.error('[apply]', err);
        showError(err.message);
      });
  });

  // ── 10. Event listeners ──────────────────────────────────────────────────── //
  document.getElementById('apply-modal').addEventListener('click', function(e) {
    if (e.target === this) closeApply();
  });
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') closeApply();
  });

  function removeSkill(skill) {
    parsedSkills = parsedSkills.filter(function(s) { return s !== skill; });
    renderSkillTags();
  }
  function addSkill() {
    var input = document.getElementById('f-skill-input');
    var val = input.value.trim();
    if (!val) return;
    // support comma-separated entry
    val.split(',').forEach(function(s) {
      s = s.trim();
      if (s && !parsedSkills.includes(s)) parsedSkills.push(s);
    });
    input.value = '';
    renderSkillTags();
  }
  document.getElementById('f-skill-input').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') { e.preventDefault(); addSkill(); }
  });

  window.JS = { openApply: openApply, closeApply: closeApply, removeSkill: removeSkill, addSkill: addSkill };

})();
