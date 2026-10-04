'use strict';

const express = require('express');
const fs      = require('fs');
const path    = require('path');
const https   = require('https');
const http    = require('http');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── API key ───────────────────────────────────────────────────────────────── //
// Authenticates every call to job-service/applicant-service as this careers site's tenant (plan
// §7 of platform-job-pages-plan.md). Mandatory, with no default: a wrong guess here puts another
// company's job ads on this company's careers page, so refusing to start is the mild failure. The
// tenant comes from the key itself now, never from a header — issue one from the ATS admin's
// Settings page (POST /api/tenant-settings/api-key) and set it here.
const API_KEY = process.env.API_KEY;
if (!API_KEY) {
  console.error(
    '[careers-website] FATAL: API_KEY is required and has no default. Issue one from the ATS ' +
    'admin\'s Settings page and set it here.',
  );
  process.exit(1);
}

// ── Env vars ──────────────────────────────────────────────────────────────── //
const cfg = {
  baseUrl:         process.env.BASE_URL         || '',
  // job-service's authenticated published-jobs endpoint. No tenant in this value — the tenant
  // travels as the API key itself (see API_KEY below), so the jobs this site shows and the
  // applications it submits can't end up scoped to different tenants.
  jobsApiUrl:      process.env.JOBS_API_URL     || '',
  companyName:     process.env.COMPANY_NAME     || '',
  companyTagline:  process.env.COMPANY_TAGLINE  || '',
  companyDesc:     process.env.COMPANY_DESCRIPTION || '',
  companyWebsite:  process.env.COMPANY_WEBSITE  || '',
  companyEmail:    process.env.COMPANY_EMAIL    || '',
  // ISO-3166 country for the structured data's postal address. Google for Jobs requires it on a
  // non-remote JobPosting, and it belongs to whoever owns this careers site — so it's a
  // deployment value with no code-level default. Unset means the field is omitted, never guessed:
  // "PT" baked into the source was correct for exactly one tenant.
  companyCountry:  process.env.COMPANY_COUNTRY  || '',
  // Real upstream targets — server-side only now (see proxy routes below). The browser never
  // sees these; it gets the /api/proxy/* paths from /config.js instead, so applicant-service/
  // job-service can require a valid API key on every route without breaking the public apply flow.
  applicantsUrl:   process.env.APPLICANTS_URL   || '',
  cvParseUrl:      process.env.CV_PARSE_URL     || '',
  applicationsUrl: process.env.APPLICATIONS_URL || '',
};

// ── Backend calls — see docs/implementation-plans/platform-job-pages-plan.md §7 ─────────────── //
// careers-website is a public, unauthenticated site — candidates never log in. Every call to
// applicant-service/job-service carries this site's own API key instead, so those services can
// resolve the tenant and enforce it on every route without breaking the public application flow.

// Streams the incoming request straight through to `targetUrl` (works for both JSON and
// multipart/form-data bodies — no body-parser is mounted anywhere in this app, so `req` is still
// an unconsumed stream here), attaching the API key. Streams the upstream response straight back,
// unmodified.
function proxyToBackend(targetUrl) {
  return (req, res) => {
    try {
      const url = new URL(targetUrl);
      const client = url.protocol === 'https:' ? https : http;

      const headers = { 'X-Api-Key': API_KEY };
      if (req.headers['content-type']) headers['Content-Type'] = req.headers['content-type'];
      if (req.headers['content-length']) headers['Content-Length'] = req.headers['content-length'];

      const upstreamReq = client.request(url, { method: req.method, headers }, (upstreamRes) => {
        res.writeHead(upstreamRes.statusCode, upstreamRes.headers);
        upstreamRes.pipe(res);
      });
      upstreamReq.on('error', (err) => {
        console.error('[proxy] upstream request failed:', err.message);
        if (!res.headersSent) res.status(502).json({ error: 'Upstream request failed' });
      });
      req.pipe(upstreamReq);
    } catch (err) {
      console.error('[proxy] failed:', err.message);
      if (!res.headersSent) res.status(502).json({ error: 'Proxy failed', message: err.message });
    }
  };
}

