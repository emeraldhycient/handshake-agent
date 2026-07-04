# Go-Readiness & Hardening Program

Living backlog for the pre-launch hardening effort. Each item has a **current state**
(from a code audit — 2026-07-04), **gaps**, **priority**, **effort**, **acceptance
criteria**, and **approach**. Every fix lands as a commit/PR on this repo so it is
auditable. Funds-safety invariants (root `CLAUDE.md` §3) are binding on every item.

**Status legend:** ⬜ not started · 🟡 in progress · ✅ done · 🔀 spun off (separate session)

**Verification bar (every item):** code + tests (TDD where logic changes) + **visual
evaluation in the running app** + gates green (`lint`/`typecheck`/`test`/`depcruise`).

---

## Quick wins (done)

### ✅ Dashboard revenue card showed a negative value — `f4ec01f`
`platform_float` fee legs are booked as debits (negative) so per-tx legs net to zero;
the revenue metric summed the raw signed amounts → `−(fees)`. Negated the per-currency
sum in `MetricsReadRepository.revenue()`; fixed two e2e specs that had seeded fees as
*positive credits* (the reason the bug escaped) to seed the production sign. Verified:
dashboard shows **Revenue (fees) NGN 600** (was negative); metrics e2e 8 green.

---

## Backlog

### 1. Compliance sub-pages (sanctions & screening, AML/risk, blocked list) — ✅ (verify + 1 gap)
- **State:** Fully wired to real data. Dispositions (Clear/Escalate/Block), AML-rule
  edits, blocked add/supersede (append-only), report draft/submit — all real endpoints,
  step-up-gated, immutably audited, four async branches present.
- **Gap:** the "ongoing monitoring" toggles are seeded from config but have no write
  endpoint (client-only). Small.
- **Do:** add `POST /admin/compliance/monitoring` (step-up + audit) to persist the flags
  as `AppSetting`; wire the toggle. **Effort: S.**
- **Accept:** toggling ongoing-monitoring persists across reload; audited.

### 2. Treasury — ⬜ add operator write controls
- **State:** Read surface is complete & live (custodial USDT, NGN float vs target, FX
  position, exposure headroom, payout queue, sweeps, alert banner). Payout "Approve"
  raises a four-eyes change request (does not release funds — correct).
- **Gaps:** no runtime config for float target / low-float threshold / exposure limit /
  sweep threshold (all hardcoded or DB-only); no manual sweep trigger; `fiatReserve` not
  surfaced; no ledger drill-down.
- **Do:** `POST /admin/treasury/config/:key` (step-up + audit) writing `AppSetting`
  overlays for `treasury.fiatFloatTargets`, `treasury.lowFloatThresholdBps`,
  `treasury.sweepThresholdTrx`, exposure limits; a Treasury Config panel; surface
  `fiatReserve`; a per-account ledger drill-down. Manual-sweep = **engine-brokered only**
  (never a raw balance write, §3.1). **Effort: M.**
- **Accept:** operator changes each threshold from the console (persisted, hot-reloaded,
  audited); reserve balance visible; drill-down lists the composing ledger legs.

### 3. Reconciliation — ⬜ persist breaks + history
- **State:** Sound & funds-safe. Detects over-credit / duplicate-credit / amount-mismatch
  / missing-settlement from `CompensationRecord` + `SettlementOutbox`; over-credits are
  flagged for humans, never auto-debited (`moved:false`). Resolve/accept/escalate are
  Phase-7 wired.
- **Gaps:** breaks are re-projected each read (status transitions not persisted → no
  closed/historical view); cron fixed at 2 min (not runtime-tunable); escalate opens a
  compliance case with no closure link; no per-break timeline.
- **Do:** persist a `ReconciliationBreak` entity (open→resolved/accepted/escalated with
  actor+reason+timestamp); add a history/closed read + filter; make the cadence a config
  key; link escalate→case. **Effort: M.**
- **Accept:** a resolved break stays resolved across reads; history view + timeline;
  cadence tunable from config.

