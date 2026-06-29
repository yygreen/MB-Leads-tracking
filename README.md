# Mastermind Behavior — Marketing Lead Tracking

A deployable Next.js 14 dashboard that aggregates top-of-funnel marketing lead
activity from 5+ sources. It is **independent of the client's CRM (Pipedrive)**
and focuses purely on marketing attribution: where leads come from, channel
volume, and UTM source breakdown.

The dashboard ships with **rich mock data** so it deploys and renders fully with
**zero environment variables**. As each API credential arrives, drop the env
vars in and that source swaps from mock → live automatically.

## Quick start

```bash
npm install
npm run dev          # http://localhost:3000
```

With no env vars set, `/api/data` serves mock data from `lib/mockData.ts` and
every section renders.

## Architecture

```
app/
  page.tsx                 single-page dashboard (8 sections)
  layout.tsx               Manrope font + brand metadata
  globals.css              brand tokens + component styles
  api/
    data/route.ts          reads dashboard.json (blob) → falls back to mock
    webflow-form/route.ts  webhook receiver for Webflow form submissions
    callrail-webhook/route.ts  CallRail webhook fallback
    refresh-all/route.ts   runs every ETL + aggregate (manual refresh button)
    cron/<source>/route.ts six cron handlers (one per source + aggregate)
components/                 presentational UI for each section
lib/
  types.ts                 the DashboardData contract
  mockData.ts              seeded, realistic 180-day mock data
  cron.ts                  cron auth gate + shared runner
etl/
  _lib.js                  storage abstraction (Vercel Blob ↔ local data/*.json)
  _run.js                  standalone-runner helpers
  callrail.js webflow.js gbp.js ga4.js leadtrap.js   source pulls
  aggregate.js             rolls all sources → dashboard.json
  verify.js guard.js       data-integrity gates
vercel.json                cron schedule
```

## Data sources

| Source        | Pull method                          | Cron       | Env vars |
|---------------|--------------------------------------|------------|----------|
| CallRail      | API v3 (webhook fallback)            | every 15m  | `CALLRAIL_API_KEY`, `CALLRAIL_ACCOUNT_ID` |
| Webflow Forms | API pull + webhook → `/api/webflow-form` | every 15m | `WEBFLOW_API_TOKEN` |
| GBP           | Business Profile Performance + OAuth | daily      | `GBP_CLIENT_ID`, `GBP_CLIENT_SECRET`, `GBP_REFRESH_TOKEN`, `GBP_LOCATION_IDS` |
| GA4           | Data API + service account           | daily      | `GA4_PROPERTY_ID`, `GA4_SERVICE_ACCOUNT_JSON` (base64) |
| Leadtrap      | Webhook → `/api/leadtrap-webhook`    | real-time  | — (no API) |

Storage:
- `BLOB_READ_WRITE_TOKEN` → reads/writes **Vercel Blob**
- otherwise → reads/writes `./data/*.json` (local dev)

`CRON_SECRET` (optional) gates the cron + refresh endpoints in production.

## Running an ETL job standalone

Each ETL file is testable on its own (writes to `./data/*.json` locally):

```bash
node etl/callrail.js
node etl/aggregate.js
```

Without credentials a job logs a warning and writes `[]` — it never crashes.

## Deploy

Push to GitHub and import into Vercel. It builds and renders with mock data out
of the box. Add credentials in Vercel → Project → Settings → Environment
Variables as they arrive; the crons + aggregate will replace mock with live
data on their next run.
