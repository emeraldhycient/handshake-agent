# Backlog — Handshake Agent (end to end)

Ordered, dependency-aware tickets to build the product from zero to launch. Read [`README.md`](README.md) first — the **Definition of Done** there (TDD, clean architecture, contracts-first, server-side gating, full auditability, idempotency, config discipline) applies to **every** ticket below and is not repeated per-ticket. Format: `[ ] **ID — Title** · size · deps`.

---

## Phase 0 — Foundation & audit spine

Goal: a running, observable, configurable monorepo where every later change is testable, gated, and **auditable from day one**.

### 0A · Workspace & platform config

- [ ] **FND-01 — Activate the pnpm workspace** · S · deps: —
      Run the CLAUDE.md §11 bootstrap: install root + per-package deps, commit `pnpm-lock.yaml`.
      AC: `pnpm install` clean; `pnpm build/lint/typecheck/test/depcruise` green in CI on Node 22.
- [ ] **FND-02 — Prisma baseline** · M · deps: FND-01
      `PrismaService` (connect/shutdown hooks), base `schema.prisma`, first migration, Testcontainers integration harness.
      AC: migrate dev + deploy work; only `infrastructure` imports the generated client; an integration test runs against a Testcontainers Postgres.
- [ ] **FND-03 — Env validation at boot** · S · deps: FND-01
      Zod env schema; invalid/missing required vars fail startup. AC: boot throws with a clear message on bad env; typed `ConfigService<Env>`.
- [ ] **FND-04 — Layered ConfigService (DB-admin › env › JSON)** · M · deps: FND-02, FND-03
      JSON defaults + env + `AppSetting` table merged by precedence; hot-reload with cache invalidation. AC: a setting changed in DB takes effect without redeploy; precedence covered by tests.
- [ ] **FND-05 — Service/capability registry + feature flags** · M · deps: FND-04
      Each capability (`crypto.buy/sell/send/swap`, `ticketing.<vendor>`) registered behind a provider port and gated by an admin flag from layered config. AC: flipping a flag enables/disables a capability; adding a provider = implement port + register, no caller change.
- [ ] **FND-06 — Public `/config` endpoint** · S · deps: FND-05
      Effective, non-secret flags for the web (cached). AC: returns only non-secret flags; reflects DB-admin changes.

### 0B · Cross-cutting HTTP & runtime

- [ ] **FND-07 — Global validation + error filter** · S · deps: FND-01
      `ZodValidationPipe` global; exception filter with a problem-details error shape. AC: invalid body → 422 with field errors; uncaught → normalized 500 (no stack leak).
- [ ] **FND-08 — Security middleware + throttling** · S · deps: FND-01
      helmet, CORS, `ThrottlerModule` (named throttlers, ms ttl). AC: headers present; per-route limits enforced.
- [ ] **FND-09 — Structured logging + correlation ids** · S · deps: FND-01
      pino logger; correlation-id middleware; PII/secret redaction. AC: every request log carries a correlation id; tokens/PINs never logged.
- [ ] **FND-10 — Health + graceful shutdown** · S · deps: FND-02
      liveness/readiness; shutdown hooks. AC: readiness fails when DB down.
- [ ] **FND-11 — Observability baseline** · M · deps: FND-09
      OpenTelemetry traces + metrics; starter dashboards. AC: a request is traceable end-to-end; key metrics exported.
- [ ] **FND-12 — Containerization** · M · deps: FND-01
      Dockerfiles (api, web, agent worker) + docker-compose (Postgres, Redis, apps). AC: `docker compose up` boots the stack locally.
- [ ] **FND-13 — CI hardening** · S · deps: FND-01
      Per-layer coverage gates, depcruise, e2e, build. AC: PR fails on coverage drop or boundary violation.
- [ ] **FND-14 — Outbox + durable async worker** · M · deps: FND-02, FND-12
      Outbox table + BullMQ/Redis worker (used by notifications, channels, settlement). AC: enqueued jobs survive restart; at-least-once + idempotent handlers.
- [ ] **FND-15 — Secrets management** · S · deps: FND-03
      Secret-manager wiring (env in dev, manager in prod); rotation-friendly. AC: no secret in code/logs; rotation documented.

