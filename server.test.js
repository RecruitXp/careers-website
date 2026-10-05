'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

// server.js reads all config from process.env at module-load (require) time, so the mock backend
// servers must be listening — and the env vars pointing at them set — before it's required.

const API_KEY = 'test-api-key';

let backendRequests = [];
let backendServer;
let backendPort;

// The mock jobs API. Kept separate from the generic backend above so its requests, its status code
// and its payload can be steered per test.
let jobsRequests = [];
let jobsApiStatus = 200;
let jobsApiServer;
let jobsApiPort;

const PUBLISHED_JOB = {
  Id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  Title: 'Senior Backend Engineer',
  Description: 'Build things.',
  Requirements: 'Experience.',
  Department: 'Engineering',
  Location: 'Lisbon',
  EmploymentType: 'full-time',
  WorkMode: 'hybrid',
  ExperienceLevel: 'senior',
  Skills: ['Node.js', 'PostgreSQL'],
  Benefits: ['Health insurance'],
  SalaryMin: 45000,
  SalaryMax: 65000,
  SalaryCurrency: 'EUR',
  Language: 'pt-PT',
  PublishedAt: '2026-07-01T09:00:00.000Z',
  ApplicationDeadline: '2026-09-01T00:00:00.000Z',
  Slug: 'senior-backend-engineer',
};

// Polls until `predicate()` is true or `timeoutMs` elapses — needed because reportView (and
// proxyToBackend's upstream call) are fire-and-forget, so nothing awaits their completion.
async function waitFor(predicate, timeoutMs = 1000) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

before(async () => {
  backendServer = http.createServer((req, res) => {
    backendRequests.push({ method: req.method, url: req.url, headers: req.headers });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ echoed: true }));
  });
  await new Promise((resolve) => backendServer.listen(0, resolve));
  backendPort = backendServer.address().port;

  jobsApiServer = http.createServer((req, res) => {
    jobsRequests.push({ method: req.method, url: req.url, headers: req.headers });

    if (jobsApiStatus !== 200) {
      res.writeHead(jobsApiStatus, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'unavailable' }));
      return;
    }

    // POST /api/published-jobs/by-id/<id>/view — fire-and-forget view count (plan §1.1). Checked
    // before the GET-by-id match below since both share the `by-id/<id>` prefix.
    if (req.method === 'POST' && /^\/api\/published-jobs\/by-id\/.+\/view$/.test(req.url)) {
      res.writeHead(204);
      res.end();
      return;
    }

    // /api/published-jobs/by-id/<id> → one job by id; /api/published-jobs/<slug> → by slug; list otherwise.
    const byId = req.url.match(/^\/api\/published-jobs\/by-id\/(.+)$/);
    if (byId) {
      if (decodeURIComponent(byId[1]) !== PUBLISHED_JOB.Id) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Published job not found' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(PUBLISHED_JOB));
      return;
    }

    const match = req.url.match(/^\/api\/published-jobs\/(.+)$/);
    if (match) {
      if (decodeURIComponent(match[1]) !== PUBLISHED_JOB.Slug) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Published job not found' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(PUBLISHED_JOB));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify([PUBLISHED_JOB]));
  });
  await new Promise((resolve) => jobsApiServer.listen(0, resolve));
  jobsApiPort = jobsApiServer.address().port;

  process.env.NODE_ENV = 'test';
  process.env.API_KEY = API_KEY;
  // Configured for one proxy path, left empty for another - covers both sides of /config.js's
  // `cfg.xUrl ? '/api/proxy/...' : ''` ternary in a single module load.
  process.env.APPLICANTS_URL = `http://localhost:${backendPort}/applicants`;
  process.env.CV_PARSE_URL = '';
  process.env.APPLICATIONS_URL = `http://localhost:${backendPort}/applications`;
  process.env.JOBS_API_URL = `http://localhost:${jobsApiPort}/api/published-jobs`;
  process.env.BASE_URL = 'https://careers.example.test';
  process.env.COMPANY_NAME = 'Example Client Ltd';
  process.env.COMPANY_WEBSITE = 'https://example.test';
  process.env.COMPANY_EMAIL = 'jobs@example.test';
  process.env.COMPANY_COUNTRY = 'PT';
});