### 4. Transaction details page — ⬜ finish stubs + profit rollup
- **State:** Read-wired. Action buttons present & correctly categorized: Retry / Mark-failed
  / Recon = engine-brokered; Refund = four-eyes; **Resend receipt = stub (no backend)**.
  `fxSpreadBps` IS in the schema and rendered (with fallback); internal margin shown
  operator-only.
- **Gaps:** Resend-receipt stub; `fxSpreadBps` may be null for some tx types (confirm the
  engine populates it on buy/sell/send/swap, else backfill); no per-tx profit rollup
  (fee + realized spread margin as one line).
- **Do:** implement Resend receipt (regenerate + re-send via the notifications/receipt
  path, engine-brokered, audited) or remove the affordance; ensure `fxSpreadBps` is
  populated for every money-moving type; add a per-tx **profit** line (fee + realized
  spread). Depends on #5. **Effort: S–M.**
- **Accept:** every money-moving tx shows a non-null fx spread + a profit line; receipt
  action works or is gone.

### 5. Spread / processing-fee collection + accurate profit tracking — ⬜ (foundational)
- **State:** Processing fee is **accurately recorded** (explicit `platform_float` leg).
  **Spread margin is implicit** — folded into the FX rate, never ledgered; profit is
  therefore *estimated*, not derived. No profit/revenue reporting endpoint; no
  `platform_revenue` account.
- **Do:** record realized spread as an explicit ledger entry at settlement (a
  `platform_revenue` or extended `platform_float` leg keyed to the tx), so profit =
  Σ(fees) + Σ(spread) is **derived** not reverse-engineered; add a profit/revenue read
  (per currency, per capability, per range) feeding the metrics + tx-detail rollup.
  Keep double-entry balanced (§3.1). This is the backbone for #4 and the metrics profit
  tile in #7. **Effort: M. Priority: HIGH (unblocks accurate money reporting).**
- **Accept:** spread appears as a real ledger leg; a profit endpoint returns derived
  fee+spread per currency; tx-detail + dashboard read from it.

#### Design (worked out 2026-07-04 — implement next, strict TDD)
**Chosen approach:** derive profit from the authoritative `Quote` snapshots (safe,
accurate, ZERO change to the settlement double-entry ledger pre-launch). Recording an
explicit `platform_revenue` ledger leg is a documented *future* option (correct accounting,
higher money-path risk) — deferred.

**Linkage:** `Transaction (status=completed, createdAt in range) → proposalId → Proposal
→ Quote`. Each `Quote` carries `type`, `fiatCurrency`, `fiatAmount`, `cryptoAmount`,
`fxRate` (effective), `baseRate` (mid), `processingFeeAmount`. All money via exact BigInt
(`toScaled`), never floats.

**Per-tx components (fiat), verified against `quote-pricing.ts` + `proposal.service.ts`:**
- **BUY** — quote `fiatAmount` is GROSS (includes fee). `netFiat = fiatAmount −
  processingFeeAmount`. `fee = processingFeeAmount`. `spread = netFiat −
  cryptoAmount×baseRate`.
- **SELL** — quote `fiatAmount = netFiatAmount` (NET, post-fee). `fiatBeforeFee =
  fiatAmount + processingFeeAmount`. `fee = processingFeeAmount`. `spread =
  cryptoAmount×baseRate − fiatBeforeFee`.

**Gaps this closes (discovered in audit):** the current `revenue()` counts only BUY fees
(the `platform_float` legs) — it MISSES **sell fees** and **all spread**. Replace it with
the Quote-derived aggregation so `totalFeesByCurrency` = Σ fees (buy+sell) and
`totalSpreadByCurrency` = Σ spread (buy+sell); `profit = fees + spread`. (This supersedes
the `f4ec01f` platform_float negate as the fee source — that fix keeps the card correct in
the interim.)

