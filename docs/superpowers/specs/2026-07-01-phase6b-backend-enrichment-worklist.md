# Phase 6b — Backend-enrichment worklist

> Auto-generated from the Phase 6a read-wiring workflow (109 shape-gaps). Each item is a design field/endpoint the FE now renders as `—`/empty because the contract or endpoint doesn't yet provide it. Phase 6b builds the read-side backend to fill these; then the wired screens light up with no FE change.

## Users list

- Users list — customer NAME: AdminEndUserListItem has no name field (only email); derived a display name from the email local-part.
- Users list — avatar hue/initials: no avatar colour field; hue derived deterministically from user id, initials from the derived name.
- Users list — Country column: no country field on the list item; rendered as '—' and the country filter cannot match any row.
- Users list — Balance column (NGN): no balance field on the list item; rendered as '—'.
- Users list — Risk flags: only simSwapFlagged (boolean) is modeled; sanctions and velocity flags/columns and their filter chips have no backing field — chips render but match no rows.
- Users list — KYC-status filter: AdminEndUserSearchQuery has no kycStatus param (only status=account-status and kycTier); the KYC-status select filters client-side over the fetched page instead of server-side.
- Users list — Last active: no last-active/lastSeen field; derived a relative label from createdAt (registration time), not true last activity.
- Users list — total count: AdminEndUserListResponse returns items + nextCursor only (no total); header shows 'shown' count + 'more available' instead of a total, and the pager is cursor Prev/Next rather than numbered offset pages.
- Users list — phone search: server query param is a single free-text 'query'; the design's phone-search facet is not separately modeled.

## User detail

- Profile: phone, country, locale, marketing-consent (contract AdminEndUserDetail has none — rendered '—')
- Profile: admin-action timeline has no read endpoint (design seed kept as a mock list for the Phase-7 add-note flow)
- KYC: full NIN/BVN reveal — API only ever surfaces ninLast4/bvnLast4 (deliberate PII-minimization invariant); the 'Reveal' flow toggles a logged-access banner but no full value is fetched
- KYC: identity document images (ID_FRONT/SELFIE) and bank name-enquiry match are not in KycSubmissionDetail (design placeholders kept; name-enquiry panel repurposed to show livenessResult + idDocumentType)
- Wallets: pending balance per asset and a ≈Total(NGN) fiat figure are not in AdminEndUserBalance (only asset/network/amount) — pending line + fiat total omitted
- Wallets: on-chain deposit (child) addresses are not in the aggregate — replaced with a 'not yet available' note
- Transactions: recentTransactions carries only id/type/status/createdAt — the USDT amount + NGN fiat columns have no source (amount cell shows '—', middle column shows createdAt)
- Security tab: PIN status / failed-PIN & OTP lockouts / 2FA and auth SESSIONS have no read endpoint (backend models devices, not sessions) — kept as design mock
- Limits tab: per-user effective limits + current velocity usage have no read endpoint — kept as design mock
- Devices: human device name / fingerprint / per-device sim-swap timestamp are not in AdminEndUserDevice (only id/trustState/isPinned/lastUsedAt/boundAt) — row shows trustState + Pinned + id + lastUsedAt; the header-level simSwapDetectedAt drives a per-row SIM-SWAP chip

## KYC review queue

- KycQueueItem has no `tier` (Requested tier column renders '—')
- KycQueueItem has no SLA-age field (SLA age column renders '—')
- KycQueueItem has no `assignee` field (Assignee column renders '—')
- KycQueueItem has no applicant display name — only `email`; the row name falls back to email (monogram derived from email, avatar hue derived from userId)
- GET /admin/kyc/queue returns ONLY pending_review users with no status-filter param — the Needs info / Approved / Rejected tabs have no backing endpoint (show the empty bucket + '—' count); only the Pending tab is real. Needs a status-filter param on the queue endpoint to feed the other three tabs.
- Tab count badges: only Pending has a real count (from items.length); the other three render '—'.

## Transactions list