// ── Published jobs — fetched server-side, with the API key attached ───────── //
// The jobs API requires the key, so this fetch can only happen here: credentials must never
// reach client JS. That's not a cost — job data now arrives before the HTML is sent, so the
// structured data below is in the served markup instead of being injected by JavaScript after
// load, which is strictly more reliable for crawlers.
//
// TTL is 60s: a crawler burst over a job page and the sitemap collapses into one upstream call,
// while a publish or unpublish becomes visible within a minute.
//
// A stale entry is never a reason to make the visitor wait for job-service. The refresh starts at
// once, and the response waits for it only up to the deadline below, then goes out with the stale
// copy while the refresh finishes in the background. This site is idle most of the time, so nearly
// every request used to land on a cold entry and pay the whole upstream round trip (a crawler
// measured 3.5 s); now only the first request after start can, and startup prefetches the listing.
// A timer would keep the entry warm too, but a permanent background process for a site that
// receives a few requests a day is the wrong trade.
//
// The deadline sits under Google's 0.8 s "good" first-byte threshold with room for the network.
// The ceiling bounds how old a served copy may be, so a job unpublished long ago cannot resurface
// after a quiet spell: beyond it the entry counts as absent and the request waits. It is also how
// long a copy may be served while job-service is unreachable - old jobs beat blanking the careers
// site and the sitemap, which is what Google would re-crawl.
const JOBS_TTL_MS              = 60 * 1000;
const JOBS_REFRESH_DEADLINE_MS = 600;
const JOBS_STALE_MAX_MS        = 24 * 60 * 60 * 1000;

function fetchFromJobsApi(url) {
  return requestJson(url, {
    'X-Api-Key': API_KEY,
    Accept: 'application/json',
  });
}

// Fire-and-forget view count (plan §1.1). Never awaited on the render path; a failure is logged
// and dropped so it cannot affect the candidate's page load. Mirrors apps/job-pages/server.js's
// reportView, with the API key in place of the M2M bearer token.
function reportView(jobId) {
  if (!cfg.jobsApiUrl) return; // no backend configured — demo/dev mode, nothing to report to
  const url = new URL(`${cfg.jobsApiUrl}/by-id/${encodeURIComponent(jobId)}/view`);
  const client = url.protocol === 'https:' ? https : http;
  const req = client.request(url, {
    method: 'POST',
    headers: { 'X-Api-Key': API_KEY },
    timeout: 5000,
  }, (res) => { res.resume(); });
  req.on('error', (e) => console.warn('[view] report failed:', e.message));
  req.on('timeout', () => req.destroy());
  req.end();
}

// A 404 is an answer, not a failure: an unpublished job must stop being served immediately, so it
// evicts the entry rather than reviving the stale one. Everything else that goes wrong upstream
// serves the stale copy, and only rejects when there is nothing to serve.
//
// A factory rather than module state so the behaviour can be tested with a fake clock and a
// scripted upstream; `fetchJson` resolves { status, json } like requestJson below.
const STALE = Symbol('serve the stale copy');

function createJobsCache({ fetchJson, ttlMs, staleMaxMs, refreshDeadlineMs, now = Date.now, log = console }) {
  const entries  = new Map(); // url -> { value, fetchedAt }
  const inflight = new Map(); // url -> Promise, so concurrent stale requests share one upstream call

  function refresh(url) {
    if (inflight.has(url)) return inflight.get(url);
    const pending = fetchJson(url)
      .then(({ status, json }) => {
        if (status === 404) {
          entries.delete(url);
          return null;
        }
        entries.set(url, { value: json, fetchedAt: now() });
        return json;
      })
      .finally(() => inflight.delete(url));
    inflight.set(url, pending);
    return pending;
  }

  async function get(url) {
    const hit = entries.get(url);
    const age = hit ? now() - hit.fetchedAt : Infinity;
    if (age < ttlMs) return hit.value;

    const pending = refresh(url);
    if (age >= staleMaxMs) return pending;

    let timer;
    const deadline = new Promise((resolve) => { timer = setTimeout(resolve, refreshDeadlineMs, STALE); });
    const settled = pending.catch((err) => {
      log.warn(`[jobs] refresh failed, serving cached copy: ${err.message}`);
      return STALE;
    });
    try {
      const result = await Promise.race([settled, deadline]);
      return result === STALE ? hit.value : result;
    } finally {
      clearTimeout(timer);
    }
  }

  return { get };
}

