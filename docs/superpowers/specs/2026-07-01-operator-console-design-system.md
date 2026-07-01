# Operator Console — Design System Spec

**Source of truth:** `web-admin/public/_design/operator-console.html` (a Claude Design `.dc.html`, ~270 KB; template = lines 12–1272, `<style>` = lines 17–34, mock-data `<script>` = line 1273+).
**Purpose:** single source of truth for re-skinning the Next.js 16 admin console (`web-admin/`) to match this design. All values below are extracted verbatim from the file; cited line numbers refer to the source.

> The design tokens must be mapped into `web-admin/app/globals.css` as Tailwind v4 CSS-first tokens (`@theme inline`, oklch or hex). This file describes what to produce; it does not itself change the design.

---

## 0. Design language — executive summary (~300 words)

The console is a **calm, dense, "operations-desk" admin** built on a warm-neutral canvas, not the usual cold gray SaaS. In light mode the page background is a **warm parchment `#f1ede4`** with pure-white cards; the ink is a near-black **forest green `#16261e`** rather than black. The one persistent splash of brand is the **left sidebar rail**, which is a **dark green gradient (`#1a4536 → #0d201a`) in BOTH themes** — it never lightens — carrying a single **amber logo mark** (gradient `#f5a623 → #e8961a` square with an inset dark chip). Amber (`#f5a623`) is the reserved accent: logo, nav badges, primary/"engine-execute" CTAs, KPI hero delta, broadcast button. Everything else is quiet.

**Typography** is two families: **Figtree** for all UI (weights 400–800, heavily using 700/800 for headings and 600 for labels) and **IBM Plex Mono** (`.mono`) for every id, hash, address, amount, key, and code — reinforcing the "these are real records" feel. Numbers use `.tnum` tabular figures. The type scale is compact: page titles 24px/800 with `-0.02em` tracking, section headers 13–14px/800, table headers 11px/700 uppercase `0.04em`, body 12.5–13.5px, eyebrows 10–11px/700 uppercase.

**Chrome shape:** fixed 232px sidebar (70px collapsed) with grouped nav, a 60px top bar holding a `⌘K` global search pill, a pulsing TESTNET environment chip, theme toggle, notification bell, and a striped-avatar role switcher. Content is centered in a `max-width` column (820–1360px per screen) with generous 26/30px padding.

**Signature components:** rounded cards (radius 16px, 1px `--line` border, white/`--card`), status **pills** that map semantically to four muted-surface + accent-text token pairs (`s*`/`t*`), soft toggles, a KPI grid whose first tile is a dark-green "hero," stacked-bar volume charts in green→amber, and a family of **flow modals** (reason → step-up TOTP → engine-execute / maker-checker / PII-reveal) that encode the funds-safety invariants directly into the UI.

---

## 1. Color tokens

Theme is switched by **swapping an inline CSS-variable string** on the root flex container (line 37: `style="…; {{ themeVars }}"`). `themeVars` comes from `tok()` (lines 1433–1437), which returns one of two literal declaration strings based on `state.theme` (`'light'` default, line 1422). `toggleTheme()` (line 1438) flips `state.theme` between `'light'` and `'dark'`. **There is no `data-theme` attribute and no root class** — the variables are set inline. For the Next re-skin, replicate this as a `data-theme="dark"` / `.dark` class on `:root` or `<html>` with the two token sets below (Tailwind v4 `@custom-variant dark`).

Every value is consumed with a hardcoded fallback in markup (e.g. `var(--bg,#f1ede4)`), so the fallbacks equal the light-theme values.

### 1.1 Light theme (default `:root`) — from `tok()` else-branch (line 1436)

| Token      | Value                             | Semantic role                                                 |
| ---------- | --------------------------------- | ------------------------------------------------------------- |
| `--bg`     | `#f1ede4`                         | Page background (warm parchment)                              |
| `--card`   | `#ffffff`                         | Card / panel / top-bar surface                                |
| `--card2`  | `#faf8f2`                         | Sub-surface: table-header row, chips, inset boxes, avatars-bg |
| `--ink`    | `#16261e`                         | Text primary (near-black forest green)                        |
| `--ink2`   | `#57645b`                         | Text secondary (labels, body copy, muted values)              |
| `--ink3`   | `#8b948a`                         | Text tertiary (captions, placeholders, meta, eyebrows)        |
| `--line`   | `#e8e2d5`                         | Border primary (card borders, dividers under headers)         |
| `--line2`  | `#efe9dc`                         | Border subtle (row separators inside cards)                   |
| `--hov`    | `#f3efe6`                         | Hover background (rows, ghost buttons, nav-in-light)          |
| `--field`  | `#faf8f2`                         | Form field / input / textarea background                      |
| `--sok`    | `#e6f3ec`                         | **Success surface** (muted green)                             |
| `--swn`    | `#fbf0da`                         | **Warning surface** (muted amber)                             |
| `--sdn`    | `#fbe9e7`                         | **Danger surface** (muted red)                                |
| `--sif`    | `#e9f0fd`                         | **Info surface** (muted blue)                                 |
| `--tok`    | `#1f8a5b`                         | **Success text/accent** (on `--sok`)                          |
| `--twn`    | `#a86f16`                         | **Warning text/accent** (on `--swn`)                          |
| `--tdn`    | `#cf4a3f`                         | **Danger text/accent** (on `--sdn`)                           |
| `--tif`    | `#3168e6`                         | **Info text/accent / links** (on `--sif`)                     |
| `--shadow` | `0 30px 80px rgba(20,40,32,0.18)` | Overlay/modal drop shadow                                     |