### 0C · Audit spine (everything auditable)

- [ ] **AUD-01 — Immutable hash-chained audit log** · M · deps: FND-02
      Append-only `AuditLog` with prev-hash chaining (tamper-evident). AC: records are immutable; chain verifiable; no update/delete path.
- [ ] **AUD-02 — Audit event taxonomy + contract** · S · deps: AUD-01, FND-09
      `AuditEvent` shape (actor, subject, action, before/after, correlation, ts) in contracts. AC: typed taxonomy; shared by all domains.
- [ ] **AUD-03 — Audit interceptor/decorator** · M · deps: AUD-02
      Use-case-level helper so every mutation records an event; required in review. AC: a mutation without an audit write fails review; covered by tests.
- [ ] **AUD-04 — Audit query/read API** · S · deps: AUD-01
      Filter by actor/subject/action/time (backs the admin viewer). AC: paginated, access-controlled reads.
- [ ] **AUD-05 — Chain-integrity job** · S · deps: AUD-01
      Daily hash-chain verification + anomaly alert. AC: tamper is detected and alerted.

---

## Phase 1 — Identity, auth, admin & RBAC

Goal: real users with KYC + PIN + step-up, and a **separate admin platform** with granular, role-based, fully-audited control.

### 1A · Regular-user identity & auth

- [ ] **IDN-01 — User table + provisional accounts** · M · deps: FND-02
      Regular `User` (separate from admin), provisional-account creation from first contact. AC: provisional → verified lifecycle; unique constraints.
- [ ] **IDN-02 — Verified email + backup phone capture** · S · deps: IDN-01
      Capture/verify an out-of-band fallback identifier (email and/or backup phone) per ADR-0004. AC: verified email stored; used by notification failover.
- [ ] **IDN-03 — Sessions** · S · deps: IDN-01
      JWT issue/refresh/revoke. AC: revoked tokens rejected; refresh rotation.
- [ ] **IDN-04 — Device binding** · S · deps: IDN-01
      `Device` entity + binding + trust state. AC: new device requires step-up.
- [ ] **IDN-05 — Transaction PIN** · M · deps: IDN-01
      Set/change (Argon2id), verify, rate-limit, lockout. AC: never stored/transmitted in plaintext; lockout after N failures.
- [ ] **IDN-06 — Step-up authentication** · M · deps: IDN-03, IDN-05
      Challenge for sensitive actions (new beneficiary, large/first-time transfer, credential/device change). AC: sensitive endpoints require a fresh step-up.
- [ ] **IDN-07 — SIM/number-change handling** · M · deps: IDN-04, IDN-06
      Detect number change → re-verification + step-up; phone is a routing key only. AC: a swapped number cannot transact without device + PIN.
- [ ] **IDN-08 — Beneficiaries** · M · deps: IDN-06
      Add/label/remove payout accounts + crypto addresses; step-up on add; first-use cooling-off. AC: first-use friction enforced; audited.
- [ ] **IDN-13 — Account recovery** · M · deps: IDN-06, IDN-09
      Lost device/PIN recovery with strong step-up + KYC re-check. AC: recovery cannot bypass KYC/device guarantees; fully audited.

### 1B · KYC & tiers

- [ ] **IDN-09 — KYC provider port + adapters** · L · deps: IDN-01
      NIN/BVN + ID-document + liveness (vendor TBD) behind a port. AC: provider swappable; raw KYC secrets segregated.
- [ ] **IDN-10 — KYC state machine + tiers** · M · deps: IDN-09
      NotStarted→Pending→PendingReview→Verified/Rejected/Expired + tier model. AC: transitions enforced + audited.
- [ ] **IDN-11 — Tier limits + velocity caps (config)** · S · deps: IDN-10, FND-04
      Limits/velocity as DB-admin config read by the engine. AC: limit change applies without deploy.
- [ ] **IDN-12 — Server-side KYC gate guard** · S · deps: IDN-10
      Reusable guard returning `403 { error: kyc_required, verification_url }` on every money endpoint. AC: a money endpoint without the gate fails review.

### 1C · Admin platform & RBAC