const jobsCache = createJobsCache({
  fetchJson:         fetchFromJobsApi,
  ttlMs:             JOBS_TTL_MS,
  staleMaxMs:        JOBS_STALE_MAX_MS,
  refreshDeadlineMs: JOBS_REFRESH_DEADLINE_MS,
});

function getPublishedJobs() {
  if (!cfg.jobsApiUrl) return Promise.reject(new Error('JOBS_API_URL is not configured'));
  return jobsCache.get(cfg.jobsApiUrl);
}

// A guid resolves by id, anything else by slug. The platform job page redirects here with the
// careers URL template, which for an id-based template (`.../jobs/{jobId}`) sends a guid — and a
// job's id is stable across title edits where its slug is not. Both forms land on the same page.
const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function getPublishedJob(idOrSlug) {
  if (!cfg.jobsApiUrl) return Promise.reject(new Error('JOBS_API_URL is not configured'));
  const pathSuffix = GUID_RE.test(idOrSlug)
    ? `by-id/${encodeURIComponent(idOrSlug)}`
    : encodeURIComponent(idOrSlug);
  return jobsCache.get(`${cfg.jobsApiUrl}/${pathSuffix}`);
}

// ── Structured data — this site's job, this site's URL, this site's company ── //
const SCHEMA_EMPLOYMENT_TYPE = {
  'full-time':  'FULL_TIME',
  'part-time':  'PART_TIME',
  'contract':   'CONTRACTOR',
  'temporary':  'TEMPORARY',
  'internship': 'INTERN',
};

function isoDate(value) {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString().slice(0, 10);
}

function jobUrl(slug) {
  return `${cfg.baseUrl}/jobs/${slug}`;
}

// Built here rather than by job-service, and that is the whole point of this change: `url` and
// `hiringOrganization` are claims about a domain and a company that only the site serving them can
// make. `url` comes from BASE_URL, not the request's Host header — a Host is caller-supplied, and
// this markup is read by Google, so reflecting it would let any caller mint a JobPosting pointing
// wherever they liked on a hostname Google trusts.
function buildJobPostingLd(job) {
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'JobPosting',
    title: job.Title,
    description: job.Description,
    datePosted: isoDate(job.PublishedAt),
    employmentType: SCHEMA_EMPLOYMENT_TYPE[(job.EmploymentType || '').toLowerCase()] || 'FULL_TIME',
    identifier: { '@type': 'PropertyValue', name: job.Slug, value: job.Id },
    hiringOrganization: {
      '@type': 'Organization',
      name: cfg.companyName,
      sameAs: cfg.companyWebsite || undefined,
    },
    jobLocation: {
      '@type': 'Place',
      address: {
        '@type': 'PostalAddress',
        addressLocality: job.Location,
        addressCountry: cfg.companyCountry || undefined,
      },
    },
    url: jobUrl(job.Slug),
  };

  const validThrough = isoDate(job.ApplicationDeadline);
  if (validThrough) ld.validThrough = validThrough;

  if (job.SalaryMin != null || job.SalaryMax != null) {
    ld.baseSalary = {
      '@type': 'MonetaryAmount',
      currency: job.SalaryCurrency,
      value: {
        '@type': 'QuantitativeValue',
        minValue: job.SalaryMin != null ? job.SalaryMin : undefined,
        maxValue: job.SalaryMax != null ? job.SalaryMax : undefined,
        unitText: 'YEAR',
      },
    };
  }

  // The language the posting is written in, straight from the ATS (jobs."Language" is NOT NULL
  // there, so a published job always carries one). Omitted rather than guessed if it is ever
  // absent: every other field here is a fact the employer supplied, and a language guessed on
  // their behalf is a claim to Google nobody made.
  if (job.Language) ld.inLanguage = job.Language;

  if (job.ExperienceLevel) ld.experienceRequirements = job.ExperienceLevel;
  if (job.Skills   && job.Skills.length)   ld.skills      = job.Skills.join(', ');
  if (job.Benefits && job.Benefits.length) ld.jobBenefits = job.Benefits.join(', ');

  // Google for Jobs requires both of these on a remote posting, not just a location.
  if ((job.WorkMode || '').toLowerCase() === 'remote') {
    ld.jobLocationType = 'TELECOMMUTE';
    if (cfg.companyCountry) {
      ld.applicantLocationRequirements = { '@type': 'Country', name: cfg.companyCountry };
    }
  }

  return ld;
}