### 1.2 Dark theme — from `tok()` if-branch (line 1435)

| Token      | Value                         | Notes                                       |
| ---------- | ----------------------------- | ------------------------------------------- |
| `--bg`     | `#0e1512`                     | Very dark green-black                       |
| `--card`   | `#161f1a`                     | Card surface                                |
| `--card2`  | `#111814`                     | Sub-surface (also = `--field`)              |
| `--ink`    | `#eef2ec`                     | Text primary                                |
| `--ink2`   | `#9dab9f`                     | Text secondary                              |
| `--ink3`   | `#6c7a70`                     | Text tertiary                               |
| `--line`   | `#242e28`                     | Border primary                              |
| `--line2`  | `#2b352e`                     | Border subtle                               |
| `--hov`    | `#1b241f`                     | Hover background                            |
| `--field`  | `#111814`                     | Field background                            |
| `--sok`    | `#123020`                     | Success surface (deep green)                |
| `--swn`    | `#2e2610`                     | Warning surface (deep amber)                |
| `--sdn`    | `#331b18`                     | Danger surface (deep red)                   |
| `--sif`    | `#152238`                     | Info surface (deep blue)                    |
| `--tok`    | `#3fca8b`                     | Success text/accent (brighter for contrast) |
| `--twn`    | `#e0a53a`                     | Warning text/accent                         |
| `--tdn`    | `#f0776b`                     | Danger text/accent                          |
| `--tif`    | `#7aa2ff`                     | Info text/accent                            |
| `--shadow` | `0 30px 80px rgba(0,0,0,0.6)` | Overlay shadow                              |

### 1.3 Brand constants (NOT theme-swapped — hardcoded literals)

Defined at line 1274: `const GREEN='#1a4536', GREEND='#0e241c', ACC='#f5a623', ACCD='#e8961a';`

| Name                | Value                                                             | Usage                                                                                                                                                                |
| ------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Brand green         | `#1a4536`                                                         | Sidebar gradient top, hero KPI tile, asset chip bg, "Resolve via engine" btn, volume bar (buy), striped avatars                                                      |
| Brand green dark    | `#0e241c` / `#0d201a`                                             | Sidebar gradient bottom (`#0d201a` in the rail, `#0e241c` in tiles/step-up icon)                                                                                     |
| Accent amber        | `#f5a623`                                                         | Logo mark, nav badges, primary CTAs (engine-execute, broadcast), KPI hero delta bg, warn-toast bg, TOTP active box border, dashboard approval dot, volume bar (swap) |
| Accent amber dark   | `#e8961a`                                                         | Logo mark gradient bottom                                                                                                                                            |
| Ink-on-amber        | `#231303` / `#08150e`                                             | Text on amber buttons/badges                                                                                                                                         |
| Near-black button   | `#16261e`                                                         | Secondary dark CTAs ("Add entry", "Invite admin", "Submit for approval", bulk bar, KPI-range active)                                                                 |
| Success-green (raw) | `#37c489`                                                         | ok-toast icon bg (not tokenized)                                                                                                                                     |
| Avatar stripe       | `repeating-linear-gradient(45deg,#2a6f55 0 5px,#1a4536 5px 10px)` | Admin/operator avatars (topbar, admins table, admin-settings)                                                                                                        |
| Env chip            | bg `#fdf3e0`, fg `#8a5a10`                                        | TESTNET environment pill (line 1736) — also the view-as banner `#fdf3e0`/`#8a5a10`/border `#f0e2c4`                                                                  |

**Role dot colors** (`roleMeta()`, lines 1442–1449): super_admin `#f5a623`, compliance_officer `#3168e6`, treasury_ops `#1f8a5b`, support_agent `#8a4b8a`, config_admin `#c07a2a`, read_only_analyst `#8b948a`.

---

## 2. Typography

Fonts loaded via Google Fonts (line 16): **`Figtree`** wghts 400;500;600;700;800 and **`IBM Plex Mono`** wghts 400;500;600.

- Base: `body { font-family:'Figtree', system-ui, sans-serif; -webkit-font-smoothing:antialiased; }` (line 20).
- `.mono { font-family:'IBM Plex Mono', monospace; }` (line 21) — used on every id, hash, address, key, amount, contract, timestamp-seq.
- `.tnum { font-variant-numeric:tabular-nums; font-feature-settings:'tnum' 1; }` (line 22) — applied to all numeric columns/KPIs.

### Type scale (concrete, as used)

