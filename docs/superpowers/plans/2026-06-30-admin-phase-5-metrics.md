# Admin Dashboard — Phase 5 (Dashboards & Metrics) Plan — FINAL

> REQUIRED SUB-SKILL: subagent-driven-development / executing-plans. TDD, frequent commits.

**Goal:** A date-ranged operational dashboard: transaction volumes & success rates, revenue (spread + fees — the company margin, admin-only), KYC funnel, active users, and per-service health. Read-only aggregations behind an admin metrics service; web-admin dashboard with simple token-styled visualizations.

**Architecture:** A `MetricsReadRepository` doing Prisma `groupBy`/raw SQL aggregations over Transaction/LedgerEntry/User/KycProfile; an `AdminMetricsService` exposing the metrics; an `admin-metrics.controller` (RBAC `Metrics` read), date-range params; a web-admin dashboard page rendering metric cards + simple CSS/SVG bar visualizations (no new chart dependency — keep tokens-only). Revenue is admin-only (spread stays hidden from end-users — that invariant is unchanged; this surfaces it only to operators).

## Global Constraints
- Read-only — no mutations; `Metrics` read permission (default-deny). Revenue (spread + fees) is shown ONLY here (admin), never on any end-user surface. (task brief)
- Aggregations exact (scaled-BigInt / Decimal for money sums; no float drift on revenue). Date ranges bounded (cap window, e.g. ≤ 366 days). Cross-boundary shapes from contracts. depcruise clean. Strict TDD on the aggregation correctness.

## Tasks
### 1 — contracts + permissions
- `admin-metrics.dto.ts`: `MetricsRangeQuerySchema`={from:string,to:string} (ISO dates; coerce/validate); `MetricsBucketSchema`={date:string,count:number}; `TxnVolumeMetricsSchema`={byType:z.array(z.object({type:string,count:number,completed:number,failed:number})),series:z.array(MetricsBucketSchema),successRate:number}; `RevenueMetricsSchema`={totalFeesByCurrency:z.array(z.object({currency:string,amount:string})),totalSpreadByCurrency:z.array(z.object({currency:string,amount:string})),txnCount:number}; `KycFunnelMetricsSchema`={byStatus:z.array(z.object({status:string,count:number})),byTier:z.array(z.object({tier:string,count:number}))}; `ActiveUsersMetricsSchema`={activeInRange:number,newInRange:number,totalUsers:number}; `ServiceHealthMetricsSchema`={services:z.array(z.object({service:string,total:number,completed:number,failed:number,successRate:number}))}; `DashboardSummarySchema`={txnVolume:TxnVolumeMetricsSchema,revenue:RevenueMetricsSchema,kycFunnel:KycFunnelMetricsSchema,activeUsers:ActiveUsersMetricsSchema,serviceHealth:ServiceHealthMetricsSchema}.
- `permissions.ts`: api_route `GET /admin/metrics/dashboard` read, `GET /admin/metrics/transactions` read, `GET /admin/metrics/revenue` read, `GET /admin/metrics/kyc-funnel` read (category `Metrics`); web_page `/admin/metrics` (Metrics) + menu_item `menu.metrics` (Metrics). Grants `Metrics:['read']` to ALL non-super built-in roles (ops/compliance/finance/support) — dashboards are broadly visible. Update spec.

### 2 — api metrics repo + service + controller
- NEW `metrics-read.repository.port.ts` (`METRICS_READ_REPOSITORY`) + Prisma impl (bind locally in AdminModule or a small metrics module):
  - `transactionVolume(from,to)`: groupBy type + status counts (completed/failed); daily series (count by date); overall successRate = completed/(completed+failed).
  - `revenue(from,to)`: sum processing-fee + spread legs from `LedgerEntry`/`Transaction` for COMPLETED txns in range, grouped by currency — use the `platform_float`/`treasury` fee legs OR the Transaction fee fields/metadata; exact Decimal/BigInt. (Inspect how fees/spread are posted to the ledger — `platform_float` credits = fee revenue; spread is folded into the fx — derive from the buy/sell fee legs. If spread isn't separately ledgered, compute fees from the processing-fee legs and label spread as best-effort/0 with a note.)
  - `kycFunnel()`: count Users grouped by kycStatus + by kycTier.
  - `activeUsers(from,to)`: distinct userIds with a Transaction in range (active) + Users created in range (new) + total Users.
  - `serviceHealth(from,to)`: per type (buy/sell/send/swap) total/completed/failed + successRate.
  Integration specs (testcontainers): seed txns/users across dates → assert each aggregation.
- `AdminMetricsService` (compose the above into the contract shapes) + `admin-metrics.controller` (the routes; date-range DTO via createZodDto; default range = last 30 days when omitted; cap window ≤ 366 days). e2e: seed data → GET /admin/metrics/dashboard returns sane aggregates.

### 3 — web-admin dashboard
- `lib/api/metrics.ts` + hooks (`useDashboardMetrics(range)`); `app/page.tsx` (the existing dashboard stub) OR a `app/metrics/page.tsx` — render: a date-range picker (last 7/30/90 days presets), summary cards (txn count, success rate, revenue by currency, active users), a txn-volume bar series (CSS/SVG bars, tokens-only), a KYC-funnel bar, a service-health table with success-rate bars. 4 async branches. Make the home dashboard (`app/page.tsx`) link to / embed the key cards. Vitest: cards render from mock metrics; range change refetches.

### 4 — gate
- Full `pnpm typecheck`/`test`/`depcruise`; admin e2es green. Update memory. **This completes the entire admin dashboard (Phases 0–5).**

## Self-review
- Read-only; revenue admin-only (spread invariant intact); exact money sums; date-range bounded. Covers spec §6 Phase 5 (volumes/success/revenue/KYC-funnel/active-users/service-health). No new chart dep (CSS/SVG). If spread isn't separately ledgered, fees are exact and spread is noted — surfaced, not silently wrong.