// The language tag is the only thing interpolated into an attribute here, and it comes from the
// ATS rather than from the request - escaped anyway, because "it can't contain a quote today" is
// exactly the assumption that ages badly.
function escapeAttr(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}

// JSON destined for a <script> element, not for an HTTP body: a `</script>` or `<!--` inside any
// job field would otherwise end the element early and turn job text into markup.
function jsonForScript(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

const HEAD_PLACEHOLDER = '<!--SERVER_HEAD-->';

// Branding placeholders in index.html / job.html, filled from the same env vars /config.js hands
// the browser. Rendered here so the company name, its website link and the contact e-mail are in
// the served HTML: a crawler that runs no scripts used to see an empty <h1> and href="#" links.
const BRANDING_TOKEN_RE = /\{\{(COMPANY_NAME|COMPANY_WEBSITE|COMPANY_EMAIL|COMPANY_TAGLINE|COMPANY_DESCRIPTION|META_DESCRIPTION|YEAR)\}\}/g;

function brandingValues() {
  return {
    COMPANY_NAME:        cfg.companyName,
    // '#' rather than '' when unset: an empty href is a link to the page itself.
    COMPANY_WEBSITE:     cfg.companyWebsite || '#',
    COMPANY_EMAIL:       cfg.companyEmail,
    COMPANY_TAGLINE:     cfg.companyTagline,
    COMPANY_DESCRIPTION: cfg.companyDesc,
    META_DESCRIPTION:    cfg.companyDesc || `Open positions and career opportunities at ${cfg.companyName}.`,
    YEAR:                String(new Date().getFullYear()),
  };
}

function applyBranding(html, values) {
  return html.replace(BRANDING_TOKEN_RE, (_match, key) => escapeAttr(values[key] ?? ''));
}

// job.html / index.html are read per request rather than cached at startup so a container rebuild
// isn't needed to pick up a template edit in dev; they're small and this is not a hot path.
// The templates ship lang="en" so they are valid standalone files; every served response rewrites
// it. `lang` has no "omit it" option the way inLanguage does - screen readers and hyphenation need
// something - so this one falls back to the template's own value rather than staying silent.
const HTML_LANG_RE = /<html lang="[^"]*"/;

function renderPage(file, headHtml, lang) {
  let html = fs.readFileSync(path.join(__dirname, 'public', file), 'utf8');
  if (lang) html = html.replace(HTML_LANG_RE, `<html lang="${escapeAttr(lang)}"`);
  html = applyBranding(html, brandingValues());
  if (!html.includes(HEAD_PLACEHOLDER)) {
    console.warn(`[render] ${file} has no ${HEAD_PLACEHOLDER} — server-rendered head content dropped`);
    return html;
  }
  return html.replace(HEAD_PLACEHOLDER, headHtml);
}