- [ ] **ADM-01 — admin_users table + super-admin seed** · M · deps: FND-02
      Separate `admin_users` (distinct from `User`); bootstrap a super-admin. AC: admin identities never mix with user identities; seed idempotent.
- [ ] **ADM-02 — Admin auth + session** · M · deps: ADM-01
      Login distinct from user auth; admin session. AC: user tokens can't access admin; admin tokens can't access user money endpoints.
- [ ] **ADM-03 — Admin MFA (TOTP)** · M · deps: ADM-02
      Enrolment + mandatory enforcement. AC: admin login requires MFA; recovery codes.
- [ ] **ADM-04 — Permission catalog (routes + pages)** · M · deps: FND-02
      Registry of resource+action permissions covering API routes **and** web pages/menu items. AC: every protected route/page maps to a permission; catalog is the single source.
- [ ] **ADM-05 — Roles + role↔permission assignment** · M · deps: ADM-04
      Admin can create/edit a `Role` and assign which routes and which pages it can access. AC: role changes audited; assignment validated against the catalog.
- [ ] **ADM-06 — Authorization guard + `/admin/me/permissions`** · M · deps: ADM-05
      Server-side route+action enforcement; endpoint returns the caller's effective permissions (drives FE page/menu gating). AC: unauthorized route → 403; FE gating is UX-only, server is authoritative.
- [ ] **ADM-07 — Admin invitation flow** · M · deps: ADM-05, NTF-03
      Invite by email→role → signed single-use token → accept → create `admin_user` bound to role → first-login MFA enrolment. AC: token single-use + short TTL; invite/accept fully audited.
- [ ] **ADM-08 — Admin-action audit binding** · S · deps: AUD-03, ADM-02
      Every admin mutation requires a reason and writes before/after to the audit log. AC: an unaudited admin mutation fails review.
- [ ] **ADM-09 — Admin lifecycle management** · S · deps: ADM-05, ADM-08
      Suspend/disable/rotate-role/offboard admins. AC: all transitions audited; offboarded admin loses access immediately.

---

## Phase 2 — Wallets, pricing & treasury

### 2A · Wallets & custody

- [ ] **WAL-01 — WaaS provider port** · M · deps: FND-05
      provision/address/balance/signing-policy behind a port (provider TBD). AC: provider isolated; mockable.
- [ ] **WAL-02 — Wallet provisioning** · M · deps: WAL-01, IDN-10
      Provision custodial wallets on KYC-verified (USDT/BTC, TRON). AC: wallets created idempotently; provider ref stored.
- [ ] **WAL-03 — Address management** · S · deps: WAL-02
      Surface deposit addresses (read-only). AC: addresses validated; safe to display after link.
- [ ] **WAL-04 — Balance reads** · S · deps: WAL-02
      Cached balances with sensible staleTime. AC: consistent with provider; no plaintext keys.
- [ ] **WAL-05 — Deposit/receive detection** · M · deps: WAL-02, FND-14
      Provider webhook or chain watcher → confirmation events. AC: confirmed deposit emits an event idempotently.
- [ ] **WAL-06 — Withdrawal controls / allow-listing** · M · deps: WAL-02
      Policy hooks for withdrawals. AC: out-of-policy withdrawal blocked + audited.

### 2B · Pricing, quotes & treasury

- [ ] **QTE-01 — Live FX rate provider** · M · deps: FND-05
      Replace `ConfigRateProvider` with a live feed behind the port. AC: rate source swappable; stale-rate guard.
- [ ] **QTE-02 — Quote engine (buy/sell/swap)** · M · deps: QTE-01, FND-04
      Spread + processing fee from config; full breakdown. AC: pricing math unit-tested to 100%.
- [ ] **QTE-03 — Quote persistence + validity window** · S · deps: QTE-02, FND-02
      Persist quote + bounded TTL; re-validate on execute. AC: stale quote rejected at execution.
- [ ] **QTE-04 — Treasury exposure + alerts** · M · deps: QTE-01, AUD-02
      Track exposure vs limits; threshold alerting. AC: breach alerts; exposure auditable.