- Transactions list — Amount (USDT + NGN fiat leg): AdminTxnListItem has no amount/fiatAmount/fxRate; rendered as —
- Transactions list — Asset (USDT/TRX/USDT→TRX): not on AdminTxnListItem; the amount cell shows no asset
- Transactions list — Idempotency key: only on AdminTxnDetail, not AdminTxnListItem; the idem column + copy-on-click affordance dropped to —
- Transactions list — User display name: AdminTxnListItem exposes only userId (uuid), no human name; the User column shows the truncated userId
- Transactions list — view-tab count pills: no aggregate-count endpoint exists, so the four tabs render without count badges
- Transactions list — free-text search over hash/ref/idem: AdminTxnSearchQuery has no `q` param (only status/type/userId/from/to/cursor/limit), so the search pill filters the loaded page client-side by id only
- Transactions list — pagination: BE is keyset cursor (nextCursor, no total), so the offset-based Pagination primitive was replaced by a design-tokened Prev/Next cursor pager showing 'Page N' instead of 'Showing X–Y of Z'

## Transaction detail

- Transaction detail — itemized economics block: AdminTxnDetail exposes NO amount/fiatLeg/rate/processingFee/fxSpread/internalMargin fields; the entire Itemized-parameters panel renders '—' values until the backend projects an economics block (operator-only margin gated).
- Transaction detail — header amount: no amount/asset on AdminTxnDetail, so the header title shows only the transaction type (design showed '{type} · {amount} USDT').
- Transaction detail — ledger Seq column: AdminTxnLedgerLeg omits the ledger `sequence` field, so the Seq column renders '—' (real sequence exists on AdminLedgerEntry but not projected onto the leg).
- Transaction detail — Blockradar provider reference: no dedicated DTO field (may live in Transaction.metadata as blockradar/depositId); the design's Blockradar ref row is dropped until a metadata projection is added.
- Transaction detail — Webhook history panel: no admin endpoint/contract/client for a per-transaction webhook/event log exists, so the entire Webhook-history panel is omitted (would need a webhook-event store + GET /admin/transactions/:id/webhooks).

## Ledger

- Ledger page — no GLOBAL cross-account ledger list: the design browses ALL accounts by account-TYPE prefix (user/treasury/revenue/float) + currency, but GET /admin/ledger (useLedgerHistory) REQUIRES a full (accountType, accountId, currency) triple scoped to ONE account. Wired to the real per-account endpoint by replacing the type-prefix select with the real LedgerAccountType enum + an explicit account-id input; query stays idle until the triple is complete. Backend enrichment needed: a global ledger-list endpoint (accountType-prefix + currency filter, cursor-paginated, newest-first).
- Ledger page — no server-side keyset pagination: GET /admin/ledger returns a single capped (limit<=500) newest-first slice with no cursor; the design's pager is currently client-side over that returned page. Needs cursor/keyset pagination on the backend to page beyond the first 500 entries.
- Ledger page — Sequence-integrity pill is static: no GLOBAL per-(account,currency) sequence-continuity endpoint exists. The only integrity endpoint (POST /admin/ledger/verify/:transactionId, AdminLedgerIntegrityResult) checks ONE transaction's legs net to zero — not global gap/reorder detection. The header 'Sequence integrity OK' pill remains a static indicator until a global integrity endpoint is built.
- Ledger page — Export (CSV): no GET /admin/ledger/export endpoint/contract/client exists; the Export button remains a toast stand-in (also a Phase 7 write-path item).
- Ledger row — Running-balance currency: AdminLedgerEntry.balanceAfter is a per-account running balance already computed server-side (formatted per the selected currency). The design's own per-currency running-total reduce is no longer needed; if a mixed-currency running view is ever required the endpoint would need to expose it, but the current single-currency-scoped query makes this a non-issue.

## Audit

- Audit log — list: contract exposes flat `actor` string but NO per-actor role (design shows a role sub-line under the actor name); rendered as a subtle em dash. Backend enrichment: carry actor role (or resolve from actorAdminId).
- Audit log — list: contract has NO dedicated `reason` field; the design's Reason column is populated from `details.reason` when present, else em dash. Backend enrichment: add a first-class `reason` to AuditLogEntry or standardize `details.reason`.
- Audit log — verified indicator: there is no permanent 'last-verified' GET; the pill reflects an on-demand POST /admin/audit/verify run on mount. Consider a lightweight GET for a passive badge without triggering a full chain walk each load.
- Audit log — Export (CSV): no export endpoint exists; the Export button remains a toast stub (left as-is per Phase 7 / backend gap).

## Dashboard

