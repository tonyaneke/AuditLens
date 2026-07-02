# AMS — Audit Management System

## Product Purpose

AMS is an internal audit workspace for planning engagements, logging observations, tracking remediation, assessing risk, and exporting reports. It replaces spreadsheet-driven audit workflows with a single browser-based tool that stores data locally until exported.

## Register

product

## Users

- **Chief Audit Executive (CAE)** — portfolio dashboards, quarterly BAC reporting, overall risk posture
- **Lead / staff auditors** — audit planning, fieldwork observations, report drafting
- **Management readers** — exported Word reports and remediation status (read-only via exports)

Primary context: desk work in a bright office, switching between dense tables and executive summaries between meetings.

## Organization

Default org: Nigerian Consumer Credit Corporation (CREDICORP). Org name is configurable in Settings and shown in the sidebar org chip.

## Brand

- **Product name:** AMS (Audit Management System)
- **Tone:** Professional, precise, audit-grade. No marketing fluff.
- **Logo:** CREDICORP logo (green/teal palette) when uploaded in Settings.

## Strategic Principles

1. Data density over decoration — auditors need many observations visible at once.
2. Semantic risk colors are sacred — Critical/High/Moderate/Low must never be re-themed.
3. Full-width main canvas — horizontal space is for tables and KPI grids, not margins.
4. Primary actions live in context (dashboard CTA for new observations, not buried in nav).

## Anti-References

- Generic green SaaS with hero metrics and gradient text
- Anarisk blue palette clone (layout reference only, not colors)
- Narrow content columns wasting screen width
- Side-stripe accent borders on cards and callouts
- Sidebar items for flows better served by modals

## Data Storage

Browser `localStorage` only. Users must back up via Settings → Backup.
