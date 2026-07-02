# AMS Design System

## Typography

- **Family:** Plus Jakarta Sans (`next/font/google`)
- **Fallback:** system-ui, sans-serif
- **Scale:** 12px body · 13px nav · 18px page title · 28–34px KPI numbers
- **Weight:** 400 body · 600 labels/buttons · 700 headings/KPIs

## Color Tokens (CREDICORP logo-derived)

| Token | Hex | Use |
|-------|-----|-----|
| `--brand-900` | `#0a4a3b` | Sidebar background |
| `--brand-700` | `#0d5a47` | Headings, dark buttons |
| `--brand-500` | `#0e8a6b` | Primary actions, active nav |
| `--brand-300` | `#46b5c4` | Secondary accent |
| `--surface` | `#f2f7f5` | Main background (green-tinted neutral) |
| `--panel` | `#fafcfb` | Card background |
| `--ink` | `#19302a` | Body text |
| `--muted` | `#64807a` | Secondary text |
| `--line` | `#e1eae7` | Borders |

Semantic risk colors (do not change): Critical `#7a0012`, High `#b00020`, Moderate `#e8590c`, Low `#2e7d32`, Process Improvement `#2c5f8a`.

## Layout

- **Sidebar:** 260px, dark `--brand-900`, grouped nav with Hugeicons (MAIN / ASSESSMENT / SYSTEM)
- **Main:** Rounded white shell (`main-shell`) on tinted background with outer padding. Full width inside shell.
- **Topbar:** White sticky, soft shadow, page title left, actions right.

## Components

- **Nav item:** 13px, rounded 8px. Active = `--brand-500` pill background.
- **Primary button:** `--brand-500` fill, white text, 8px radius.
- **Card:** 1px `--line` border, 12px radius, subtle shadow. No top-stripe accents.
- **Callout (`.note`):** Green-tinted background, full border. No left stripe.
- **Obs block:** Background tint by criticality class. No left stripe.
- **Modal:** Default 720px. `.modal.wide` = 920px for observation forms.
- **KPI cards:** Shadow + border. Accent via subtle background tint, not border-top stripes.

## Motion

150–200ms ease-out on hover states. No page-load animations.

## Banned Patterns

- Side-stripe borders (`border-left` > 1px as accent)
- Gradient text
- KPI `border-top: 3px` stripes
- max-width content columns below 100%