- Transaction volume tile — design shows a fiat ₦ money sum; the composite endpoint (DashboardSummary.txnVolume) provides per-type COUNTS + successRate only, no summed fiat notional. Wired the tile to the total transaction COUNT instead; a true fiat-volume figure needs a backend summed-amount aggregation (gap-matrix: Metrics domain, 'Transaction volume KPI tile').
- GMV tile — no backend aggregation exists anywhere (no gmv/grossMerchandise field). Renders '—'. Needs a new repo aggregation summing transaction fiat notionals + a field on RevenueMetrics/DashboardSummary.
- Revenue tile — design labels it 'Revenue (fees + FX)'. RevenueMetrics.totalFeesByCurrency provides fees only; totalSpreadByCurrency is deliberately [] (spread folded into FX rate, not separately ledgered). Relabeled to 'Revenue (fees)' and wired fees only; the '+ FX/spread' portion needs new spread-ledgering.
- Open compliance cases tile — no count in the metrics contract. Renders '—'. useComplianceEvents (compliance domain) can supply an open-count client-side, or add an openCases field to DashboardSummary (gap-matrix classifies as backend-exists-but-not-as-a-metric).
- KYC pending delta 'SLA 4h' and Failed/stuck delta 'attention' are static design copy — no SLA/attention metric backs them (kept as design-consistent static chips).
- Range switcher 24h preset — backend takes date bounds (from/to), so sub-day '24h' maps to a today-only 1-day window (from==to); a true rolling-24h window would need hour-granular metric bounds.

## Sanctions

- screening match — human display name (design shows 'Musa Sani'; SanctionsRecordItem provides only counterpartyId, rendered as the mono name line)
- screening match — matched-list name (design shows 'OFAC SDN'/'EU Consolidated'/'UN Security Council'; contract has only `provider`, reused as the matched-list slot)
- screening match — match-type label (design shows 'Name match'/'Name + DOB'/'Address match'; contract has only `screeningType` string, e.g. name/address, used verbatim)
- screening match — numeric 0–100 confidence score (design's Score slot; SanctionsRecordItem has NO score, so the slot now shows the verdict label Hit/Review/Clear instead)
- Ongoing monitoring toggles (re-screen daily / screen on outbound / PEP alert / auto-block OFAC) — no contract and no read endpoint; policy flags belong in layered AppSetting config, left as design-local controlled useState toggles (mock-only-needs-backend)
- Per-match Clear/Escalate/Block disposition — no disposition mutation exists on immutable SanctionsRecords (Phase 7 write; would need re-homing onto POST /admin/compliance/events/:id/disposition or a dedicated sanctions-disposition endpoint), left as the existing flow-modal → local done-label behavior

## AML & Blocked

- Risk rules: contract AmlRule has no single free-text `threshold` string (design shows one) — composed a display string from the typed `parameters` record; a first-class human-readable threshold field would be cleaner
- Risk rules: no `enabled`/`version` shown in design though contract provides them (intentionally omitted to preserve design)
- Open cases: ComplianceEventItem gives only userId/transactionId (uuids), not the user display names the design shows (e.g. 'Amara Okeke') — rendered a truncated id instead; needs a user-name enrichment
- Open cases: design 'escalated' status has no contract target (ComplianceEventStatus is flagged/under_review/approved/blocked/dismissed) — 'escalated' pill dropped; queue filtered to flagged+under_review
- Open cases: useComplianceEvents takes a single status filter, so open-status narrowing (flagged+under_review) is done client-side over an unfiltered fetch; a multi-status or dedicated open-queue filter would avoid over-fetching
- Travel Rule: the $1,000 threshold shown in the original design copy is a config value (compliance.travelRuleThreshold AppSetting) not in TravelRuleListResponse — rendered generic 'over the reporting threshold' rather than a hardcoded figure; needs a config read to restore the exact number
- Compliance reports: useComplianceReports() named in the task has NO design surface on this screen (the design only has a Draft SAR/CTR write link, classified backend-only-not-surfaced in the gap matrix) — NOT wired to avoid inventing a reports-list card that would violate design-1:1; a reports queue is a Phase 6b/redesign item
- Blocked list (blocked-page.tsx): NO read hook exists in web-admin — the store of record is the compliance.sanctionsDenylist AppSetting (a bare string[]) reachable only via a settings client/hook that does not exist (only getPublicConfig). Left as SEED_ENTRIES mock; needs a settings read client+hook (Phase 6b). Also the denylist string[] has no per-entry reason/added-by/timestamp, so the rich table columns can't be populated from the current setting shape

## Treasury

- Treasury balances: hero card wired to useTreasuryBalances (totalAmount/walletCount/network/asset). NOTE the endpoint returns raw string amounts (e.g. '412908.44') — no grouped/thousand formatting; backend or a shared formatter could pretty-print.
- Exposure-headroom card: TreasuryExposure provides NO single 'headroom %' scalar (only per-asset netExposure + exposureLimitBps + status). The exact '72%' figure the design shows cannot be produced — value now renders the real status label ('safe'/'warning'/'critical') and the dot/note are status-driven. Backend needs a derived headroom = (limit - netExposure)/limit summary field.
- NGN fiat-float card ('₦42,180,500 · 18% of target · low'): NO endpoint. Treasury balances aggregate crypto WalletBalance rows only; fiat float lives in the ledger platform_float account. Renders design-faithful non-live placeholder ('—' / 'No fiat-float endpoint yet'). Needs a platform_float-per-fiat aggregation + a configurable target AppSetting.
- FX-position card ('+$8,240 · Net long USDT vs NGN'): NO backing field on any endpoint. Renders design-faithful non-live placeholder ('—' / 'No FX-position endpoint yet'). Needs a new net-USDT-position-valued-vs-NGN aggregation.
- Low-float/warning banner: the design's hardcoded NGN low-float banner has no endpoint. Banner now surfaces the highest-severity UNACKNOWLEDGED alert from useTreasuryAlerts (real threshold-breach alerts, a different-but-real concept). A dedicated fiat-low-float alert would need the fiat-float aggregation above.
- Child-address sweeps: NO sweep read model. Row ADDRESS is wired from each withdrawal policy's walletId (per the TreasurySweepRow type contract note); per-row on-chain BALANCE and sweep STATUS have no endpoint — rendered as '—' / 'Pending' placeholders. Needs a child-address read model (on-chain balance + last-sweep status).
- Sweep threshold footer ('25 TRX'): no config read on this screen; mirrors the sweep.threshold.trx seed AppSetting. Could be surfaced via the existing /config layer or a treasury endpoint.
- Payout / withdrawal approval queue (3 mock rows + Approve): entirely mock-only, NO backend (no pending-withdrawal queue, no maker-checker approve endpoint). Left design-faithful; Approve write is Phase 7.

## RBAC & admins

- AdminUser has no display name (design shows full names like 'Amara Okeke'); derived from email local-part + avatar initials
- AdminUser.role is {id,name} with no fixed slug or color; role-dot color is hashed from role name into the design palette instead of a per-slug map
- Role permission matrix: design used 7 fixed capability rows x 6 fixed role columns with a curated can() grant; real data is catalog-driven (rows = AdminPermissionRecord categories present, cols = roles present) — semantics preserved (full=any write/delete/execute, read=read-only, none), but the exact fixed row/col set is gone
- AdminMe has no display name (design profile card showed 'Amara Okeke'); shows email local-part as the name line and 'email · role' beneath
- AdminSettings design had NO sessions section (sessions in the design belong to the end-user detail screen); an Active-sessions card was added as an additive read-only card on the operator's own settings, sourced from useSessions() (the operator's OWN console sessions, GET /admin/sessions)