- [ ] **QTE-05 — Pricing breakdown contract** · S · deps: QTE-02
      Shared itemized-pricing shape for confirmation + receipt. AC: one schema used by engine + receipt.

---

## Phase 3 — Execution engine & receipts

### 3A · Deterministic execution engine

- [ ] **TXN-01 — Proposal + Transaction + ledger** · M · deps: QTE-03, WAL-02, FND-02
      Proposal model, Transaction entity, state machine, ledger. AC: states enforced; ledger balanced.
- [ ] **TXN-02 — Engine pipeline core** · L · deps: TXN-01, IDN-05, IDN-06, IDN-11, IDN-12, AUD-03
      Re-validate → balance/velocity/limit/sanctions/AML checks → itemized confirmation → PIN+step-up → idempotent execute → audit. AC: no path moves money without confirmation + PIN + idempotency; 100% covered.
- [ ] **TXN-04 — Payment processor port + adapter** · L · deps: FND-05, FND-14
      Flutterwave collect/payout + webhook + reconciliation. AC: webhook verified; reconciliation idempotent.
- [ ] **TXN-03 — Buy (fiat→crypto)** · M · deps: TXN-02, TXN-04
      Collect fiat, credit wallet. AC: failure rolls back cleanly; receipt emitted.
- [ ] **TXN-05 — Sell (crypto→fiat)** · M · deps: TXN-02, TXN-04
      Debit wallet, payout to verified method. AC: payout idempotent; audited.
- [ ] **TXN-06 — Send (on-chain)** · M · deps: TXN-02, WAL-01
      Address validation/checksum, first-time-address warning, idempotent broadcast. AC: no double-send; irreversibility guards enforced.
- [ ] **TXN-07 — Swap (asset→asset)** · M · deps: TXN-02, WAL-01
      Phase-1 scope. AC: quote→confirm→execute path covered.
- [ ] **TXN-08 — Transaction history + signed audit trail** · S · deps: TXN-01, AUD-01
      Ledger/history read API + per-txn signed trail. AC: every txn reconstructable from audit.
- [ ] **TXN-09 — Settlement outbox + compensation** · M · deps: TXN-02, FND-14
      Reliable settlement, retry, compensation. AC: no double-settle under retries.

### 3B · Receipts

- [ ] **RCP-01 — Receipt model + numbering** · S · deps: TXN-01
      Immutable receipt linked to txn + audit; sequential numbering. AC: receipts immutable + unique.
- [ ] **RCP-02 — Itemized renderer (HTML + PDF)** · M · deps: RCP-01, QTE-05
      Deterministic, multilingual rendering. AC: byte-stable for the same input; renders per supported language.
- [ ] **RCP-03 — Signed/verifiable receipts** · S · deps: RCP-01, AUD-01
      Hash + signature. AC: receipt authenticity verifiable.
- [ ] **RCP-04 — Receipt storage + retrieval** · S · deps: RCP-01, FND-12
      Store + access-controlled retrieval API. AC: only owner/authorized admin can fetch.
- [ ] **RCP-05 — Receipt delivery hook** · S · deps: RCP-02, NTF-01
      Emits a notification event on receipt generation. AC: delivered via the notification system.

---

## Phase 4 — Notifications & compliance ops

### 4A · Notification system

- [ ] **NTF-01 — Notification domain + dispatch pipeline** · M · deps: FND-14, AUD-02
      Event taxonomy + `Notification` model + outbox dispatch. AC: events enqueued + tracked.
- [ ] **NTF-02 — Channel provider abstraction** · S · deps: NTF-01
      `NotificationProvider` port. AC: channels pluggable.
- [ ] **NTF-03 — Email adapter** · S · deps: NTF-02
      Resend/SES. AC: delivery status captured.
- [ ] **NTF-04 — SMS adapter** · S · deps: NTF-02
      Africa's Talking/Twilio. AC: E.164 normalized; status captured.
- [ ] **NTF-05 — In-app/web channel** · S · deps: NTF-02
      Persist + SSE push. AC: unread state; replay on reconnect.
- [ ] **NTF-06 — WhatsApp template channel** · S · deps: NTF-02, CHN-06
      Uses the WhatsApp sender + approved templates. AC: out-of-window sends use templates only.