| Role                        | Size        | Weight  | Tracking / notes                                             | Example line  |
| --------------------------- | ----------- | ------- | ------------------------------------------------------------ | ------------- |
| Page title (`h1`)           | **24px**    | **800** | `letter-spacing:-0.02em`                                     | 132, 875, 892 |
| Detail-page title (`h1`)    | 21px        | 800     | `-0.02em`, often `text-transform:capitalize`                 | 621, 679      |
| Modal title                 | 17–18px     | 800     | —                                                            | 1168, 1185    |
| KPI number                  | **26px**    | 800     | `-0.02em`, `line-height:1`, `.tnum`                          | 907           |
| Treasury/wallet number      | 21–22px     | 800     | `.tnum .mono`                                                | 522, 814      |
| Section header (card title) | 13–14px     | **800** | —                                                            | 147, 921, 969 |
| Nav group label (eyebrow)   | 10px        | 700     | uppercase, `letter-spacing:0.09em`, `rgba(214,226,219,0.42)` | 55            |
| Nav item label              | 13px        | 600     | —                                                            | 61            |
| Table header cell           | **11px**    | 700     | uppercase, `letter-spacing:0.04em`, `--ink3`                 | 181, 336, 597 |
| Body / cell value           | 12.5–13px   | 600–700 | —                                                            | 138, 1067     |
| Sub-text / meta             | 10.5–11.5px | 600     | `--ink3`                                                     | 138, 194      |
| Eyebrow / field label       | 11px        | 700     | uppercase, `letter-spacing:0.05em`, `--ink3`                 | 219, 1205     |
| Page subtitle (`p`)         | 13.5px      | 400     | `--ink2`                                                     | 132, 893      |
| Status pill text            | 10.5–11px   | 700     | —                                                            | 165, 605      |
| Mono id (inline)            | 11–12px     | 600–700 | `.mono`, often `--ink3` or link-blue                         | 601, 606      |
| `⌘K` / `Esc` keycap         | 11px        | 600     | `.mono`, bordered                                            | 88, 1106      |
| Sidebar brand               | 14.5px      | 700     | `-0.01em`; sub-label 10.5px/600 uppercase `0.06em`           | 45–46         |
| Toast text                  | 13px        | 600     | on `#16261e`                                                 | 1264          |

---

## 3. Spacing / radius / shadows / borders

### Radii (px)

- **Cards / panels: `16px`** (the dominant card radius; e.g. 135, 158, 336). Larger feature cards (dashboard, user header, treasury) use **`18px`** (918, 945, 968) and the user header **`18px`** / modal **`20px`** (1163) / TOTP-icon **`14px`**.
- **Pills / badges / toggles: `999px`** (fully rounded) — status chips, env chip, toggles, avatars.
- **Inputs / search / selects / buttons: `10–11px`** (search 11px line 85; buttons 9–11px; selects 11px).
- **Icon tiles / squares: `7–14px`** — small type icons 7–8px, KPI/asset marks 9–11px, action-icon buttons 8px, logo mark 10px, TOTP boxes 11px.
- **Chips (source/type inline): `6px`** (181 `border-radius:6px`).

### Borders

- Single system border weight: **`1px solid var(--line)`** on every card/panel/topbar.
- Internal row separators: **`1px solid var(--line2)`**.
- Dashed inset (idempotency-key box): `1px dashed var(--line)` (1213).
- Reject buttons use a bespoke danger line `#f0d0cb` (558, 766); discovered-asset card `#cfe0fb`; view-as/low-float `#f0e2c4` / `#f2cfc9`.

### Shadows

- Overlays/modals: `var(--shadow)` (cmdk 1102, notif 1128, role menu 1145) — light `0 30px 80px rgba(20,40,32,0.18)`, dark `0 30px 80px rgba(0,0,0,0.6)`.
- Flow modal: `0 40px 100px rgba(0,0,0,0.4)` (1163).
- Toast: `0 10px 30px rgba(0,0,0,0.25)` (1264).
- Logo mark: `0 2px 8px rgba(0,0,0,0.25)` (42). Toggle knobs: `0 1px 3px rgba(0,0,0,0.25)` (382, 457).

### Common padding / gaps

- Screen wrapper: `padding:26px 30px 60px` (detail pages `22px 30px 60px`), centered via per-screen `max-width` + `margin:0 auto`.
- Card body padding: `16–20px` (most `18px 20px`; list cards `16px 20px`; dense feature cards `20px 22px`).
- Table header/row padding: `11px 18px` (header) / `12–14px 18px` (row), `gap:12px` between grid columns; interactive rows use `min-height:50–52px` + `padding:0 18px`.
- Grid gaps between cards: `14px` (or `16px` on dashboard). Flex gaps in toolbars: `8–10px`.
- Section-to-section: header block `margin-bottom:16px`; filter row `margin-bottom:14px`.

### Animations (`<style>` 27–33)

`hsIn` (fade+8px up), `hsScrim` (fade), `hsPop` (scale 0.94→1), `hsSpin`, `hsToast` (slide-in-right), `hsPulse` (opacity 1↔0.4). `prefers-reduced-motion` kills all durations (line 33). Scrollbars restyled via `.scr` (24–25): 10px, thumb `rgba(120,130,120,0.28)` radius 8, transparent track.

---

## 4. Chrome (measured)

### 4.1 Left sidebar rail (lines 40–78)