## Notifications & templates

- Template approval status (Approved/Pending/Rejected pill) — NotificationTemplate has no approval/status field; pill omitted
- Notifications delivery log rows (channel/name/audience/time/status + bounce/complaint rates) — no admin delivery-log endpoint/contract; left as design mock (DELIVERY_ROWS)
- Broadcast audience cohorts + their reach counts (Lagos/tier_1/verified/all) — no admin cohort/segment endpoint; left as design mock (AUDIENCE_OPTIONS/AUDIENCE_REACH)

## WhatsApp

- WhatsApp operational health: quality rating, messaging-limit tier, webhook subscription/200-OK status, last-webhook age, 7d template-rejection count — NOT in WhatsAppConfigView; kept as WA_HEALTH_OPERATIONAL mock rows (no read endpoint/contract exists — needs Meta Graph + stored-webhook backend)
- 'Official Cloud API only / ban-risk: low' assurance note is a static string with no computed backing
- WhatsApp Flows registry (per-flow name/desc/live for KYC/itemized-confirm/PIN) — config view exposes only flowId + beneficiaryFlowId, not a per-flow published/live registry; kept as WA_FLOWS mock
- Live conversation monitor (redacted inbound/outbound bubbles) — no WhatsApp conversation-monitor endpoint; kept as WA_CONVO mock
- Design's masked display number (+234 809 •••• 4821) is not in WhatsAppConfigView — omitted; rendered phoneNumberId instead per the contract's only number field

## web-admin/components/admin/agent-page.tsx