- [ ] **NTF-07 — DB-admin editable templates** · M · deps: NTF-01, FND-04
      Multilingual templates + variable rendering, editable by admin. AC: template change applies without deploy.
- [ ] **NTF-08 — Failover routing** · M · deps: NTF-03, NTF-04, NTF-06
      WhatsApp→email/SMS on undeliverable/restriction. AC: a failed WhatsApp send reroutes; no critical event lost.
- [ ] **NTF-09 — Preferences + non-disableable events** · S · deps: NTF-01, IDN-01
      Per-user/per-event prefs; critical events can't be disabled. AC: prefs honored except for non-disableable set.
- [ ] **NTF-10 — Delivery tracking + idempotent sends** · S · deps: NTF-01
      Status + retries; one send per logical event. AC: no duplicate notifications.

### 4B · Compliance & monitoring

- [ ] **AUD-06 — Sanctions screening** · M · deps: FND-05
      OpenSanctions/TRM port + adapter on counterparties. AC: screening on every transfer counterparty; hits flagged.
- [ ] **AUD-07 — AML / transaction monitoring** · M · deps: AUD-02, QTE-04
      Rule + velocity engine feeding the execution engine. AC: rules configurable; flags audited.
- [ ] **AUD-08 — Travel Rule capture** · M · deps: TXN-02
      Originator/beneficiary data on qualifying transfers. AC: data captured + stored per policy.
- [ ] **AUD-09 — Compliance review queue** · M · deps: AUD-02, ADM-06
      `ComplianceEvent` + queue + disposition (admin-consumed, RBAC-gated). AC: every flag has a disposition trail.
- [ ] **AUD-10 — SAR/STR record-keeping** · S · deps: AUD-09
      Record + export. AC: exportable, immutable record.

---

## Phase 5 — Agent & channels

### 5A · Agent / NLU

- [ ] **AGT-01 — Channel + intent contracts** · S · deps: —
      Extend intent envelope (`language`, `rawUserText`); tool I/O schemas in contracts. AC: schemas shared; parsed at boundaries.
- [ ] **AGT-02 — Agent core + ports** · M · deps: AGT-01
      `LlmProvider` + `ToolGateway` ports; framework-agnostic core (no Nest/Prisma; depcruise enforced). AC: core imports zero Nest/Prisma.
- [ ] **AGT-03 — AnthropicLlmProvider** · S · deps: AGT-02
      `claude-opus-4-8` adapter; key from env. AC: the only place ChatAnthropic appears.
- [ ] **AGT-04 — Intent derivation** · M · deps: AGT-02
      `withStructuredOutput(IntentSchema)` + language detection + numeral normalization. AC: emits validated intent; never executes.
- [ ] **AGT-05 — Typed tool layer** · M · deps: AGT-04, TXN-01
      Read-only tools return data; side-effecting tools build proposals only. AC: no tool executes money directly.
- [ ] **AGT-06 — InProcessToolGateway** · S · deps: AGT-05
      Calls application services; swappable for extraction. AC: extraction = binding swap.
- [ ] **AGT-07 — Agent tests with fake LlmProvider** · S · deps: AGT-04
      Deterministic, no real API. AC: full agent-core coverage offline.

### 5B · Channels & conversations

- [ ] **CHN-01 — channels abstraction** · M · deps: AGT-01
      Inbound/Outbound ports + ChannelMessage/ConversationReply + registry (contracts). AC: add a channel = 2 ports + register.
- [ ] **CHN-03 — Identity linking** · M · deps: IDN-01
      Contact/ChannelIdentity + resolver (phone→contact→User). AC: unlinked contact resolvable; never auto-authorizes.
- [ ] **CHN-02 — Conversations core** · L · deps: CHN-01, AGT-06, CHN-03
      Identity-keyed shared thread; `handleInbound`; agent via AgentPort (channel stripped); reply/Flow/handoff decision; unlinked-contact gating. AC: thread continues across channels; unlinked contact gets product-info/handoff only.
- [ ] **CHN-04 — Handoff token** · M · deps: CHN-03, IDN-03
      CSPRNG, hash-at-rest, short TTL, single-use, redeem→cookie, no-referrer. AC: token unusable twice; never in logs.