// ── /config.js — built from env vars, never stored on disk ───────────────── //
app.get('/config.js', (_req, res) => {
  const js = `const CONFIG = ${JSON.stringify({
    company: {
      name:        cfg.companyName,
      tagline:     cfg.companyTagline,
      description: cfg.companyDesc,
      logo:        null,
      logoAlt:     'Logo',
      website:     cfg.companyWebsite,
      email:       cfg.companyEmail,
    },
    colors: {
      primary:       '#6366f1',
      primaryDark:   '#4f46e5',
      secondary:     '#06b6d4',
      secondaryDark: '#0891b2',
    },
    // No feed URL here any more. The browser used to be handed a backend URL and fetch the job
    // list itself; job data now arrives server-rendered in the page (window.__JOBS__ /
    // window.__JOB__), because the jobs API requires a key this server must not disclose.
    // Relative proxy paths, not the real upstream URLs — the browser talks to this server,
    // which attaches the API key (see proxy routes below). Empty strings preserve job.js's
    // existing "no URLs configured → dev/demo mode" fallback when the real upstream env vars
    // aren't set.
    apply: {
      applicantsUrl:   cfg.applicantsUrl   ? '/api/proxy/applicants'          : '',
      cvParseUrl:      cfg.cvParseUrl      ? '/api/proxy/applicants/parse-cv' : '',
      applicationsUrl: cfg.applicationsUrl ? '/api/proxy/applications'       : '',
    },
  }, null, 2)};`;
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.send(js);
});

// ── Candidate-facing proxy routes — attach the API key, forward to the real backend ────────── //
// job.js does `urls.applicantsUrl + '/import-cv'`, so the path below must line up with the
// `/api/proxy/applicants` value handed out in /config.js above.
app.post('/api/proxy/applicants', proxyToBackend(cfg.applicantsUrl));
app.post('/api/proxy/applicants/import-cv', proxyToBackend(`${cfg.applicantsUrl}/import-cv`));
app.post('/api/proxy/applicants/parse-cv', proxyToBackend(cfg.cvParseUrl));
app.post('/api/proxy/applications', proxyToBackend(cfg.applicationsUrl));

// ── /robots.txt ───────────────────────────────────────────────────────────── //
app.get('/robots.txt', (_req, res) => {
  const sitemap = cfg.baseUrl ? `\nSitemap: ${cfg.baseUrl}/sitemap.xml` : '';
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.send(`User-agent: *\nAllow: /${sitemap}`);
});

