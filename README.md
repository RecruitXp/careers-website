# RecruitXp Careers Website

A free, open-source careers page for companies hiring with [RecruitXp](https://recruitxp.com/) —
the applicant tracking system built for teams who want hiring to feel organised, not chaotic.

This is a small, self-hosted site that lists your open positions and lets candidates apply, running
on **your own domain**, styled as **your own brand**. It's entirely optional: RecruitXp works fine
without it. It exists for companies who want their careers page to live at
`careers.yourcompany.com` instead of a generic RecruitXp URL, with full control over the design,
copy and SEO — without having to build that page from scratch.

Because it's open source, you're also free to fork it and change anything — colours, layout, copy,
whatever your brand needs. It's yours.

## What you get

- A listing page and a job detail page for every position you publish in RecruitXp
- Search-engine-friendly structured data (`JobPosting` JSON-LD), a sitemap and `robots.txt` — the
  things that get your jobs found on Google, out of the box
- A working "Apply" flow, wired directly to your RecruitXp account
- Full ownership of the domain and branding — nothing here is locked to RecruitXp's own hosting

## Quick start (Docker)

1. **Get an API key.** Log into your RecruitXp admin account, open **Settings**, and issue a public
   API key. It's shown once — copy it somewhere safe. See "Getting an API key" below for the full
   details.
2. **Build and run:**

   ```bash
   docker build -t careers-website .
   docker run -p 3000:3000 \
     -e API_KEY="rxp_your_key_here" \
     -e JOBS_API_URL="https://job-api.app.recruitxp.com/api/published-jobs" \
     -e BASE_URL="https://careers.yourcompany.com" \
     -e COMPANY_NAME="Your Company" \
     -e COMPANY_COUNTRY="PT" \
     careers-website
   ```

3. Visit `http://localhost:3000` — you should see your published jobs listed. Point your real
   domain at wherever you deploy this (any host that can run a Docker container works), set
   `BASE_URL` to that domain, and you're live.

See "Configuration" below for every available option, including your company's branding and the
apply-flow endpoints.

## Getting an API key

This site authenticates to RecruitXp as your own account's credential — never a shared secret, and
never something RecruitXp holds on your behalf. From your RecruitXp admin account, open
**Settings** and issue a public API key. It's shown once, so copy it immediately into `API_KEY`
below. Issuing a new key instantly invalidates the previous one — there's no grace period, so update
your running deployment at the same time.

Once you're up and running, if you'd like your job postings to appear in Google for Jobs, add
RecruitXp's Google service account as an **Owner** of this site's property in Google Search Console
(the exact address is shown in your RecruitXp account's channel setup screen for "Google for Jobs").
RecruitXp then announces new and removed postings to Google on your behalf, for the domain you set
below as `BASE_URL`.

## Configuration

All configuration is environment variables, read once at startup.

| Variable | Required | Description |
|---|---|---|
| `API_KEY` | **yes — exits if unset** | Your RecruitXp public API key (see "Getting an API key" above). Carries your account on every request, so a missing key fails loudly at startup rather than silently showing no jobs. |
| `JOBS_API_URL` | yes in practice | RecruitXp's published-jobs endpoint, e.g. `https://job-api.app.recruitxp.com/api/published-jobs`. Without it, no jobs are shown. |
| `BASE_URL` | yes in practice | This site's public address, e.g. `https://careers.yourcompany.com`. Every published link is built from it — the canonical URL, the JSON-LD `url` and the sitemap — so search engines see the right domain. Without it, the structured data is omitted rather than published with a wrong URL. |
| `COMPANY_NAME` | yes | Your company's name, shown on the page and in the structured data. |
| `COMPANY_COUNTRY` | recommended | ISO-3166 country code (e.g. `PT`, `US`) for the job posting's address. Google for Jobs needs it for non-remote roles. |
| `COMPANY_TAGLINE`, `COMPANY_DESCRIPTION`, `COMPANY_WEBSITE`, `COMPANY_EMAIL` | no | Branding text shown on the page. |
| `APPLICANTS_URL`, `CV_PARSE_URL`, `APPLICATIONS_URL` | no | RecruitXp's apply-flow endpoints, proxied through `/api/proxy/*` so your API key never reaches the browser. Leave unset to run in demo mode: the apply form simulates success without submitting anywhere. |

The browser is never given your API key or any RecruitXp URL directly — `/config.js` hands out
relative `/api/proxy/*` paths, and this server attaches the key on every call.

## Routes

| Route | Behaviour |
|---|---|
| `/`, `/index.html` | Listing page with your published jobs. |
| `/jobs/:slug` | Job detail page, with a canonical link and `JobPosting` structured data for search engines. Returns a 404 for an unknown or unpublished job. |
| `/sitemap.xml` | Every published job's URL, for search engines to crawl. |
| `/robots.txt` | Points crawlers at the sitemap. |
| `/config.js` | Your branding and the apply-flow proxy paths, generated from your configuration. |
| `/api/proxy/*` | Apply-flow calls (create applicant, parse CV, submit application), with your API key attached server-side. |

## Customizing the site

Everything under `public/` is plain HTML/CSS/JS — no build step beyond Tailwind. Edit `index.html`
and `job.html` for markup, `public/js/main.js` and `public/js/job.js` for behaviour, and
`public/css/styles.css` for your own design tokens (colours, fonts, spacing). Rebuild the CSS and
your Docker image, and redeploy.

The branding text in both pages (company name, website and e-mail links, tagline, description,
footer year) is written as `{{COMPANY_NAME}}`-style placeholders that `server.js` fills from the
same environment variables as `/config.js`. Keep that pattern when adding branding to the markup:
it is what puts the text in the served HTML, where search engines read it without running scripts.

```bash
npm ci
npm run build:css       # one-off build, or npm run dev:css to watch while you edit
API_KEY=... JOBS_API_URL=... BASE_URL=http://localhost:3000 COMPANY_NAME="Acme" npm start
```

```bash
npm test
```

## Project structure

```
careers-website/
├── server.js         # Express server: API key auth, jobs fetch + cache, JSON-LD, sitemap, proxy routes
├── server.test.js
├── public/
│   ├── index.html    # Listing shell — <!--SERVER_HEAD--> and {{COMPANY_*}} are the injection points
│   ├── job.html      # Job page shell — same
│   ├── css/
│   └── js/
│       ├── main.js   # Listing: filters, search, cards
│       └── job.js    # Job page: rendering, apply modal, CV parse
└── Dockerfile        # node:22-alpine, builds Tailwind, runs server.js on :3000
```

## About RecruitXp

[RecruitXp](https://recruitxp.com/) is an applicant tracking system built for teams who want a
faster, less chaotic way to hire — job publishing, structured pipelines, interview scheduling and
candidate communication in one place. This careers site is a small, optional piece of that: if you
don't have a RecruitXp account yet, [recruitxp.com](https://recruitxp.com/) is where to start.
