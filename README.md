# Careers Website

The careers site a RecruitXp client publishes its open positions on. A small Express server that
reads published jobs from `job-service`, renders the job pages, and owns everything about how those
jobs appear in public under the client's own domain.

**It is the publisher, not a viewer.** The page URLs, the `JobPosting` structured data, the
canonical link and `sitemap.xml` all originate here, because they are claims about a domain that
only whoever owns that domain can make — see
[`docs/implementation-plans/jobs-api-careers-site-publishing-plan.md`](../../docs/implementation-plans/jobs-api-careers-site-publishing-plan.md).

**Self-hosted, open-source.** This code is meant to run under your own domain and infrastructure,
authenticated to RecruitXp with a per-tenant API key rather than any credential RecruitXp holds on
your behalf — see "Getting an API key" below. (Destined for `github.com/RecruitXp/careers-website`;
until that move happens it lives at `apps/careers-website` in the main RecruitXp/ATS repo.)

## How job data gets here

`GET /api/published-jobs` on `job-service` requires an API key, so **this server** fetches job
data — never the browser. It sends `X-Api-Key: $API_KEY` on every call — the tenant comes from the
key itself, never from a header (see
[`docs/implementation-plans/platform-job-pages-plan.md`](../../docs/implementation-plans/platform-job-pages-plan.md#7-self-hosting-the-api-key-is-not-a-read-key)
§7) — then renders the result into the served HTML (`window.__JOBS__` on the listing,
`window.__JOB__` plus the JSON-LD on a job page). The same key also reports each job-page view back
to `job-service` (fire-and-forget, never blocking the page load), so `ViewCount` reflects traffic
here too, not just the platform's own job page.

Two consequences worth knowing before changing anything here:

- **There is no client-side job fetch, and there must not be one.** A key in client JS is a
  disclosed credential.
- **The structured data is in the served markup**, not injected after load. That is the whole
  reason a crawler can be relied on to see it.

Responses are cached for 60s, with a 10-minute stale window used only when a refetch *fails* — a
brief `job-service` outage must not blank the careers site or the sitemap. An unpublish is visible
within the 60s TTL, and a 404 from the jobs API evicts the entry immediately rather than reviving a
stale copy.

## Getting an API key

This site authenticates as one tenant's credential, not a shared platform secret. From your ATS
account, open **Settings** and issue a public API key — it's shown once, so copy it immediately into
`API_KEY` below. Issuing a new key instantly invalidates the previous one; there is no rotation
grace period.

Once connected, add RecruitXp's Google service account as an **Owner** of this site's property in
Google Search Console (the exact address is shown in the ATS's channel setup screen for
"Google for Jobs") if you want your job postings indexed — RecruitXp announces new/removed postings
to Google on your behalf once that grant exists, but only for the domain you configured here as
`BASE_URL`.

## Configuration

All configuration is environment variables, read once at startup. There is no `config.js` on disk —
`/config.js` is generated per request from these values. In the cluster they come from
`public-services-config` (see
[`infra/k8s/base/public-services-configmap.yaml`](../../infra/k8s/base/public-services-configmap.yaml)).

| Variable | Required | Description |
|---|---|---|
| `API_KEY` | **yes — exits if unset** | This tenant's public API key (see "Getting an API key" above). No default, deliberately: a missing key must fail loudly at startup, not silently serve no jobs. Carries the tenant on every backend call, so the jobs shown and the applications submitted cannot end up scoped to someone else's tenant. |
| `JOBS_API_URL` | yes in practice | `job-service`'s published-jobs endpoint, e.g. `http://job-service:3001/api/published-jobs`. Without it no jobs are shown. No tenant in this value — the key carries it. |
| `BASE_URL` | yes in practice | This site's public origin, e.g. `https://careers.acme.com`. Every published URL is built from it — the canonical link, the JSON-LD `url` and the sitemap. Never from the request's `Host` header: a `Host` is caller-supplied, and this markup is read by Google. Without it, the JSON-LD is omitted rather than emitted with a wrong URL. |
| `COMPANY_NAME` | yes | The hiring organisation, in the page and in the structured data. |
| `COMPANY_COUNTRY` | recommended | ISO-3166 country for the JobPosting address. Google for Jobs needs it on a non-remote posting; omitted rather than guessed when unset. |
| `COMPANY_TAGLINE`, `COMPANY_DESCRIPTION`, `COMPANY_WEBSITE`, `COMPANY_EMAIL` | no | Branding text. |
| `APPLICANTS_URL`, `CV_PARSE_URL`, `APPLICATIONS_URL` | no | Real upstream targets for the apply flow, proxied through `/api/proxy/*`. Leave unset for demo mode: the form simulates success without touching the database. |

The browser is never given an upstream URL — `/config.js` hands out relative `/api/proxy/*` paths
instead, and this server attaches the key.

## Routes

| Route | Behaviour |
|---|---|
| `/`, `/index.html` | Listing page with the published job list rendered in. |
| `/jobs/:slug` | Job page with `window.__JOB__`, a canonical link and the `JobPosting` JSON-LD. **404s** on an unknown or unpublished slug — an empty 200 would be a blank page Google indexes. |
| `/sitemap.xml` | Every published job URL. **503s** rather than emitting a sitemap containing only `/`, which would read to a crawler as "every job was unpublished". |
| `/robots.txt` | Points at the sitemap. |
| `/config.js` | Branding + proxy paths, generated from env. |
| `/api/proxy/*` | Apply-flow calls, with the API key attached. |

## Run locally

```bash
npm ci
npm run build:css
API_KEY=... JOBS_API_URL=... BASE_URL=http://localhost:3000 COMPANY_NAME="Acme" npm start
```

```bash
npm test
```

Tailwind output (`public/css/tailwind.css`) is generated — `npm run dev:css` watches it.

## Project structure

```
careers-website/
├── server.js         # Express server: API key, jobs fetch + cache, JSON-LD, sitemap, proxy routes
├── server.test.js
├── public/
│   ├── index.html    # Listing shell — <!--SERVER_HEAD--> is the injection point
│   ├── job.html      # Job page shell — same
│   ├── css/
│   └── js/
│       ├── main.js   # Listing: filters, search, cards
│       └── job.js    # Job page: rendering, apply modal, CV parse
└── Dockerfile        # node:22-alpine, builds Tailwind, runs server.js on :3000
```
