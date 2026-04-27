# Good Attic CRM UI Design Handoff Prompt

Use this prompt in the other Codex chat that is building the Good Attic CRM UI.

---

You are helping build a CRM UI for Good Attic. The CRM must visually match the existing Good Attic website as closely as possible while still behaving like a practical operations tool. Do not create a separate SaaS design language. Treat the current Good Attic website as the source of truth for brand, visual style, spacing, buttons, cards, inputs, typography, and interaction polish.

If you have access to the website codebase, inspect these files first and reuse the existing design language:

- `/Users/patrickoloughlin/Documents/Codex/2026-04-21-i-want-to-do-a-completely/index.html`
- `/Users/patrickoloughlin/Documents/Codex/2026-04-21-i-want-to-do-a-completely/styles.css`
- `/Users/patrickoloughlin/Documents/Codex/2026-04-21-i-want-to-do-a-completely/script.js`

If you do not have access to those files, use the design system below as the implementation reference.

## Core Visual Identity

Good Attic should feel premium, calm, clean, trustworthy, and home-service-specific. The site uses soft off-white backgrounds, dark green-black typography, green glass accents, crisp 8px cards, subtle depth, and strong but restrained CTAs.

Do not make the CRM feel like a generic blue SaaS dashboard. Do not use purple, blue-slate, beige, or loud gradients. Do not use decorative orbs, blob backgrounds, bokeh, or overly rounded pill-heavy UI. Keep it operational, scan-friendly, and premium.

## Design Tokens

Use these exact tokens unless there is a strong technical reason not to:

```css
:root {
  --ink: #17211c;
  --muted: #66736d;
  --line: #d8e2dd;
  --paper: #f6f8f6;
  --white: #ffffff;
  --green: #24715a;
  --blue: #24715a;
  --cyan: #8fd4c0;
  --violet: #a76f38;
  --shadow: 0 24px 80px rgba(23, 33, 28, 0.16);
  --radius: 8px;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
```

Primary surface:

```css
body {
  margin: 0;
  color: var(--ink);
  background: var(--paper);
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
```

## Typography

Use very bold headings, compact labels, and calm readable body text.

- Main page titles: very bold, `font-weight: 850-900`, tight line height around `0.95-1.05`
- Section headings: bold, calm, not marketing-splashy inside the CRM
- Body text: `#66736d`, `line-height: 1.55-1.65`
- Eyebrow labels: uppercase, green, bold, small

```css
.eyebrow {
  color: var(--green);
  font-size: 12px;
  font-weight: 900;
  letter-spacing: 0;
  text-transform: uppercase;
}
```

For CRM page titles, use:

```css
.crm-page-title {
  color: var(--ink);
  font-size: clamp(34px, 4vw, 64px);
  font-weight: 900;
  line-height: 0.98;
  letter-spacing: 0;
}
```

## Layout Rules

The CRM should be dense but not cramped. Think premium operations cockpit, not landing page.

- Use a centered max-width layout similar to the site: `width: min(1180px, calc(100% - 32px))`
- Use full-width page bands only when helpful, not nested cards inside cards
- Keep repeated records as cards, table rows, or panels with clear hierarchy
- Use 8px radius almost everywhere
- Keep spacing rhythm in increments of 8, 12, 16, 24, 28, 40, 56
- Prefer grids and panels over oversized hero compositions

Recommended CRM shell:

```css
.crm-shell {
  min-height: 100vh;
  background:
    linear-gradient(135deg, rgba(36, 113, 90, 0.07), rgba(23, 33, 28, 0) 42%),
    var(--paper);
}

.crm-container {
  width: min(1180px, calc(100% - 32px));
  margin: 0 auto;
}
```

## Header / Navigation

Match the website header treatment:

```css
.crm-header {
  position: sticky;
  top: 16px;
  z-index: 50;
  display: flex;
  min-height: 68px;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px 12px 18px;
  background: rgba(255, 255, 255, 0.82);
  border: 1px solid rgba(217, 225, 232, 0.8);
  border-radius: var(--radius);
  box-shadow: 0 14px 50px rgba(23, 33, 28, 0.1);
  backdrop-filter: blur(18px);
}
```

Logo treatment:

```css
.brand-mark {
  width: 74px;
  height: 42px;
  background: linear-gradient(135deg, var(--ink), var(--green));
  mask: url("assets/good-attic-logo-cropped.png") center / contain no-repeat;
  -webkit-mask: url("assets/good-attic-logo-cropped.png") center / contain no-repeat;
}
```

If the CRM project does not have the logo asset, ask for it or copy it from the website project. Do not replace it with a generic icon.

## Buttons

Primary buttons must use the same dark-to-green gradient as the website.

```css
.button,
.crm-button {
  display: inline-flex;
  min-height: 44px;
  align-items: center;
  justify-content: center;
  padding: 0 18px;
  color: var(--white);
  font: inherit;
  font-weight: 800;
  text-decoration: none;
  cursor: pointer;
  background: var(--ink);
  border: 0;
  border-radius: var(--radius);
}

.crm-button--primary {
  background: linear-gradient(135deg, var(--ink), var(--green));
  box-shadow: 0 10px 24px rgba(36, 113, 90, 0.22);
}

.crm-button--primary:hover {
  background: linear-gradient(135deg, #24302b, #2d8267);
}

.crm-button--secondary {
  color: var(--ink);
  background: transparent;
  border: 1px solid var(--line);
}

.crm-button--light {
  color: var(--ink);
  background: var(--white);
  border: 1px solid var(--line);
}
```