after(async () => {
  await new Promise((resolve) => backendServer.close(resolve));
  await new Promise((resolve) => jobsApiServer.close(resolve));
});

describe('proxyToBackend (via the real Express app) and /config.js', () => {
  let appServer;
  let appPort;

  before(async () => {
    const { app } = require('./server.js');
    appServer = app.listen(0);
    await new Promise((resolve) => appServer.once('listening', resolve));
    appPort = appServer.address().port;
  });

  after(async () => {
    await new Promise((resolve) => appServer.close(resolve));
  });

  test('attaches the API key, forwarding to the configured applicants proxy target', async () => {
    backendRequests = [];

    const res = await fetch(`http://localhost:${appPort}/api/proxy/applicants`, { method: 'POST' });
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.deepEqual(body, { echoed: true });
    assert.equal(backendRequests.length, 1);
    assert.equal(backendRequests[0].headers['x-api-key'], API_KEY);
    // Never the old M2M shape — this site holds no bearer token or tenant header any more.
    assert.equal(backendRequests[0].headers.authorization, undefined);
    assert.equal(backendRequests[0].headers['x-tenant-id'], undefined);
  });

  test('/config.js exposes a proxy path only for the URLs that are actually configured', async () => {
    const res = await fetch(`http://localhost:${appPort}/config.js`);
    const body = await res.text();

    assert.match(body, /"applicantsUrl":\s*"\/api\/proxy\/applicants"/);
    assert.match(body, /"applicationsUrl":\s*"\/api\/proxy\/applications"/);
    assert.match(body, /"cvParseUrl":\s*""/);
  });

  test('/config.js hands the browser no job-data URL at all', async () => {
    const res = await fetch(`http://localhost:${appPort}/config.js`);
    const body = await res.text();

    // The browser used to be given the feed URL here and fetch job data itself. It can't any
    // more — the jobs API requires a key this server must not disclose — so any URL reappearing
    // in this payload is a regression, not a feature.
    assert.equal(body.includes('feed'), false);
    assert.equal(body.includes(`localhost:${jobsApiPort}`), false);
  });
});