**Steps:** (1) new `profit()`/extended `revenue()` on `MetricsReadRepository` with the join
+ per-type math; (2) contract shape for profit per currency + capability; (3) admin metrics
endpoint + service; (4) dashboard profit tile + tx-detail per-tx profit line (#4); (5)
e2e (Testcontainers) seeding buy+sell quotes/proposals/completed txns with known
baseRate/fxRate and asserting exact fee/spread/profit; unit for the pure per-tx math.

### 6. Capabilities / service registry — ⬜ ticketing extensibility
- **State:** Crypto capability kill-switches (buy/sell/send/swap) toggle via maker-checker
  + step-up, persisted to config, gated backend-side. Providers registry exists.
- **Gaps:** ticketing has only a single flat `ticketing.enabled`; **no `TicketProvider`
  port**, no per-vendor registration/toggle, no vendor-status endpoint; capability
  presentation metadata is hardcoded in the FE.
- **Do:** define a `TicketProvider` port (mirroring Blockradar/Flutterwave), a
  vendor-scoped `TicketingConfig`, per-vendor registry keys + a status endpoint, and
  config-drive the FE presentation so adding a vendor = implement port + register (no
  caller changes, root §7). **Effort: M.**
- **Accept:** a second ticketing vendor can be registered + toggled from the console with
  zero FE/caller edits; backend gates per-vendor.

### 7. Platform metrics — ⬜ enterprise-grade oversight (biggest)
- **State:** Has txn volume (per-type, daily series, success rate), GMV (per currency),
  revenue (fees, now positive), KYC funnel, active users, service health. **No charts**
  (no charting lib), only 7/30/90d presets, all-currency aggregate, no export.
- **Gaps (vs the ask):** user growth rate, churn rate, profit/margin (needs #5), failed-jobs
  KPI, jobs-enqueued/queue-depth, per-service / per-currency / per-tier filters, custom
  date range, **graphs**, **exportable per-area (selectable)**.
- **Do:** add a charting lib (inline-only where CSP applies), line/bar/area charts for
  revenue/GMV/active-users/profit over time; churn + growth + failed-jobs + queue-depth
  metrics; a filter bar (range picker, currency, capability, tier); a per-area export
  (CSV/what to include selectable). Profit tile depends on #5; queue metrics depend on
  the webhook/queue work (spun off). **Effort: L. Priority: HIGH (explicitly emphasized).**
- **Accept:** each requested metric present with a graph; filters work; operator exports a
  chosen subset.

### 8. Admin multi-currency readiness + tracking — ⬜
- **State:** 8 fiats defined (only NGN enabled); pricing/limits/velocity/compliance are
  already per-currency in schema + config; admin console can price/limit per currency
  (done earlier). Missing: per-currency **tracking** (volume/balance/velocity views) and a
  cohesive enable-a-market flow.
- **Do:** per-currency metrics views (#7 filter); verify enabling a market has all
  prerequisites (base rate + limits + travel-rule + tier limits) with a guarded flow;
  widen the Prisma `FiatCurrency` enum as markets go live. **Effort: M.**
- **Accept:** operator can see per-currency volume/balance and safely enable a new market.

### 9. User default-currency + user settings page (web app) — ⬜
- **State:** Web settings page is largely **static** (profile read-only; PIN/biometric/lang
  are UI-only). Balances use the global `defaultFiat()`. `User` has no `preferredCurrency`.
- **Do:** (a) add `User.preferredCurrency` (migration, default NGN); on signup auto-set by
  region/metadata (phone country-code → fiat map), fallback NGN when unsupported;
  (b) `PATCH /profile` to change it; balance/quote reads honor it; (c) implement the
  settings page for real — currency picker, PIN change, device/biometric, notification
  prefs — each wired to real endpoints with the four async branches. **Effort: M–L.**
- **Accept:** a new user in Ghana defaults to GHS (or NGN if unsupported), can change it in
  settings, and balances re-display in it; settings page fully functional.

### 10. Complete staging / go-readiness audit + fix — ⬜
- After the above land: a full pass (env/secrets, mock-mode flags off, fail-closed guards,
  idempotency, webhook signature verification, rate limits, error surfaces, seed/migration
  integrity, i18n/currency, a11y) with a checklist and fixes. **Effort: M. Runs last.**

---

## Newly reported (2026-07-04 — queued AFTER the current #5→#10 list)

### 11. Platform-wide currency formatting — ⬜
No consistent money formatting across the platform. Implement a single canonical
formatter (symbol/decimals per currency, grouping, locale) used by BOTH `web/` and
`web-admin/` (and any receipt/notification text) — no ad-hoc `₦`+`toLocaleString`.
Ties into #9 (user display currency) and #7/#8 (per-currency metrics display).
**Effort: M** (shared util in `contracts` or each app's `lib` + swap every call site).

### 12. Dashboard figure tracking assumes NGN (multi-currency) — ⬜ (part of #7/#8)
Admin dashboard KPI tiles (GMV, revenue, profit) render/aggregate as if every tx is
Naira. The data layer IS per-currency (GMV/revenue return `byCurrency`), so this is a
DISPLAY/aggregation bug: show per-currency (or a currency selector), never sum across
currencies as one figure. Fold into #7 (metrics filters) + #8 (multi-currency tracking)
+ #11 (formatting). **Effort: M.**

### 13. System health tracking not working (dashboard + System/Ops) — ⬜ bug
The "System health" panel (dashboard) + the System/Ops page don't reflect real
provider/health state. Investigate `AdminMetricsOpsService` / the health/probe source and
the FE panel; wire real provider status (mock/ok/down/degraded + latency) and job/queue
health. **Effort: S–M.** (Overlaps the spun-off webhook queue-depth + the capabilities
vendor-status endpoint #6.)

### 14. Admin console header search bar doesn't work — ⬜ bug
The global search pill (⌘K / "Search users, tx, tickets…") in the admin header is
non-functional. Wire it to a real search endpoint (users / transactions / tickets) or the
command palette with real navigation. **Effort: S–M.**

---

## Spun-off tracks (separate sessions, own worktrees — audit their PRs)
**Status (2026-07-04): all three LAUNCHED and running independently** — task_c1880f4f
(webhook), task_cd9019b9 (security), task_738da713 (PWA/SEO/WCAG). Audit their PRs when
they land.

### 🔀 A. Webhook module → durable queue + console replay
Move every inbound webhook (Blockradar, Flutterwave, WhatsApp, swap) onto a durable queue
(persist raw payload + signature + headers on receipt, ack fast, process async with
retries/backoff + DLQ), all **recorded** and **retryable from the admin console**. Ready
for scale. Preserve signature verification + idempotency (§3.5). Feeds the metrics
queue-depth/failed-jobs tiles (#7).

### 🔀 B. Cybersecurity pentest + fix (authorized, own codebase)
Critical security review of this repo (authN/Z, admin RBAC bypass, IDOR, injection,
SSRF, secrets, webhook forgery, PIN/step-up, rate-limit/DoS surface, dependency CVEs).
**Authorized, defensive, static-analysis + code-level fixes only** — no attacks on live
infra, no destructive tooling. Findings ranked; a sub-agent applies fixes; each fix
tested. Lands as PR(s).

### 🔀 C. SEO + WCAG + PWA (installable) on the web app
(a) SEO (metadata, Open Graph, sitemap, robots, structured data, perf/Core-Web-Vitals);
(b) WCAG 2.1 AA (semantics, focus, contrast, aria, reduced-motion); (c) **installable PWA**
(manifest + service worker; offline shell) so users install on mobile/desktop without app
stores — an unobtrusive install affordance (icon + hover/click modal) and a `/?download`
route that renders a QR to the install page.

---

## Recommended sequence
1. **#5 profit tracking** (foundational — unblocks accurate #4, #7, #8 money reporting).
2. **#7 metrics** (explicitly emphasized; enterprise-grade with charts/filters/export).
3. **#2 treasury controls**, **#3 recon persistence**, **#4 tx-detail finish**.
4. **#9 user currency + settings**, **#8 multi-currency tracking**, **#6 capabilities**.
5. **#1 monitoring toggle** (small, fold in), then **#10 staging audit** last.
6. Spun-off **A/B/C** proceed in parallel in their own sessions.