// ── /sitemap.xml — fetched on-demand from the jobs API ────────────────────── //
app.get('/sitemap.xml', async (_req, res) => {
  if (!cfg.baseUrl || !cfg.jobsApiUrl) {
    return res.status(503).send('BASE_URL and JOBS_API_URL are required');
  }

  // Fail loudly. This used to swallow the error and emit a sitemap containing only "/", which
  // reads to a crawler as "this site has no jobs any more" — indistinguishable from a real
  // unpublish, and it would drop every job page from the index over an outage that lasted
  // minutes. A 503 says "ask again later" instead. getPublishedJobs already serves a stale copy
  // for up to JOBS_STALE_GRACE_MS, so reaching this branch means there is genuinely nothing to
  // publish.
  let jobs;
  try {
    jobs = await getPublishedJobs();
  } catch (err) {
    console.error('[sitemap] Failed to fetch published jobs:', err.message);
    return res.status(503).send('Job data is temporarily unavailable');
  }

  const urls = [
    `  <url><loc>${cfg.baseUrl}/</loc><changefreq>daily</changefreq><priority>1.0</priority></url>`,
    ...jobs.map(job =>
      `  <url><loc>${jobUrl(job.Slug)}</loc><changefreq>weekly</changefreq><priority>0.8</priority></url>`
    ),
  ].join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`;

  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.send(xml);
});

// The listing has no single posting to follow, so it takes the language most of the board is
// written in - right for the common case (a board in one language) and a reasonable hint for a
// mixed one, where each job page still declares its own exact language. Empty board -> null, and
// the template's own lang stands.
function dominantLanguage(jobs) {
  const counts = new Map();
  for (const job of jobs) {
    if (!job.Language) continue;
    counts.set(job.Language, (counts.get(job.Language) || 0) + 1);
  }
  let best = null;
  for (const [language, n] of counts) {
    if (!best || n > best[1]) best = [language, n];
  }
  return best && best[0];
}

// ── Listing page — job data rendered into the HTML, not fetched by the browser ── //
async function serveListing(_req, res) {
  let jobs = [];
  try {
    jobs = await getPublishedJobs();
  } catch (err) {
    console.error('[listing] Failed to fetch published jobs:', err.message);
    // Deliberately still a 200 with an empty list: main.js renders its own "unable to load"
    // state, and a 503 on the site's front page over a transient backend blip is worse than a
    // page that renders the company's branding with no jobs on it.
  }

  const head = `<script>window.__JOBS__ = ${jsonForScript(jobs)};</script>`;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.send(renderPage('index.html', head, dominantLanguage(jobs)));
}

app.get('/', serveListing);
app.get('/index.html', serveListing);

// ── Job detail page — server-rendered JSON-LD ─────────────────────────────── //
app.get('/jobs/:idOrSlug', async (req, res) => {
  let job = null;
  try {
    job = await getPublishedJob(req.params.idOrSlug);
  } catch (err) {
    console.error(`[job] Failed to fetch "${req.params.idOrSlug}":`, err.message);
  }

  // 404 rather than an empty page: an unknown or unpublished slug that answers 200 is a blank page
  // Google will index, and the sitemap above would then disagree with it.
  if (!job) {
    res.status(404);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    // No job, so no language to declare - the template's own lang stands.
    return res.send(renderPage('job.html', '<script>window.__JOB__ = null;</script>'));
  }

  // Render. Count the view first (fire-and-forget), then send.
  reportView(job.Id);

  const parts = [`<script>window.__JOB__ = ${jsonForScript(job)};</script>`];
  if (cfg.baseUrl) {
    parts.push(`<link rel="canonical" href="${jobUrl(job.Slug)}">`);
    parts.push(
      `<script type="application/ld+json">${jsonForScript(buildJobPostingLd(job))}</script>`,
    );
  } else {
    // Every JobPosting field that identifies *where* the ad lives comes from BASE_URL. Emitting
    // the markup without it would publish a JobPosting with no url, which is invalid, so the
    // markup is omitted entirely and the page still renders for humans.
    console.warn('[job] BASE_URL is not set — omitting JSON-LD rather than emitting an invalid JobPosting');
  }

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.send(renderPage('job.html', parts.join('\n  '), job.Language));
});

// ── Static files ──────────────────────────────────────────────────────────── //
// After the HTML routes above, so express.static can't serve index.html/job.html straight from
// disk and skip the server-rendered head.
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '1h',
  etag: true,
  index: false,
}));

// ── Start ─────────────────────────────────────────────────────────────────── //
// Guarded so tests can require this module (for app/proxyToBackend) without starting a real
// listener.
if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`[careers-website] Listening on port ${PORT}`);
    if (!cfg.jobsApiUrl)     console.warn('[careers-website] WARNING: JOBS_API_URL is not set — no jobs will be shown');
    if (!cfg.baseUrl)        console.warn('[careers-website] WARNING: BASE_URL is not set — no structured data or sitemap');
    if (!cfg.companyCountry) console.warn('[careers-website] WARNING: COMPANY_COUNTRY is not set — structured data will omit the job\'s country');
    // One-off warm-up, so the first visitor after a deploy does not wait on job-service either.
    if (cfg.jobsApiUrl) {
      getPublishedJobs().catch((err) => console.warn('[jobs] warm-up fetch failed:', err.message));
    }
  });
}

module.exports = { app, proxyToBackend, buildJobPostingLd, dominantLanguage, reportView, applyBranding, createJobsCache };

// ── Helpers ───────────────────────────────────────────────────────────────── //
// Resolves { status, json } for 2xx and 404 — a 404 from the jobs API means "not published", which
// is an answer the caller has to act on, not a transport failure. Everything else rejects.
function requestJson(url, headers) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const client = target.protocol === 'https:' ? https : http;
    client.get(target, { headers, timeout: 10000 }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 404) return resolve({ status: 404, json: null });
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode} from ${target.pathname}`));
        }
        try {
          resolve({ status: 200, json: JSON.parse(data) });
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject).on('timeout', function () { this.destroy(new Error('timeout')); });
  });
}