- [ ] **CHN-05 — WhatsApp inbound** · M · deps: FND-14
      Webhook GET verify + POST raw-body X-Hub-Signature-256 HMAC + dedup on wamid + fast-ack + durable enqueue. AC: bad signature → 401; duplicates ignored; 200 < 5s.
- [ ] **CHN-06 — WhatsApp outbound + policy** · M · deps: CHN-05, NTF-08
      Graph sender; 24h-window/template policy at edge; failure state machine (131047/131026). AC: out-of-window → template/defer; never a crypto commerce object.
- [ ] **CHN-07 — WhatsApp Flows endpoint** · L · deps: CHN-05, IDN-09, TXN-02
      RSA-decrypted in-thread KYC/confirmation/PIN data-exchange. AC: PIN/KYC only via encrypted Flow; engine settles server-side.
- [ ] **CHN-08 — Web adapter (SSE)** · M · deps: CHN-02, IDN-03
      Authenticated chat inbound + SSE outbound + persist/replay. AC: web works fully independent of WhatsApp.
- [ ] **CHN-09 — Per-number rate limit** · S · deps: CHN-05
      After verify+dedup, before the agent call; tunable via AppSetting. AC: floods throttled before any paid agent call.
- [ ] **CHN-10 — No-channel-leak enforcement** · S · deps: CHN-02
      depcruise rule + test that `channel` never reaches AgentPort/engine. AC: a leak fails CI.

---

### 5C · Agent-driven UI directives (ADR-0005)

How the agent triggers modals/forms/PIN/confirmation on both channels — declarative, provenance-gated directives. Depends on the channels + engine work above.

- [ ] **UID-01 — UiDirective contract** · M · deps: AGT-01, CHN-01
      Closed Zod union in `packages/contracts/src/channels/`: `UiComponentRef` enum, directives discriminated on `type` with server `origin` + trust tier, `directive_result` + result-by-ref schemas; `ConversationReply.directives[]`. AC: unknown ref/type fails parse; high-trust members require `proposalId` + nonce + expiry + sig.
- [ ] **UID-02 — DirectiveGrant + signer** · M · deps: TXN-01, FND-15
      `DirectiveGrant` table (issued/consumed/expired/failed); CSPRNG nonce bound to (userId, proposalId), hash-at-rest, TTL = quote lock; HMAC/token signer (key in env). AC: one-shot consume-on-redeem; replay/expiry rejected.
- [ ] **UID-03 — Core directive emission + provenance** · M · deps: UID-01, UID-02, TXN-02, CHN-02
      Only the engine/core mints high-trust directives (origin-stamped + signed); the LLM may request low-trust only. AC: an agent-origin high-trust directive is dropped server-side; depcruise + unit test prove the agent path cannot construct one.
- [ ] **UID-04 — Submit re-validation (settleFromDirective)** · M · deps: UID-02, TXN-02
      Every web/Flow submit re-checks identity/KYC/limits/velocity/sanctions/balance/re-quote/nonce/PIN/step-up/idempotency from the proposal, ignoring client-supplied figures. AC: amount-substitution, stale-price, and replay all rejected.
- [ ] **UID-05 — Web DirectiveHost + registry** · M · deps: WEB-04, UID-01
      `components/chat/DirectiveHost` reads validated directives from `chat-store`; exhaustive `ref→component` registry over app-owned overlays/cards; safe fallback; sensitive directives gate on a complete state. AC: agent ships no markup; unknown ref → fallback; `lib/` stays component-free.
- [ ] **UID-06 — Web directive-result client** · S · deps: UID-05, WEB-02
      Modal/form submit → typed `directive_result` inbound (Idempotency-Key); PIN submitted out-of-band to the engine, never to chat. AC: round-trip parsed by ref; PIN never in chat history.
- [ ] **UID-07 — WhatsApp directive→Flow mapper** · M · deps: CHN-07, UID-01
      Map the same directive to a Flow / buttons; `ref→published-Flow-id` AppSetting; secret-bearing directives only via E2E Flow; web-handoff fallback when a Flow is unavailable; never a commerce object. AC: PIN/KYC never plaintext; parity with web.
