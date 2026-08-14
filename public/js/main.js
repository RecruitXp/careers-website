'use strict';

(function () {

  // ── 1. Apply brand colours from config ─────────────────────────────────── //
  const R = document.documentElement.style;
  R.setProperty('--color-primary',        CONFIG.colors.primary);
  R.setProperty('--color-primary-dark',   CONFIG.colors.primaryDark);
  R.setProperty('--color-secondary',      CONFIG.colors.secondary);
  R.setProperty('--color-secondary-dark', CONFIG.colors.secondaryDark);

  // ── 2. Populate company info ───────────────────────────────────────────── //
  document.title = 'Careers — ' + CONFIG.company.name;

  // Logo
  const logoEl = document.getElementById('company-logo');
  if (CONFIG.company.logo) {
    logoEl.innerHTML = '<img src="' + CONFIG.company.logo + '" alt="' + (CONFIG.company.logoAlt || CONFIG.company.name) + '" class="h-8 w-auto">';
  } else {
    logoEl.innerHTML = '<span class="text-xl font-bold accent-text">' + CONFIG.company.name + '</span>';
  }

  const siteLink = document.getElementById('company-site');
  siteLink.href        = CONFIG.company.website || '#';

  setText('hero-title',       'Work with us at ' + CONFIG.company.name);
  setText('hero-tagline',     CONFIG.company.tagline    || '');
  setText('hero-description', CONFIG.company.description || '');
  setText('footer-name',      CONFIG.company.name);
  setText('footer-year',      String(new Date().getFullYear()));

  const emailEl = document.getElementById('footer-email');
  emailEl.href        = 'mailto:' + CONFIG.company.email;
  emailEl.textContent = CONFIG.company.email;

  function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  // ── 3. State ───────────────────────────────────────────────────────────── //
  let allJobs      = [];
  let filteredJobs = [];
  let filterMode   = 'all';
  let searchQuery  = '';

  // ── 4. Markdown → safe HTML ────────────────────────────────────────────── //
  function mdToHtml(md) {
    if (!md) return '';

    // Escape HTML, then apply inline markdown patterns
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

  // ── 5. Formatters ──────────────────────────────────────────────────────── //
  // Jobs arrive as the domain shape from job-service's published-jobs endpoint (PascalCase keys,
  // the values stored in the database) — not as schema.org. The schema.org mapping now happens
  // once, on the server, where the JSON-LD is built (see server.js's buildJobPostingLd).
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
    const k   = function(n) { return n >= 1000 ? Math.round(n / 1000) + 'k' : n; };
    if (job.SalaryMin != null && job.SalaryMax != null) return cur + ' ' + k(job.SalaryMin) + '–' + k(job.SalaryMax) + '/yr';
    if (job.SalaryMin != null) return cur + ' ' + k(job.SalaryMin) + '/yr';
    if (job.SalaryMax != null) return cur + ' ' + k(job.SalaryMax) + '/yr';
    return null;
  }
  function timeAgo(ds) {
    if (!ds) return '';
    const d = Math.floor((Date.now() - new Date(ds)) / 86400000);
    if (d === 0) return 'Today';
    if (d === 1) return 'Yesterday';
    if (d < 7)   return d + 'd ago';
    if (d < 30)  return Math.floor(d / 7)  + 'w ago';
    if (d < 365) return Math.floor(d / 30) + 'mo ago';
    return Math.floor(d / 365) + 'y ago';
  }
  function modeColorClass(mode) {
    return { Remote: 'bg-green-50 text-green-700', Hybrid: 'bg-blue-50 text-blue-700', 'On-site': 'bg-orange-50 text-orange-700' }[mode] || 'bg-gray-100 text-gray-600';
  }
  function loc(job) {
    return job.Location || '';
  }

  // ── 6. Job card HTML ───────────────────────────────────────────────────── //
  function jobCard(job) {
    const slug   = job.Slug;
    const mode   = fmtMode(job.WorkMode);
    const type   = fmtType(job.EmploymentType);
    const xp     = fmtXp(job.ExperienceLevel);
    const salary = fmtSalary(job);
    const skills = (job.Skills || []).slice(0, 4);
    const extra  = Math.max(0, (job.Skills || []).length - 4);
    const posted = timeAgo(job.PublishedAt);
    const location = loc(job);

    var badges = '';
    if (mode)   badges += '<span class="text-xs px-2.5 py-1 rounded-full font-medium ' + modeColorClass(mode) + '">' + mode + '</span>';
    if (type)   badges += '<span class="text-xs px-2.5 py-1 rounded-full font-medium bg-gray-100 text-gray-600">' + type + '</span>';
    if (xp)     badges += '<span class="text-xs px-2.5 py-1 rounded-full font-medium bg-gray-100 text-gray-600">' + xp + '</span>';
    if (salary) badges += '<span class="text-xs px-2.5 py-1 rounded-full font-medium" style="background:color-mix(in srgb,var(--color-secondary) 12%,#fff);color:var(--color-secondary-dark)">' + salary + '</span>';

    var skillsHtml = '';
    if (skills.length) {
      skillsHtml = '<div class="flex flex-wrap gap-1.5">'
        + skills.map(function(s) { return '<span class="text-xs px-2 py-0.5 rounded-md tag-skill font-medium">' + s + '</span>'; }).join('')
        + (extra ? '<span class="text-xs px-2 py-0.5 rounded-md bg-gray-100 text-gray-500">+' + extra + '</span>' : '')
        + '</div>';
    }

    return '<a href="/jobs/' + slug + '" class="group bg-white rounded-xl border border-gray-100 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 p-6 flex flex-col gap-4 no-underline text-current block">'
      + '<div class="flex items-start justify-between gap-3">'
        + '<div class="min-w-0">'
          + '<h3 class="font-semibold text-gray-900 text-base leading-snug">' + job.Title + '</h3>'
          + (location ? '<p class="text-sm text-gray-500 mt-0.5">' + location + '</p>' : '')
        + '</div>'
        + '<span class="text-xs text-gray-400 whitespace-nowrap shrink-0 mt-0.5">' + posted + '</span>'
      + '</div>'
      + (badges ? '<div class="flex flex-wrap gap-1.5">' + badges + '</div>' : '')
      + skillsHtml
      + '<div class="mt-auto pt-3 border-t border-gray-50 flex items-center justify-end">'
        + '<span class="text-sm font-semibold accent-text flex items-center gap-1">View &amp; Apply'
          + '<svg class="w-4 h-4 group-hover:translate-x-0.5 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/></svg>'
        + '</span>'
      + '</div>'
    + '</a>';
  }

  // ── 7. Render grid ─────────────────────────────────────────────────────── //
  function render() {
    var grid  = document.getElementById('jobs-grid');
    var count = document.getElementById('job-count');
    var empty = document.getElementById('jobs-empty');

    setText('hero-count', allJobs.length + ' open position' + (allJobs.length !== 1 ? 's' : ''));
    count.textContent = filteredJobs.length
      ? filteredJobs.length + ' position' + (filteredJobs.length !== 1 ? 's' : '') + ' found'
      : '';

    if (!filteredJobs.length && allJobs.length) {
      grid.innerHTML = '';
      empty.classList.remove('hidden');
    } else {
      empty.classList.add('hidden');
      grid.innerHTML = filteredJobs.map(jobCard).join('');
    }
  }

  // ── 8. Filter ──────────────────────────────────────────────────────────── //
  function applyFilters() {
    var q = searchQuery.toLowerCase();
    filteredJobs = allJobs.filter(function(job) {
      var matchQ = !q
        || job.Title.toLowerCase().includes(q)
        || (job.Skills || []).some(function(s) { return s.toLowerCase().includes(q); })
        || (job.Description || '').toLowerCase().includes(q);
      var jobMode = (job.WorkMode || '').toLowerCase();
      var matchM  = filterMode === 'all'
        || jobMode === filterMode
        || (filterMode === 'onsite' && (jobMode === 'onsite' || jobMode === 'on-site'));
      return matchQ && matchM;
    });
    render();
  }

  // ── 9. Load jobs ───────────────────────────────────────────────────────── //
  // No fetch: server.js renders the published job list into the page as window.__JOBS__. The jobs
  // API requires an API key, which this server holds and the browser must never see — and having
  // the data before first paint is what puts the job content in the served HTML where crawlers can
  // read it.
  function loadJobs() {
    var jobs = window.__JOBS__;

    if (!Array.isArray(jobs)) {
      // Only reachable if the page was served without the server-rendered head (a stale cached
      // HTML, or job.html opened straight off disk).
      document.getElementById('jobs-grid').innerHTML =
        '<div class="col-span-full flex flex-col items-center py-20 text-gray-400 gap-3">'
        + '<svg class="w-12 h-12 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>'
        + '<p class="font-medium text-gray-500">Unable to load open positions.</p>'
        + '<p class="text-sm">Please try refreshing the page.</p>'
        + '</div>';
      return;
    }

    allJobs      = jobs;
    filteredJobs = allJobs.slice();
    render();
  }

  // ── 10. Event listeners ──────────────────────────────────────────────────── //
  document.getElementById('search-input').addEventListener('input', function() {
    searchQuery = this.value;
    applyFilters();
  });

  document.querySelectorAll('.filter-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      document.querySelectorAll('.filter-btn').forEach(function(b) { b.classList.remove('active'); });
      this.classList.add('active');
      filterMode = this.dataset.mode;
      applyFilters();
    });
  });

  // ── 11. Init ──────────────────────────────────────────────────────────────── //
  loadJobs();

})();