- **Width: `232px` expanded, `70px` collapsed** (`sbWidth`, line 1732). `flex:none`, `transition:width 0.18s ease`, `z-index:20`.
- **Background: `linear-gradient(168deg,#1a4536 0%,#0d201a 100%)` in BOTH themes** (dark green, never lightens). Text `#eaf1ec`.
- **Logo mark** (41–42): 34×34, radius 10, `linear-gradient(150deg,#f5a623,#e8961a)`, containing a 13×13 radius-4 `#15241d` inset chip; shadow `0 2px 8px rgba(0,0,0,0.25)`. Beside it: "Handshake Agent" 14.5px/700 + "Operator Console" 10.5px/600 uppercase `rgba(214,226,219,0.55)`. Both hidden when collapsed (`sc-if notCollapsed`).
- **Nav scroll region** (51): `flex:1; overflow-y:auto; padding:6px 10px 14px`.
- **Nav structure** (`navDef()`, lines 1469–1514) — groups render a 10px/700 uppercase `rgba(214,226,219,0.42)` label (hidden when collapsed), then items:

  | Group         | Items (id → label)                                                                                                                                                                                                                            | Notable                                                                 |
  | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
  | Overview      | `dashboard` → Dashboard                                                                                                                                                                                                                       | 4-square grid icon                                                      |
  | Customers     | `users` → Users                                                                                                                                                                                                                               | people icon                                                             |
  | Compliance    | `kyc` → KYC review (badge `kyc`), `sanctions` → Sanctions & screening, `aml` → AML / risk, `blocked` → Blocked list                                                                                                                           | shield / crop / triangle / no-entry icons                               |
  | Money         | `transactions` → Transactions (badge `stuck`), `ledger` → Ledger, `recon` → Reconciliation (badge `recon`), `treasury` → Treasury                                                                                                             | arrows / book / scales / vault                                          |
  | Configuration | `settings` → Settings, `pricing` → Pricing, `limits` → Limits & velocity, `capabilities` → Capabilities, `assets` → Asset catalog, `currencies` → Currency catalog, `providers` → Providers, `templates` → Templates, `flags` → Feature flags | sliders / tag / gauge / plug / coin / coin-₦ / socket / envelope / flag |
  | Channels      | `whatsapp` → WhatsApp, `notifications` → Notifications                                                                                                                                                                                        | chat / bell                                                             |
  | Commerce      | `ticketing` → Ticketing                                                                                                                                                                                                                       | ticket icon                                                             |
  | Agent         | `agent` → Agent config                                                                                                                                                                                                                        | sparkle icon                                                            |
  | Platform      | `admins` → Admins & roles, `audit` → Audit log, `approvals` → Approvals (badge `approvals`), `ops` → System / ops, `adminSettings` → Admin settings                                                                                           | shield-person / list / check / server / gear                            |

  Each group carries a `roles` allow-list (`'*'` or an array) — nav is RBAC-scoped. Icons are 18×18 stroke-1.7 SVG `path` from `it.icon`.

- **Nav item** (58–66): `display:flex; gap:11px; padding:8px 10px; border-radius:10px`; active `it.bg`/`it.fg`, hover `background:rgba(255,255,255,0.07)`. Optional **badge** (63–64): amber pill `#f5a623` / `#231303`, 10.5px/700, radius 999, `padding:1px 7px`, min-width 18.
- **Footer / collapse toggle** (72–77): `border-top:1px solid rgba(255,255,255,0.08)`, a chevron + "Collapse", hover `rgba(255,255,255,0.06)`. `collapseIcon` flips (line 1734).

### 4.2 Top bar (lines 84–114)

- **Height `60px`**, `background:var(--card)`, `border-bottom:1px solid var(--line)`, `padding:0 22px`, `gap:14px`, `z-index:15`.
- **Global search pill** (85–89): opens cmdk; `height:38px`, `max-width:440px`, `flex:1`, `padding:0 12px`, bg `--field`, `border:1px solid --line`, radius 11, `--ink3` text, hover `border-color:#c9c1b0`. Contains search-circle icon, "Search users, tx, tickets…" 13px, and a `⌘K` keycap (mono 11px, `--card` bg, bordered, radius 6).
- **Spacer** `flex:1` pushes the right cluster.
- **Environment chip** (93–95): `height:32px`, radius 999, bg `envBg=#fdf3e0` / fg `envFg=#8a5a10`, 11.5px/800 `letter-spacing:0.05em`, label **TESTNET**, with a 7px `currentColor` dot animated `hsPulse 2.4s`.
- **Theme toggle** (97–99): 38×38 icon button, radius 11, `border:1px solid --line`, `--ink2`, hover `--hov`; sun/moon icon via `themeIcon` (line 1737).
- **Notification bell** (101–104): same 38×38 button; bell icon; **red badge** `#cf4a3f`/`#fff`, 10px/800, radius 999, `border:2px solid --card`, top/right `-4px`, shown when `alertCount`.
- **Role/user switcher** (106–113): pill `height:42px`, hover `--hov`; a 34×34 striped avatar (`repeating-linear-gradient(45deg,#2a6f55 0 5px,#1a4536 5px 10px)`), name 12.5px/700, a role dot (`roleColor`) + role label 10.5px/600, and a chevron. Opens the role menu.
- **View-as banner** (117–122): when `viewAs`, a `#fdf3e0`/`#8a5a10` bar, `border-bottom:1px solid #f0e2c4`, eye icon + "Viewing as <role>" + "Reset to Super Admin" underline link.

---

## 5. Component primitives

### Card / panel

`background:var(--card); border:1px solid var(--line); border-radius:16px` (feature cards 18px). Body `padding:18px 20px`. Tables/lists use `overflow:hidden` on the card and put a `--card2` header row inside. Card title = 13px/800; optional muted suffix `· note` in 600/`--ink3`.