- [ ] **UID-08 — WhatsApp Flow → directive_result** · S · deps: CHN-07, UID-01
      Decrypt Flow `data_exchange` → reconstruct the same `directive_result` inbound into `handleInbound()`. AC: web and WhatsApp submits indistinguishable to the core.
- [ ] **UID-09 — Directive security telemetry** · S · deps: UID-03, AUD-02
      Dropped/forged high-trust directives raise a compliance/admin security event (prompt-injection signal); no-raw-HTML lint on `params`. AC: a forged directive is logged + alerted.

---

## Phase 6 — Event ticketing

- [ ] **TKT-01 — TicketProvider port + registry gate** · M · deps: FND-05
      Capability-registry-gated provider port. AC: ticketing toggled by flag.
- [ ] **TKT-02 — Vendor adapter (search/normalize)** · M · deps: TKT-01
      Zentry/Tix; price inclusive of platform commission. AC: normalized options across vendors.
- [ ] **TKT-03 — Ticket quote + order model** · M · deps: TKT-02, QTE-02
      `TicketOrder` + settlement state. AC: quote includes platform fee.
- [ ] **TKT-04 — Purchase (merchant of record) + settle provider** · L · deps: TKT-03, TXN-04
      Collect payment, settle provider out-of-band (working-capital aware). AC: settlement reconciled + audited.
- [ ] **TKT-05 — Ticket delivery + receipt** · S · deps: TKT-04, RCP-05
      Deliver ticket; emit receipt. AC: delivery confirmed; receipt issued.
- [ ] **TKT-06 — Refund/chargeback handling** · M · deps: TKT-04, AUD-02
      Refund + chargeback flows. AC: refunds reconciled + audited.

---

## Phase 7 — Frontend web + admin console UI

Each ticket depends on its backend epic and can start as soon as that API lands.

### 7A · Web foundation

- [ ] **WEB-01 — App shell + design tokens** · M · deps: —
      Layout, Tailwind v4 tokens, shadcn baseline, theming, a11y. AC: tokens only (no hex); focus states; reduced-motion.
- [ ] **WEB-02 — Data layer wiring** · M · deps: WEB-01, FND-06
      Axios instance + interceptors (auth, error, Idempotency-Key); TanStack Query; Zustand; Zod/RHF; `/config` flags. AC: every client parses Zod before fetch; flags hide disabled services.
- [ ] **WEB-03 — Auth UI** · M · deps: WEB-02, IDN-03, IDN-05, IDN-06
      Signin/up, device, PIN set, step-up. AC: four async branches everywhere.

### 7B · User product UI

- [ ] **WEB-04 — Chat UI (SSE)** · M · deps: WEB-02, CHN-08
      Conversational surface over SSE. AC: reconnect/replay; streaming.
- [ ] **WEB-05 — KYC wizard** · M · deps: WEB-03, IDN-09
      Per-step RHF + Zod. AC: validates per step; resumable.
- [ ] **WEB-06 — Wallet/balances + receive** · S · deps: WEB-02, WAL-04
      Balances + deposit address. AC: address copy + QR; never shows keys.
- [ ] **WEB-07 — Buy/Sell/Send/Swap flows** · L · deps: WEB-03, TXN-03, TXN-05, TXN-06, TXN-07
      Itemized confirmation + PIN. AC: confirmation re-renders exact params; PIN required.
- [ ] **WEB-08 — Beneficiaries** · S · deps: WEB-03, IDN-08
      Manage payout/crypto beneficiaries. AC: step-up on add; first-use warning.
- [ ] **WEB-09 — Receipts viewer** · S · deps: WEB-02, RCP-04
      View/download. AC: PDF download; per-txn link.
- [ ] **WEB-10 — Notifications center + preferences** · S · deps: WEB-02, NTF-05, NTF-09
      In-app feed + prefs. AC: non-disableable events shown as locked.
- [ ] **WEB-11 — Ticketing UI** · M · deps: WEB-02, TKT-02
      Browse/buy events. AC: shows all-in price.

### 7C · Admin console (RBAC-gated)