Use icons in CRM action buttons when useful, but do not make icon-only controls mysterious. Use labels or tooltips.

## Cards and Panels

Base card style:

```css
.crm-card,
.feature-card,
.info-tile {
  padding: 28px;
  background: var(--white);
  border: 1px solid var(--line);
  border-radius: var(--radius);
}
```

Premium dark/glass panel style, for important summaries:

```css
.crm-summary-panel {
  color: var(--white);
  background:
    linear-gradient(145deg, rgba(23, 33, 28, 0.94), rgba(18, 44, 37, 0.9)),
    linear-gradient(135deg, rgba(143, 212, 192, 0.16), rgba(36, 113, 90, 0.08));
  border: 1px solid rgba(143, 212, 192, 0.22);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  backdrop-filter: blur(18px);
}
```

Glass dropdown / popover style:

```css
.crm-popover {
  background: rgba(18, 44, 37, 0.82);
  border: 1px solid rgba(143, 212, 192, 0.34);
  border-radius: var(--radius);
  box-shadow: 0 24px 60px rgba(23, 33, 28, 0.24);
  backdrop-filter: blur(16px);
}
```

## Forms and Inputs

CRM forms should match the website contact/modal form fields:

```css
input,
select,
textarea {
  width: 100%;
  min-height: 52px;
  padding: 14px 16px;
  color: var(--ink);
  font: inherit;
  background: #f4f7fa;
  border: 1px solid var(--line);
  border-radius: var(--radius);
}

label span,
.field-label {
  color: var(--ink);
  font-size: 13px;
  font-weight: 800;
}

input:focus,
select:focus,
textarea:focus {
  outline: 2px solid rgba(143, 212, 192, 0.55);
  border-color: rgba(36, 113, 90, 0.45);
}
```

Use compact two-column forms on desktop and single-column forms on mobile.

## CRM-Specific Components To Build In This Style

Create CRM components that inherit the website language:

- Lead pipeline cards with white cards, green status chips, and muted metadata
- Appointment cards with dark summary headers and clear CTA buttons
- Contact profile panels with glassy trust/status summaries
- Tables with white background, `var(--line)` separators, green hover states, and compact row height
- Status chips using green, cyan, muted gray, and warm brown only
- Activity timeline using slim vertical line in `var(--line)` and green markers
- Form side panels using white surfaces and 8px borders
- Important conversion panels using dark green glass panels

Recommended status colors:

```css
.status-chip {
  display: inline-flex;
  min-height: 28px;
  align-items: center;
  padding: 0 10px;
  font-size: 12px;
  font-weight: 900;
  border-radius: 999px;
}

.status-chip--new {
  color: var(--green);
  background: rgba(36, 113, 90, 0.1);
  border: 1px solid rgba(36, 113, 90, 0.22);
}

.status-chip--scheduled {
  color: #216a59;
  background: rgba(143, 212, 192, 0.18);
  border: 1px solid rgba(143, 212, 192, 0.42);
}

.status-chip--warning {
  color: #8c5b2c;
  background: rgba(167, 111, 56, 0.12);
  border: 1px solid rgba(167, 111, 56, 0.28);
}
```

## Data Tables

Use tables only when a CRM workflow benefits from scanning and comparison.

```css
.crm-table {
  width: 100%;
  overflow: hidden;
  background: var(--white);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  border-collapse: separate;
  border-spacing: 0;
}

.crm-table th {
  color: var(--muted);
  font-size: 12px;
  font-weight: 900;
  text-align: left;
  text-transform: uppercase;
  background: rgba(36, 113, 90, 0.05);
}

.crm-table th,
.crm-table td {
  padding: 14px 16px;
  border-bottom: 1px solid var(--line);
}

.crm-table tr:hover td {
  background: rgba(36, 113, 90, 0.04);
}
```

## Motion and Interaction

Use subtle, quick motion:

- Hover lift: `transform: translateY(-2px)`
- Transitions: `180ms ease`
- Reveal animations: `opacity 700ms ease`, `translateY(26px)`
- Avoid excessive animation in CRM workflows

## Mobile Behavior

The website mobile style keeps the brand visible, compresses the header, and preserves the green CTA treatment. For the CRM:

- Mobile header should remain compact and glassy
- Tables should become stacked cards or horizontally scrollable only when unavoidable
- Primary actions should stay reachable
- Avoid hiding key CRM data behind too many tabs

## Design Donts

- Do not use blue SaaS dashboards
- Do not use purple gradients
- Do not use large rounded cards beyond the existing 8px radius unless a pill chip requires it
- Do not use nested cards inside cards
- Do not make a marketing landing page inside the CRM
- Do not invent a new logo treatment
- Do not make the CRM one-note dark green; use off-white surfaces and green accents
- Do not use generic Tailwind defaults if they clash with the Good Attic style

## Acceptance Criteria

The CRM UI is successful if:

- It immediately feels like the Good Attic website, just adapted for internal operations
- Buttons, forms, cards, header, typography, and spacing visibly match the website
- Green gradients, glassy white panels, and dark green summary panels are used consistently
- The CRM remains practical for daily lead, appointment, quote, and job management
- The UI is polished on desktop and mobile
- Text does not overflow buttons, cards, tables, or mobile panels
- The design does not drift into a generic CRM template

Use the existing Good Attic website as the anchor. Extend it carefully. Do not fork the visual language.