### Table

- **Header row:** CSS grid (`grid-template-columns` per screen), `gap:12px`, `padding:11px 18px`, `background:var(--card2)`, `border-bottom:1px solid var(--line)`; cells 11px/700 uppercase `0.04em` `--ink3`. Numeric headers get `text-align:right`.
- **Body row:** same grid, `padding:12–14px 18px` (or `min-height:50–52px` + `padding:0 18px` for clickable rows), `border-bottom:1px solid var(--line2)`, `align-items:center`. Clickable rows: `cursor:pointer` + `style-hover="background:var(--hov)"`. **No zebra striping** — separation is by `--line2` rules + hover only.
- Cell text 12–12.5px; ids/amounts `.mono`/`.tnum`; secondary values `--ink2`.

### Status badge / chip (pill)

Shape: `display:inline-flex; align-items:center; gap:5px; font-size:10.5–11px; font-weight:700; padding:3px 9px; border-radius:999px; background:{stBg}; color:{stFg}`. Canonical **status→token map** (`stMeta`, lines 1948/2056/2069; `kycMeta` 1829):

| Status                                            | Label               | Surface   | Text     |
| ------------------------------------------------- | ------------------- | --------- | -------- |
| verified / settled / receive→Received / completed | Verified/Settled    | `--sok`   | `--tok`  |
| pending / pending_settlement / settling           | Pending             | `--swn`   | `--twn`  |
| rejected / failed                                 | Rejected/Failed     | `--sdn`   | `--tdn`  |
| needs_info / refunded / refund / info             | Needs info/Refunded | `--sif`   | `--tif`  |
| quoted / initiated (neutral)                      | Quoted/Initiated    | `--card2` | `--ink2` |

A "stuck" pending status adds a pulsing 5px `currentColor` dot (`hsPulse 1.6s`, line 605). Small inline chips (source/type) use radius `6px` + `--card2`/`--ink2`.

### Button variants

- **Primary amber CTA:** `background:#f5a623; color:#231303; font-weight:800`, radius 11–12 (engine-execute 1219, broadcast 223).
- **Primary dark CTA:** `background:#16261e; color:#fff; font-weight:700–800` ("+ Add entry" 179, "Invite admin" 281, "Submit for approval" 1239). Green variant `#1a4536`/`#fff` ("Resolve via engine" 506) and `#1f8a5b`/`#fff` (Approve 558).
- **Secondary / ghost:** `border:1px solid var(--line); background:var(--card); color:var(--ink); font-weight:700`, hover `var(--hov)` (Export, Test connection, Cancel).
- **Danger ghost:** `border:1px solid #f0d0cb; color:var(--tdn)`, hover `var(--sdn)` (Reject 558, 766).
- **Text/link button:** `color:var(--tif); font-weight:700; cursor:pointer` (Remove, Run now, Open ledger →).
- **Icon button:** 28–38px square, radius 8–11, bordered, `--ink2`, hover `--hov`.
- Sizes: standard button `height:36–38px, padding:0 13–15px`; inline row actions `padding:7–9px 12–16px`.

### Input / select / search field

- Search field (85, 334, 578, 594, 1026): `height:38px; padding:0 12px; background:var(--field or --card); border:1px solid var(--line); border-radius:11px`, contains a 15px search icon + borderless transparent `<input>` 13px.
- Select (219, 470, 1031): `height:38–40px; padding:0 30px 0 12px; background:var(--card or --field); border:1px solid var(--line); border-radius:10–11px; font-weight:600; appearance:none` with an inline SVG chevron data-URI at `right 10px center`.
- Textarea (1173): `min-height:92px; resize:vertical; border:1px solid var(--line); border-radius:12px; padding:12px 14px; background:var(--field)`.

### Tabs

Two styles: (a) **pill tabs** with count badge — `height:36px; padding:0 14–16px; border-radius:10px; font-weight:700; border:1px solid {line}; background:{bg}; color:{fg}` + inline count pill (KYC 877, Approvals 543, Tx-views 592, Limits-tiers 358). (b) **underline tabs** on user-detail — `padding:10px 15px; font-weight:700; border-bottom:2px solid {line}`, in a horizontally-scrollable strip under a `border-bottom:1px solid --line` (699–702).

### KPI stat card (dashboard 903–913)

Grid `repeat(4,1fr)` gap 14. Each tile radius 16, `padding:16px 17px`. **Tile 0 is the "hero"** (line 1778): `background:linear-gradient(150deg,#1a4536 0%,#0e241c 100%)`, ink `#fff`, sub `rgba(214,226,219,0.7)`, delta chip `#f5a623` bg / `#0e241c` text. Non-hero tiles: `--card` bg, `--ink`, delta chip `--sok`/`--tok` (or `--swn`/`--twn` when `warn`). Structure: label 12px/600, value 26px/800 `.tnum`, then a delta pill 11px/700 + note. KPI range switcher (895–899): segmented control in a `--card` box radius 11 padding 3; active segment `#16261e`/`#fff`, inactive transparent/`--ink2`.

### Bar / spark visualizations