- [ ] **WEB-12 — Admin shell + RBAC gating** · M · deps: WEB-01, ADM-06
      Routes/menus gated by `/admin/me/permissions`. AC: no unauthorized page/menu renders; server still enforces.
- [ ] **WEB-13 — Roles & permissions UI** · M · deps: WEB-12, ADM-05
      Create role; assign which routes + pages it can access. AC: catalog-driven; changes audited.
- [ ] **WEB-14 — Invitations UI** · S · deps: WEB-12, ADM-07
      Invite a person into a role; manage pending. AC: single-use invite; status visible.
- [ ] **WEB-15 — Users & KYC review** · M · deps: WEB-12, IDN-10
      Approve/reject KYC; user detail. AC: actions require reason + audited.
- [ ] **WEB-16 — Transaction explorer + interventions** · M · deps: WEB-12, TXN-08
      Search txns; manual intervention with reason. AC: interventions audited; no silent edits.
- [ ] **WEB-17 — Treasury monitor** · S · deps: WEB-12, QTE-04
      Exposure vs limits. AC: live; threshold highlights.
- [ ] **WEB-18 — Compliance queue** · M · deps: WEB-12, AUD-09
      Flagged-txn queue + sanctions-hit disposition. AC: every flag dispositioned + audited.
- [ ] **WEB-19 — Config & feature-flag editor** · M · deps: WEB-12, FND-04, FND-05
      Edit layered config + flags (hot-reload). AC: change applies without deploy; audited.
- [ ] **WEB-20 — Provider management** · S · deps: WEB-12, FND-05
      Manage WaaS/processor/ticketing/identity providers. AC: enable/disable + credentials (write-only secrets).
- [ ] **WEB-21 — Template editor** · S · deps: WEB-12, NTF-07
      Multilingual message templates. AC: preview + publish; audited.
- [ ] **WEB-22 — Audit-log viewer** · M · deps: WEB-12, AUD-04
      Search/filter the immutable log. AC: read-only; deep links by correlation id.
- [ ] **WEB-23 — Admin dashboard/KPIs** · S · deps: WEB-12, AUD-04
      Acquisition/activation/revenue/risk KPIs. AC: matches PRD §11 metrics.

---

## Phase 8 — Hardening & launch

- [ ] **OPS-01 — E2E test suites** · L · deps: Phase 7
      Playwright across web + both channels. AC: golden paths + edge cases green.
- [ ] **OPS-02 — Security review / pen-test** · L · deps: Phase 5
      Money path, webhooks (HMAC), RBAC, handoff token, PIN/step-up. AC: criticals fixed.
- [ ] **OPS-03 — Load/perf test** · M · deps: Phase 5
      Webhook fast-ack, agent latency, settlement throughput. AC: meets NFR-8 targets.
- [ ] **OPS-04 — Observability + runbooks** · M · deps: FND-11
      Dashboards + alerts (treasury thresholds, failed settlements, anomalies) + incident runbooks. AC: on-call can act from runbooks.
- [ ] **OPS-05 — Compliance sign-off + ARIP prep** · L · deps: Phase 4
      KYC/AML/Travel Rule/sanctions evidence; ARIP application; counsel + Meta review of ADR-0003. AC: documented sign-off before launch.
- [ ] **OPS-06 — WhatsApp template approval** · M · deps: CHN-06
      Submit/approve the template inventory with Meta. AC: out-of-window + re-engagement templates approved.
- [ ] **OPS-07 — Backup/restore + DR drill** · M · deps: FND-02
      Retention policy, backups, restore drill. AC: restore verified within RTO/RPO.
- [ ] **OPS-08 — Closed beta** · M · deps: all
      Capped-limit beta + flag-driven rollout. AC: kill-switch via flags; metrics instrumented.

---

### Open inputs that gate specific tickets (track separately)

- **WaaS provider** `[TBD]` → WAL-01/02, TXN-06/07.
- **Ticketing vendor terms** `[TBD]` → TKT-02/04.
- **Identity vendor** `[TBD]` → IDN-09.
- **ARIP / counsel + Meta review** → OPS-05, and gates the ADR-0003 compliance posture before launch.
