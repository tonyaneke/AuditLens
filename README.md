# Audit Reporting Bot (Next.js)

Next.js port of the CREDICORP Internal Audit Reporting Bot. All features from the original single-page HTML app are preserved — dashboard, audits, observations, remediation tracker, fraud risk, process review, and Word exports.

Data is still stored in the browser via `localStorage` (key: `auditBotData`).

## Getting started

```bash
cd audit-app
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Project structure

| Path | Purpose |
|------|---------|
| `app/` | Next.js App Router (layout, page, global CSS) |
| `components/AuditApp.tsx` | App shell (sidebar, main content, modal) |
| `public/audit-bot.js` | Application logic extracted from the original HTML |
| `scripts/extract-html.mjs` | Re-syncs CSS/JS from `../Audit-Reporting-Bot (1).html` |

## Updating from the HTML source

If you edit the original HTML file, re-run:

```bash
npm run extract
```

Then restart the dev server.

## Production build

```bash
npm run build
npm start
```