- **Stacked volume bars** (930–941): `height:180px` flex row `gap:5px`; each bar is a `flex:1` column-reverse stack of 5 segments with fixed colors **buy `#1a4536`, sell `#2a6f55`, send `#5a9b7a`, swap `#f5a623`, ticket `#e8b96a`** (legend 925–927, values 1797), 3px end-radii. Axis labels 10px `--ink3`.
- **Velocity progress bars** (865): `height:8px; border-radius:6px; background:var(--card2)` track with a colored fill (`{v.bar}`) at `width:{pct}`.
- **Health dot** (953): 8px dot with `box-shadow:0 0 0 3px {halo}` glow; spinner uses a `hsSpin` bordered circle.

### Pagination (shared, 1083–1094)

Pulled up under tables (`margin:-42px auto 0`), `border-top:1px solid --line2`. Left: count label 12px `--ink3` `.tnum`. Right: Prev / numbered pages / Next as 32px-tall radius-9 bordered buttons; active page `{n.line/bg/fg}`; disabled Prev/Next via `opacity`.

### "sc-for" repeated-row pattern

`<sc-for list="{{ rows }}" as="x" hint-placeholder-count="N">` iterates a data array into a row template; `{{ x.field }}` interpolates. Boolean sub-blocks use `<sc-if value="{{ x.flag }}">`. In React this becomes `rows.map(...)` with the same per-row derived style props (`bg`, `fg`, `line`, `icon`, `onTap`). The mock-data logic (line 1273+) is illustrative only — ignore it; keep the markup shapes.

### Toasts (1261–1269)

Bottom-right stack, `gap:9px`. Each: `background:#16261e; color:#fff; padding:11px 15px; border-radius:12px; box-shadow:0 10px 30px rgba(0,0,0,0.25)`; a 20px icon square tinted by kind (`ok`→`#37c489`, `info`→`#3168e6`, `warn`→`#f5a623`, text `#08150e`) + message 13px/600. Animates `hsToast`, auto-dismiss 2600ms (line 1523).

### Dialogs / drawers / overlays

- **Command palette** (1100–1123): fixed scrim `rgba(12,24,18,0.42)` + `backdrop-filter:blur(2px)`, centered at `padding-top:12vh`; panel 600px, radius 16, `var(--shadow)`, `hsPop` in. Header input 15px + `Esc` keycap; results grouped with uppercase group labels, each row an icon tile + label + mono sub + kind; empty state centered.
- **Notification drawer** (1126–1140) & **role menu** (1143–1156): anchored `position:absolute; top:56px; right:20px`; widths 380 / 320; `var(--shadow)`; grouped rows with hover `--hov`.
- **Flow modals** (1161–1259): scrim `rgba(10,20,15,0.55)` + `blur(3px)`, centered; panel `{flowWidth}` max 94vw / 90vh scroll, radius 20, shadow `0 40px 100px rgba(0,0,0,0.4)`. Five step variants share the frame:
  - **Reason** (1166): blue icon tile, "recorded in immutable audit log" copy, reason-category chips, textarea, Cancel / Continue.
  - **Step-up TOTP** (1182): dark-green gradient lock icon, 6 digit boxes (active box border `#f5a623`), on-screen keypad, Cancel.
  - **Engine action** (1198): green "executed by the settlement engine" banner, itemized-effect table, ledger-entries-to-be-written table, dashed idempotency-key box, Cancel / amber execute CTA.
  - **Maker-checker** (1225): amber icon, "enters Pending approval" copy, from→to diff table, Cancel / dark "Submit for approval".
  - **PII reveal** (1244): red icon + `--sdn` warning, "access logged" copy, Cancel / dark "Continue to step-up".

### Empty states

Centered block inside the card: 44px rounded icon tile (success uses `--sok`/`--tok`), title 14px/700, sub 12.5px/`--ink3` (Approvals "Inbox zero" 545, KYC 881, Users 1059–1060, Tx 598, cmdk 1119).

### Toggles (switches)

Track `width:46–52px; height:26–30px; border-radius:999px; background:{track}`; knob absolute `top:3px; left:{knobLeft}; 20–24px; border-radius:50%; background:#fff; transition:left 0.15s` (+shadow on the larger 52px variant). Used for monitoring flags, capabilities, feature flags, preferences.

---

## 6. Per-screen layout (all 30 page-flags)

Each screen is gated by a boolean `p<Name>` flag and rendered inside the scrolling screen area (line 126). Wrapper: `data-screen-label="…"` + `max-width` + `margin:0 auto` + `padding:26px 30px 60px` (detail pages `22px…`). Header pattern: `h1` 24px/800 + `p` 13.5px/`--ink2` subtitle.

1. **Dashboard** (`pDash`, 888) — "Operations overview". KPI-range segmented control (24h/7d/30d). Grid of 4 KPI tiles (tile 0 = green hero). Then a `1.7fr 1fr` row: stacked-bar **Transaction volume** chart (14 bars, 5-cap legend) + **System health** card (provider list with latency + halo dots, plus webhook-queue / recon-drift stat boxes). Bottom `1fr 1fr`: **Live activity** feed (icon + text + meta + time) and a column of **Approvals awaiting me** + **Alerts** cards.

2. **Users** (`pUsers`, 1012) — "Users". Header shows total/shown counts + Export CSV. Filter row: search input + `uFilters` selects (KYC, tier, country) + risk chips. Optional dark **bulk bar** when rows selected (Export/Tag/Message/Clear). Table columns: checkbox · Customer (avatar+name+email) · KYC (pill+tier) · Country · Balance (right) · Risk (flag chips) · Last active. Rows clickable → user detail. Shared pagination.