// cfg is read when server.js is first required, so the NOINDEX behaviour needs a fresh copy of the
// module. The cache is cleared on both sides so neither this copy nor the one other blocks require
// is affected by the other.
describe('NOINDEX', () => {
  let appServer;
  let appPort;

  before(async () => {
    delete require.cache[require.resolve('./server.js')];
    process.env.NOINDEX = 'true';
    const { app } = require('./server.js');
    appServer = app.listen(0);
    await new Promise((resolve) => appServer.once('listening', resolve));
    appPort = appServer.address().port;
  });

  after(async () => {
    delete process.env.NOINDEX;
    delete require.cache[require.resolve('./server.js')];
    await new Promise((resolve) => appServer.close(resolve));
  });

  const get = (path) => fetch(`http://localhost:${appPort}${path}`);

  test('every response carries X-Robots-Tag, the listing, a job, a static file and a 404 alike', async () => {
    for (const path of ['/', '/jobs/senior-backend-engineer', '/css/styles.css', '/jobs/no-such-job', '/robots.txt']) {
      const res = await get(path);
      await res.text();
      assert.equal(res.headers.get('x-robots-tag'), 'noindex', path);
    }
  });

  test('the pages say noindex in the markup and drop the canonical', async () => {
    for (const path of ['/', '/jobs/senior-backend-engineer']) {
      const html = await (await get(path)).text();
      assert.match(html, /<meta name="robots" content="noindex">/, path);
      assert.equal(html.includes('rel="canonical"'), false, path);
    }
  });

  test('there is no sitemap, and robots.txt neither names one nor disallows crawling', async () => {
    assert.equal((await get('/sitemap.xml')).status, 404);

    const robots = await (await get('/robots.txt')).text();
    assert.equal(robots.includes('Sitemap'), false);
    // A Disallow would stop a crawler reading the noindex it is meant to obey.
    assert.equal(robots.includes('Disallow'), false);
    assert.match(robots, /Allow: \//);
  });

  test('is off by default: no header, a canonical, and a sitemap', async () => {
    // The shared instance the other blocks use was loaded with NOINDEX unset.
    delete process.env.NOINDEX;
    delete require.cache[require.resolve('./server.js')];
    const { app } = require('./server.js');
    const server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    const port = server.address().port;
    try {
      const res = await fetch(`http://localhost:${port}/`);
      const html = await res.text();
      assert.equal(res.headers.get('x-robots-tag'), null);
      assert.match(html, /rel="canonical"/);
      assert.equal(html.includes('name="robots"'), false);
      assert.equal((await fetch(`http://localhost:${port}/sitemap.xml`)).status, 200);
    } finally {
      await new Promise((resolve) => server.close(resolve));
      process.env.NOINDEX = 'true';
    }
  });
});

// The listing used to wait for job-service on every request that found its 60 s cache entry stale,
// which on an idle site is nearly every request a crawler makes. A stale entry is now served within
// a deadline while the refresh runs; these tests drive that with a fake clock and a scripted upstream.
describe('jobs cache: stale-while-revalidate behind a deadline', () => {
  // Each upstream answer is a function so a test can make it slow, fail or 404. server.js is
  // required lazily: at collection time the env the top-level before() sets is not there yet.
  function setup(answers) {
    const { createJobsCache } = require('./server.js');
    let clock = 1_000_000;
    const calls = [];
    const cache = createJobsCache({
      fetchJson: (url) => { calls.push(url); return answers.shift()(); },
      ttlMs: 1000,
      staleMaxMs: 10_000,
      refreshDeadlineMs: 50,
      now: () => clock,
      log: { warn() {} },
    });
    return { cache, calls, tick: (ms) => { clock += ms; } };
  }
  const answer = (json, delayMs = 0, status = 200) => () =>
    new Promise((resolve) => setTimeout(resolve, delayMs, { status, json }));
  const failure = () => () => Promise.reject(new Error('upstream down'));

  test('waits for the upstream when nothing is cached yet', async () => {
    const { cache } = setup([answer(['first'], 100)]);
    assert.deepEqual(await cache.get('/jobs'), ['first']);
  });

  test('serves a fresh entry without an upstream call', async () => {
    const { cache, calls, tick } = setup([answer(['first'])]);
    await cache.get('/jobs');
    tick(500);
    assert.deepEqual(await cache.get('/jobs'), ['first']);
    assert.equal(calls.length, 1);
  });

  test('serves the stale copy at once when the refresh outruns the deadline, then lands the refresh', async () => {
    const { cache, tick } = setup([answer(['first']), answer(['second'], 200)]);
    await cache.get('/jobs');
    tick(5000);

    const started = Date.now();
    assert.deepEqual(await cache.get('/jobs'), ['first']);
    assert.ok(Date.now() - started < 150, 'the stale copy must not wait for the slow refresh');

    await new Promise((resolve) => setTimeout(resolve, 250));
    // The background refresh has landed: the next read is the new list, with no further call.
    assert.deepEqual(await cache.get('/jobs'), ['second']);
  });

  test('gives way to the fresh copy when the upstream answers within the deadline', async () => {
    const { cache, tick } = setup([answer(['first']), answer(['second'], 5)]);
    await cache.get('/jobs');
    tick(5000);
    assert.deepEqual(await cache.get('/jobs'), ['second']);
  });

  test('serves the stale copy when the refresh fails', async () => {
    const { cache, tick } = setup([answer(['first']), failure()]);
    await cache.get('/jobs');
    tick(5000);
    assert.deepEqual(await cache.get('/jobs'), ['first']);
  });

  test('a 404 within the deadline evicts the entry: an unpublished job stops being served at once', async () => {
    const { cache, tick } = setup([answer({ Slug: 'x' }), answer(null, 0, 404), answer(null, 0, 404)]);
    await cache.get('/jobs/x');
    tick(5000);
    assert.equal(await cache.get('/jobs/x'), null);
    // Nothing cached any more, so the next read goes upstream again rather than reviving the old copy.
    assert.equal(await cache.get('/jobs/x'), null);
  });

  test('refuses to serve a copy older than the ceiling and waits instead', async () => {
    const { cache, tick } = setup([answer(['first']), answer(['second'], 100)]);
    await cache.get('/jobs');
    tick(20_000);
    assert.deepEqual(await cache.get('/jobs'), ['second']);
  });

  test('rejects when the upstream fails and there is nothing worth serving', async () => {
    const { cache } = setup([failure()]);
    await assert.rejects(() => cache.get('/jobs'), /upstream down/);
  });

  test('concurrent stale requests share one upstream call', async () => {
    const { cache, calls, tick } = setup([answer(['first']), answer(['second'], 200)]);
    await cache.get('/jobs');
    tick(5000);
    const results = await Promise.all([cache.get('/jobs'), cache.get('/jobs'), cache.get('/jobs')]);
    assert.deepEqual(results, [['first'], ['first'], ['first']]);
    assert.equal(calls.length, 2);
  });
});

// Publication is this site's job now, not job-service's: the URLs, the company identity and the
// structured data all originate here (docs/implementation-plans/jobs-api-careers-site-publishing-plan.md).
describe('published jobs, sitemap, view counting and server-rendered structured data', () => {
  let appServer;
  let appPort;

  before(async () => {
    const { app } = require('./server.js');
    appServer = app.listen(0);
    await new Promise((resolve) => appServer.once('listening', resolve));
    appPort = appServer.address().port;
  });

  after(async () => {
    jobsApiStatus = 200;
    await new Promise((resolve) => appServer.close(resolve));
  });

  test('the job page declares the posting language, in the markup and to crawlers', async () => {
    jobsApiStatus = 200;

    const res = await fetch(`http://localhost:${appPort}/jobs/senior-backend-engineer`);
    const html = await res.text();

    assert.equal(res.status, 200);
    assert.match(html, /<html lang="pt-PT"/);

    const ld = JSON.parse(
      html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1].replace(/\u003c/g, '<'));
    assert.equal(ld.inLanguage, 'pt-PT');
  });

  test('inLanguage is omitted rather than guessed when a job carries no language', () => {
    const { buildJobPostingLd } = require('./server.js');

    const ld = buildJobPostingLd({ ...PUBLISHED_JOB, Language: undefined });

    assert.equal('inLanguage' in ld, false);
  });

  test('the listing declares the language most of the board is written in', () => {
    const { dominantLanguage } = require('./server.js');

    assert.equal(dominantLanguage([{ Language: 'pt-PT' }, { Language: 'pt-PT' }, { Language: 'en-US' }]), 'pt-PT');
    assert.equal(dominantLanguage([{ Language: 'en-US' }]), 'en-US');
    // Nothing to go on: the template's own lang stands rather than a guess.
    assert.equal(dominantLanguage([]), null);
    assert.equal(dominantLanguage([{ Title: 'no language' }]), null);
  });

  test('/sitemap.xml fails loudly when job data is unavailable and nothing is cached', async () => {
    jobsApiStatus = 503;

    const res = await fetch(`http://localhost:${appPort}/sitemap.xml`);
    const body = await res.text();

    // Not a 200 listing only "/": to a crawler that is indistinguishable from "every job was
    // unpublished", and it would drop the whole site from the index over a transient outage.
    assert.equal(res.status, 503);
    assert.equal(body.includes('<urlset'), false);
  });

  test('/sitemap.xml reads the jobs API with the API key attached', async () => {
    jobsApiStatus = 200;
    jobsRequests = [];

    const res = await fetch(`http://localhost:${appPort}/sitemap.xml`);
    const body = await res.text();

    assert.equal(res.status, 200);
    assert.equal(jobsRequests.length, 1);
    assert.equal(jobsRequests[0].url, '/api/published-jobs');
    assert.equal(jobsRequests[0].headers['x-api-key'], API_KEY);
    assert.equal(jobsRequests[0].headers.authorization, undefined);
    assert.match(body, /<loc>https:\/\/careers\.example\.test\/jobs\/senior-backend-engineer<\/loc>/);
  });

  test('/jobs/:slug serves the JobPosting JSON-LD in the response body', async () => {
    const res = await fetch(`http://localhost:${appPort}/jobs/senior-backend-engineer`);
    const html = await res.text();

    assert.equal(res.status, 200);

    // In the served HTML, not injected by client-side JS after load — that is the point of moving
    // the fetch server-side, and it's what a crawler that doesn't run scripts sees.
    const ld = JSON.parse(
      html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1].replace(/\\u003c/g, '<'),
    );

    assert.equal(ld['@type'], 'JobPosting');
    assert.equal(ld.title, 'Senior Backend Engineer');
    // The two facts job-feed-api could never get right for a tenant that isn't us.
    assert.equal(ld.url, 'https://careers.example.test/jobs/senior-backend-engineer');
    assert.equal(ld.hiringOrganization.name, 'Example Client Ltd');
    assert.equal(ld.hiringOrganization.sameAs, 'https://example.test');
    // Never the platform's own identity, whatever the job data says.
    assert.equal(html.includes('RecruitXp'), false);

    assert.equal(ld.datePosted, '2026-07-01');
    assert.equal(ld.validThrough, '2026-09-01');
    assert.equal(ld.employmentType, 'FULL_TIME');
    assert.equal(ld.jobLocation.address.addressLocality, 'Lisbon');
    assert.equal(ld.jobLocation.address.addressCountry, 'PT');
    assert.equal(ld.baseSalary.value.minValue, 45000);
    assert.equal(ld.identifier.value, PUBLISHED_JOB.Id);
  });

  test('/jobs/:slug reports a view, fire-and-forget, with the API key attached', async () => {
    jobsRequests = [];

    const res = await fetch(`http://localhost:${appPort}/jobs/senior-backend-engineer`);
    await res.text();

    await waitFor(() => jobsRequests.some((r) => r.method === 'POST'));

    const viewReq = jobsRequests.find((r) => r.method === 'POST');
    assert.equal(viewReq.url, `/api/published-jobs/by-id/${PUBLISHED_JOB.Id}/view`);
    assert.equal(viewReq.headers['x-api-key'], API_KEY);
  });

  test('/jobs/:slug\'s canonical link matches the URL the sitemap advertises', async () => {
    const [pageRes, sitemapRes] = await Promise.all([
      fetch(`http://localhost:${appPort}/jobs/senior-backend-engineer`),
      fetch(`http://localhost:${appPort}/sitemap.xml`),
    ]);
    const [html, xml] = await Promise.all([pageRes.text(), sitemapRes.text()]);

    const canonical = html.match(/<link rel="canonical" href="([^"]+)">/)[1];

    assert.equal(canonical, 'https://careers.example.test/jobs/senior-backend-engineer');
    assert.equal(xml.includes(`<loc>${canonical}</loc>`), true);
  });

  test('/jobs/:id resolves by id and canonicalises to the slug URL', async () => {
    // The platform job page redirects here with an id-based careers template. A guid must resolve
    // (via by-id) and the canonical must still be the slug form, so id- and slug-reached pages agree.
    const res = await fetch(`http://localhost:${appPort}/jobs/${PUBLISHED_JOB.Id}`);
    const html = await res.text();

    assert.equal(res.status, 200);
    const canonical = html.match(/<link rel="canonical" href="([^"]+)">/)[1];
    assert.equal(canonical, 'https://careers.example.test/jobs/senior-backend-engineer');
  });

  test('/jobs/:slug embeds the job payload so the page needs no client-side fetch', async () => {
    const res = await fetch(`http://localhost:${appPort}/jobs/senior-backend-engineer`);
    const html = await res.text();

    assert.match(html, /window\.__JOB__ = \{/);
    assert.match(html, /"Slug":"senior-backend-engineer"/);
  });

  test('an unknown slug 404s instead of serving a blank indexable page', async () => {
    const res = await fetch(`http://localhost:${appPort}/jobs/no-such-job`);
    const html = await res.text();

    assert.equal(res.status, 404);
    assert.match(html, /window\.__JOB__ = null;/);
    // No structured data on a page that describes no job.
    assert.equal(html.includes('application/ld+json'), false);
  });

  test('the listing page embeds the published job list', async () => {
    const res = await fetch(`http://localhost:${appPort}/`);
    const html = await res.text();

    assert.equal(res.status, 200);
    assert.match(html, /window\.__JOBS__ = \[/);
    assert.match(html, /"Title":"Senior Backend Engineer"/);
  });

  test('the listing renders the company branding into the HTML, not via client-side JS', async () => {
    const res = await fetch(`http://localhost:${appPort}/`);
    const html = await res.text();

    // What a crawler that runs no scripts sees: previously an empty <h1> and href="#" links.
    assert.match(html, /<title>Careers — Example Client Ltd<\/title>/);
    assert.match(html, /<h1 id="hero-title"[^>]*>Work with us at Example Client Ltd<\/h1>/);
    assert.match(html, /id="company-site" href="https:\/\/example\.test"/);
    assert.match(html, /href="mailto:jobs@example\.test"[^>]*>jobs@example\.test</);
    assert.match(html, /<meta name="description" content="Open positions and career opportunities at Example Client Ltd\.">/);
    assert.equal(html.includes('{{'), false);
  });

  test('the listing declares its canonical URL and the Open Graph and X card tags', async () => {
    const res = await fetch(`http://localhost:${appPort}/`);
    const html = await res.text();

    // Built from BASE_URL, so it matches the sitemap's <loc> for the listing.
    assert.match(html, /<link rel="canonical" href="https:\/\/careers\.example\.test\/">/);
    assert.match(html, /<meta property="og:title" content="Careers — Example Client Ltd">/);
    assert.match(html, /<meta property="og:url" content="https:\/\/careers\.example\.test\/">/);
    assert.match(html, /<meta property="og:type" content="website">/);
    assert.match(html, /<meta property="og:site_name" content="Example Client Ltd">/);
    assert.match(html, /<meta name="twitter:card" content="summary">/);
  });

  test('the job page carries social tags for that job, with exactly one canonical', async () => {
    const res = await fetch(`http://localhost:${appPort}/jobs/senior-backend-engineer`);
    const html = await res.text();

    assert.match(html, /<meta property="og:title" content="Senior Backend Engineer — Example Client Ltd">/);
    assert.match(html, /<meta property="og:description" content="Senior Backend Engineer at Example Client Ltd · Lisbon">/);
    assert.match(html, /<meta property="og:url" content="https:\/\/careers\.example\.test\/jobs\/senior-backend-engineer">/);
    assert.equal((html.match(/rel="canonical"/g) || []).length, 1);
  });

  test('social tags drop the URLs, never guess them, and escape what they print', () => {
    const { socialTagsHtml } = require('./server.js');

    const html = socialTagsHtml({ title: 'A "B" <C>', description: 'x & y', url: '', type: 'website' });

    assert.equal(html.includes('canonical'), false);
    assert.equal(html.includes('og:url'), false);
    assert.match(html, /content="A &quot;B&quot; &lt;C>"/);
    assert.match(html, /content="x &amp; y"/);
  });

  test('the job page renders the same branding', async () => {
    const res = await fetch(`http://localhost:${appPort}/jobs/senior-backend-engineer`);
    const html = await res.text();

    assert.match(html, /id="company-site" href="https:\/\/example\.test"/);
    assert.match(html, /href="mailto:jobs@example\.test"[^>]*>jobs@example\.test</);
    assert.equal(html.includes('{{'), false);
  });

  test('branding values are escaped before they reach the markup', () => {
    const { applyBranding } = require('./server.js');

    assert.equal(
      applyBranding('<h1>{{COMPANY_NAME}}</h1><a href="{{COMPANY_WEBSITE}}">', { COMPANY_NAME: 'A & B <Co>', COMPANY_WEBSITE: '"' }),
      '<h1>A &amp; B &lt;Co></h1><a href="&quot;">',
    );
    // A token with no value renders empty rather than leaking the placeholder.
    assert.equal(applyBranding('{{COMPANY_EMAIL}}', {}), '');
  });

  test('serves the cached job list when the jobs API goes away mid-life', async () => {
    jobsApiStatus = 503;

    const res = await fetch(`http://localhost:${appPort}/sitemap.xml`);
    const body = await res.text();

    // A brief job-service outage must not blank the sitemap Google is about to re-crawl.
    assert.equal(res.status, 200);
    assert.match(body, /senior-backend-engineer/);
  });
});