- Model & guardrails: 'Structured output', 'Checkpointer', 'PIN + step-up', 'Max tool calls / turn' rows — AgentConfigView contract has no fields for these; kept as static architectural constants (invariant facts, not fetched)
- Model & guardrails: 'systemPromptPreview' IS in the contract but the design's Model card has no row for it — not surfaced (design shows system prompt only via the separate versions card, which is mock-only)
- System-prompt versions card — NO prompt-version endpoint exists in the contract (only a single read-only systemPromptPreview string); all 3 version rows + tones + meta remain design-mock
- Tool registry card — the live typed-tool set is not exposed by any admin endpoint; all read/write tool rows remain design-mock
- Cost & usage (24h) card — no cost/usage/token/conversation-count endpoint; all 4 stat rows (Conversations, Input tokens, Output tokens, Est. cost) remain design-mock. useConversations() exists but returns only a paginated conversation-log LIST (no 24h aggregate counts/tokens/cost), so it does not back this card

## Tickets

- Recent orders: TicketOrderItem has no event/title field — the bold order line renders `ticketType` instead of an event name (mock previously showed 'Afrobeats Live · Lagos'). Needs event/title enrichment or a vendor-event join.
- Recent orders: TicketOrderItem exposes only `userId` (uuid), no user display name — the user cell renders the uuid (mock showed 'Amara Okeke'). Needs a server-side user-name join.
- Recent orders: amount currency is hardcoded to ₦ (NGN) in the FE `formatNgn` — TicketOrderItem carries no currency code; assumed NGN per contract comment.
- Recent orders: `paymentStatus`, `deliveryStatus`, `quantity`, `vendorKey` are on the contract but the design has no cells for them — currently unused (pill maps from `settlementStatus` only).
- Recent orders: cursor pagination (`nextCursor`) is available on the response but the design has no 'load more'/pager — first page only is rendered.
- Vendor ports panel: MOCK-ONLY, no backend. There is NO vendor-port registry endpoint/contract/service — only single settings keys `ticketing.enabled` + `ticketing.commissionBps` (a platform-wide flag+commission, not a per-vendor list with per-vendor live/paused/onboarding status). Needs a new GET /admin/tickets/vendors endpoint + contract to wire.
- Page subheader promises 'event catalog' — BOTH-MISSING: no catalog panel in the design and no events endpoint/entity/service anywhere in admin (effectively a new tickets vertical).
- Page subheader promises 'vendor payout reconciliation' — BOTH-MISSING: no reconciliation panel in the design and no payout-batch/vendor-reconciliation aggregation endpoint or contract.

## Config

- Settings: EffectiveSetting.source is a 2-value enum ('db'|'default') — the design's 3-way DB›ENV›JSON chain tooltip and per-layer values are not backable (no ENV-vs-JSON split). Widen the source enum + expose per-layer values.
- Settings: no 'updated-by admin' attribution on EffectiveSetting — the design's 'by {admin}' meta line was dropped. Add updatedByAdminId/label to the effective-setting shape.
- Pricing: per-capability Min/max column has NO registry key — renders '—'. Needs a limits.<...>.perTx min/max mapping or a dedicated pricing min/max key.
- Limits: 'Weekly max' and 'Single on-chain send max' amount-cap rows have no registry key — render '—'. Add limits.NGN.tier_N.weeklyFiatMax + singleOnchainSendMax.
- Limits: velocity rows 'Sends / 10-min window', 'Cooling-off after tier change', 'New-beneficiary hold' have no per-tier registry key — render '—' (there is only a single global beneficiary.cryptoCoolingOffSeconds). Add per-tier velocity/cooling keys.
- Capabilities: per-row description / bound provider-port / icon / tint are not modeled by the config contract — kept as static presentation keyed by capability id. Consider a capability-registry view exposing provider bindings.
- Capabilities: ticketing-vendor rows (ticketing.eventbrite / ticketing.tix) have no per-vendor registry key (only a single global ticketing.enabled) — omitted from the wired rows. Add per-vendor capability flags + TicketProvider registry.
- Flags: voice_notes.web / voice_notes.whatsapp / beneficiary_flow.whatsapp / kyc.tier_3 have no registry key — kept design-faithful defaults. Add boolean registry keys if these should be flag-gated.
- Flags: the per-cohort / percentage 'rollout' chip is not modeled (config is a single global boolean per key, no cohort/percentage rollout engine) — rollout label stays design-faithful. Needs a targeting/rollout subsystem.