3. **UserDetail** (`pUserDetail`, 669) — back-link "All users". Header card: avatar, name, FROZEN/KYC-tier pills, mono id (copyable), flag chips, and RBAC-scoped action buttons (`uActions`). Horizontally-scrollable **underline tabs** (`uTabs`, 9). Optional red PII-revealed banner with auto-remask countdown. Tab bodies: **Profile** (Contact & locale + Admin action timeline w/ + Add note); **KYC** (identity docs w/ NIN reveal, BVN "encrypted at rest", ID/selfie placeholders, name-enquiry match; Review-decision panel Approve/Request-info/Reject + Tier controls); **Devices** (bound devices, SIM-swap badge, Unbind + identity-model note); **Security** (PIN & auth, Reset-PIN step-up; Active sessions + Revoke all); **Wallets** (3 balance tiles incl. dark USDT hero; on-chain child addresses + manual credit); **Beneficiaries** (bank/USDT rows w/ name-enquiry status); **Transactions** (compact tx rows); **Chat** (read-only redacted transcript w/ intent→proposal chips); **Limits** (effective limits w/ OVERRIDE tags + velocity progress bars).

4. **KYC review** (`pKyc`, 873) — "KYC review queue". Status tabs w/ counts (`kycTabs`). Table: Applicant (avatar+name+id) · Requested tier · SLA age (colored) · Assignee · Review→. Empty-bucket state. Rows → user-detail KYC tab.

5. **Sanctions & screening** (`pSanctions`, 130) — screening match cards (red triangle icon, name, matched list/type, Score, Clear/Escalate/Block actions or done-label) + an **Ongoing monitoring** card of toggle rows.

6. **AML / risk** (`pAml`, 154) — `1.2fr 1fr` grid: **Risk rules** (maker-checker thresholds w/ edit) | **Open cases** (dot+title+status pill, "Draft SAR/CTR") + **Travel Rule records** summary card.

7. **Blocked list** (`pBlocked`, 177) — "+ Add entry" dark CTA. Table: Type (chip) · Value (mono) · Reason · Added by/when · Remove link. Note: entries are superseded, never deleted.

8. **Transactions** (`pTxns`, 588) — master ledger. View tabs (`txViews`) w/ counts + search (id/hash/ref). Table: ID (link-blue mono) · Type (icon+capitalized) · User · Amount (right, USDT + fiat) · Status (pill, pulsing dot if stuck) · Idempotency key (mono) · Created. Empty state; rows → tx detail.

9. **TxDetail** (`pTxDetail`, 615) — back-link. Title `{type} · {amount}` + status pill + copyable id; action buttons (`txActions`, RBAC/engine-brokered: retry/refund/mark-failed). `1.15fr 1fr` grid: left = **Itemized parameters** (as confirmed to user; margin-is-operator-only note) + **Double-entry ledger** mini-table (Account/Dir/Amount/Seq, "Open ledger →"); right = **Engine state timeline** (vertical stepper), **Provider references** (label+mono val+copy+external link), **Webhook history** (dot+event+time).

10. **Audit log** (`pAudit`, 568) — "Hash-chain verified" pill + Export. Search (actor/target/action). Table: Actor (name+role) · Action (mono chip) · Target (mono) · Before→after (strike-red → green) · Reason · Time. Immutable, nothing hard-deleted.

11. **Ledger** (`pLedger`, 463) — "Sequence integrity OK" pill. Filter selects + Export. Table: Seq (mono) · Account (mono) · Dir (colored) · Amount (right mono) · Running (right) · Source (link). Advisory-locked per (account,currency).

12. **Reconciliation** (`pRecon`, 482) — cron status bar (last/next run, open-breaks count, Run now). Break cards (severity pill, tx link, delta, "engine-brokered · never a raw debit" note, Escalate/Accept/Resolve-via-engine) or Resolved state. Over-credits flagged, never auto-debited.

13. **Treasury** (`pTreasury`, 517) — optional low-float warning. 4 balance cards (`treasuryCards`, custodial/float/FX). `1.5fr 1fr` grid: **Payout/withdrawal approval queue** (to/ref/method/amount, maker-checker tag on large, Approve) | **Child-address sweeps** (addr/bal/status + sweep threshold 25 TRX).

14. **Alerts** — no dedicated `pAlerts` screen; alerts surface via the **notification drawer** (`notifOpen`, 1126) opened from the bell, and the Dashboard **Alerts** card (997). (The bell badge count is `alertCount`.)

15. **Admins & roles** (`pAdmins`, 279) — "+ Invite admin". Admin table: Admin (avatar+name+email) · Role (dot+label) · 2FA · Status pill · actions (Reset 2FA / Deactivate). Below: **Role permission matrix** (scrollable grid, 6 role columns × capability rows, cells = full-access/read-only/no-access icon tiles) + legend.

16. **AdminSettings** (`pAdminSettings`, 318) — "Admin settings". Profile card (52px avatar, name, email, "2FA enrolled" pill). **Preferences** card: Theme toggle row (`themeName`) + `prefRows` toggle rows.

