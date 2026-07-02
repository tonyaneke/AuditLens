# AMS — Audit Management System

Next.js port of the CREDICORP Internal Audit workspace. Dashboard, audits, observations, remediation tracking, fraud risk, process review, and Word exports.

Data is stored in the browser via `localStorage` (key: `auditBotData`).

## Getting started

```bash
cd audit-app
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Design

- **Typography:** Plus Jakarta Sans
- **Colors:** CREDICORP logo greens/teals (see `DESIGN.md`)
- **Layout:** 200px dark sidebar + full-width main canvas
- **New Observation:** Dashboard button opens a wide modal

## Project structure

| Path | Purpose |
|------|---------|
| `app/` | Next.js App Router (layout, page, global CSS) |
| `components/AuditApp.tsx` | AMS shell (sidebar, main content, modal) |
| `public/audit-bot.js` | Application logic |
| `scripts/extract-html.mjs` | Re-syncs JS from HTML (CSS preserved in `app/globals.css`) |
| `PRODUCT.md` / `DESIGN.md` | Brand and design tokens |

## Updating from the HTML source

```bash
npm run extract
```

CSS is **not** overwritten. Edit `app/globals.css` directly for design changes.

## Production build

```bash
npm run build
npm start
```