17. **Agent config** (`pAgent`, 252) — "Tools propose, never execute." `1fr 1fr`: **Model & guardrails** (read-mostly key/val) | **System-prompt versions** (dot+version+tag, maker-checker). Then `1.4fr 1fr`: **Tool registry** (mono name + read/write kind chip) | **Cost & usage (24h)**.

18. **Notifications & comms** (`pNotifications`, 212) — `1fr 1.3fr`: **Broadcast composer** (Audience/Template/Schedule selects, large-audience maker-checker warning, amber send CTA) | **Delivery log** (channel chip + name + audience/time + status pill; bounce/complaint footnote).

19. **Templates** (`pTemplates`, 443) — `1fr 1fr` grid of template cards: channel chip + mono name + approval pill; locale/vars line; body preview in `--card2` box. Email (Resend) + WhatsApp approved templates.

20. **WhatsApp** (`pWhatsapp`, 188) — `1fr 1fr`: **Number & webhook health** (key/val + "Official Cloud API only" success note) | **Flows (E2E encrypted)** (lock-icon rows + Live pills). Below: **Live conversation monitor** (read-only redacted chat bubbles).

21. **Ticketing** (`pTicketing`, 235) — `1fr 1.4fr`: **Vendor ports** (mono name + commission + status pill) | **Recent orders** (event/id · user · amount · status).

22. **Pricing** (`pPricing`, 343) — per capability×asset×currency. Table: Capability (mono) · Asset/ccy · Spread · Fee · Min/max · **Effective rate preview** (user-sees rate + amber margin) · Edit. Versioned, maker-checker; margin operator-only.

23. **Asset catalog** (`pAssets`, 390) — "Sync Blockradar catalog" + last-sync line. Optional **Newly discovered** `--sif` card (Review & add). Table: Asset (green chip+sym+name) · Chain · Decimals · Min/max · Contract (mono, copy) · Live toggle-pill.

24. **Currency catalog** (`pCurrencies`, 411) — Table: Currency (symbol chip+code+name) · Symbol · Rounding (dp) · Name-enquiry (colored) · Live toggle-pill.

25. **Capabilities / service registry** (`pCapabilities`, 374) — "Master switchboard." Full-width rows: icon tile + mono capability label + status pill + desc/port + a 52px kill-switch toggle. Toggling = maker-checker.

26. **Limits & velocity** (`pLimits`, 354) — tier tabs (`tierTabs`). `1fr 1fr`: **Amount caps · {tier}** (key/val + edit) | **Velocity & counts · {tier}** (key/val). Maker-checker.

27. **Providers** (`pProviders`, 422) — `1fr 1fr` provider cards: mark + name/kind + status·latency pill; optional MOCK-MODE amber banner; masked API-KEY row w/ "Reveal · step-up"; bound-caps + Test connection. Below: **Mock → live readiness checklist** (check icon rows).

28. **Feature flags** (`pFlags`, 453) — full-width flag rows: mono key + desc + rollout chip + `eval →` + 52px toggle. Per-cohort/percentage rollout.

29. **System / ops** (`pOps`, 298) — "Provider board…". `repeat(5,1fr)` provider status tiles (dot+name+latency+status). `1fr 1.2fr`: **Webhook queues** (mono name + depth/retries + status) | **Background jobs & cron** (name + schedule/last + status pill + Run now).

30. **Settings** (`pSettings`, 331) — "Every tunable key. Effective value resolves DB-admin › ENV › JSON." Key-search. Table: Key (mono + type/by) · Effective value (mono) · Source (chain-tooltip chip) · Description · Edit (styled per editability). DB-layer edits enter maker-checker then hot-reload.

> **Screen count = 30**, matching the 30 `p<Name>` flags at lines 130–1012. The nav exposes 24 destinations; the extra 6 are sub/detail routes reached by navigation: **UserDetail**, **TxDetail** (drill-downs), plus **AdminSettings** (Platform group) and the config-group screens all present. There is **no standalone `pAlerts` screen** — "Alerts" is the notification drawer/dashboard card; the prompt's 30-name list maps 1:1 to the flags with "Alerts" ≙ the notifications surface.

---

## 7. Re-skin implementation notes (for `web-admin/`)

- **Tokens → `web-admin/app/globals.css`** as Tailwind v4 CSS-first (`@theme inline`) variables; expose the two theme sets via `.dark` / `@custom-variant dark`. Keep names 1:1 with §1 (`--bg`, `--card`, `--ink`, `--sok`/`--tok`, …) so component classes read like the source.
- **Fonts:** load Figtree + IBM Plex Mono (next/font). Map `.mono` → a `font-mono` utility, `.tnum` → `font-variant-numeric: tabular-nums` utility.
- **Do not lighten the sidebar in dark mode** — it is a fixed brand gradient in both themes.
- **Status pills** must be a single primitive taking a semantic status → the `s*`/`t*` token pair in §5. **No hex literals** in components (CLAUDE.md §5) except the intentional brand constants (`#1a4536`, `#f5a623`, `#16261e`, avatar stripe) which should themselves become named tokens (`--brand-green`, `--brand-amber`, `--btn-dark`).
- **Four async branches** (loading/error/empty/data) are already implied by the empty-state + list patterns above.
- The `sc-for`/`sc-if`/`{{ }}` runtime and the `<script data-dc-script>` mock data are **not** part of the design — translate the markup shapes to React components; ignore the seed logic.
