import { z } from "zod";

// The admin RBAC permission catalog — the SINGLE source of truth shared by the
// API (route guards + DB seeding) and the web-admin app (nav/page gating).
// Mirrors the Prisma `Permission` model: a permission guards an `api_route`, a
// `web_page`, or a `menu_item`, with one of four actions. A permission id is the
// colon-joined tuple; it is what appears in `AdminMe.permissions` and in role
// assignments. Default-deny: a route with no granted permission is forbidden.

export const AdminResourceTypeSchema = z.enum([
  "api_route",
  "web_page",
  "menu_item",
]);
export type AdminResourceType = z.infer<typeof AdminResourceTypeSchema>;

export const AdminPermissionActionSchema = z.enum([
  "read",
  "write",
  "delete",
  "execute",
]);
export type AdminPermissionAction = z.infer<typeof AdminPermissionActionSchema>;

// Catalog grouping — drives the admin UI's nav sections and the built-in-role
// grant matrix. Grows additively as later phases register their surfaces.
export const ADMIN_PERMISSION_CATEGORIES = [
  "Access",
  "Audit",
  "Config",
  "Pricing",
  "Catalog",
  "KYC",
  "Users",
  "Transactions",
  "Ledger",
  "Compliance",
  "Treasury",
  "Beneficiaries",
  "Comms",
  "Tickets",
  "Agent",
  "Metrics",
  "Ops",
  "Approvals",
] as const;
export type AdminPermissionCategory =
  (typeof ADMIN_PERMISSION_CATEGORIES)[number];

export interface PermissionCatalogEntry {
  resourceType: AdminResourceType;
  /** "GET /admin/admins" | "/admin/audit" | "menu.access". */
  resourceId: string;
  action: AdminPermissionAction;
  category: AdminPermissionCategory;
  description: string;
}

export const AdminPermissionSchema = z.object({
  resourceType: AdminResourceTypeSchema,
  resourceId: z.string().min(1),
  action: AdminPermissionActionSchema,
});

/** Canonical id: `${resourceType}:${resourceId}:${action}`. */
export function permissionId(p: {
  resourceType: string;
  resourceId: string;
  action: string;
}): string {
  return `${p.resourceType}:${p.resourceId}:${p.action}`;
}

const r = (
  resourceType: AdminResourceType,
  resourceId: string,
  action: AdminPermissionAction,
  category: AdminPermissionCategory,
  description: string,
): PermissionCatalogEntry => ({
  resourceType,
  resourceId,
  action,
  category,
  description,
});

// ── Phase 0 catalog (Access + Audit + folded Treasury wallet ops) ──────────────
// Later phases append their own entries; ids must stay globally unique.
export const PERMISSION_CATALOG: readonly PermissionCatalogEntry[] = [
  // Access — admin users
  r("api_route", "GET /admin/admins", "read", "Access", "List admin users"),
  r(
    "api_route",
    "GET /admin/admins/:id",
    "read",
    "Access",
    "View an admin user",
  ),
  r(
    "api_route",
    "PATCH /admin/admins/:id/role",
    "write",
    "Access",
    "Change an admin user's role",
  ),
  r(
    "api_route",
    "PATCH /admin/admins/:id/status",
    "write",
    "Access",
    "Suspend / reactivate / offboard an admin user",
  ),
  r(
    "api_route",
    "POST /admin/invitations",
    "write",
    "Access",
    "Invite a new admin user",
  ),
  r(
    "api_route",
    "POST /admin/admins/:id/mfa/reset",
    "write",
    "Access",
    "Reset another admin user's 2FA (they must re-enroll)",
  ),
  // Access — roles & permissions
  r("api_route", "GET /admin/roles", "read", "Access", "List roles"),
  r("api_route", "POST /admin/roles", "write", "Access", "Create a role"),
  r(
    "api_route",
    "PATCH /admin/roles/:id",
    "write",
    "Access",
    "Edit a role's permissions",
  ),
  r(
    "api_route",
    "GET /admin/permissions",
    "read",
    "Access",
    "List the permission catalog",
  ),
  // Access — sessions
  r(
    "api_route",
    "GET /admin/sessions",
    "read",
    "Access",
    "List admin sessions",
  ),
  r(
    "api_route",
    "DELETE /admin/sessions/:id",
    "write",
    "Access",
    "Revoke an admin session",
  ),
  // Audit
  r("api_route", "GET /admin/audit", "read", "Audit", "Read the audit log"),
  r(
    "api_route",
    "POST /admin/audit/verify",
    "execute",
    "Audit",
    "Verify audit-chain integrity",
  ),
  // Treasury (folded legacy wallet ops)
  r(
    "api_route",
    "POST /admin/wallets/reconcile",
    "execute",
    "Treasury",
    "Reconcile a user's on-chain vs ledger balance",
  ),
  r(
    "api_route",
    "POST /admin/wallets/backfill-networks",
    "execute",
    "Treasury",
    "Enqueue a wallet-network backfill",
  ),
  r(
    "api_route",
    "GET /admin/wallets/backfill-runs/:id",
    "read",
    "Treasury",
    "Read a backfill run's status",
  ),
  // Config — layered-config (AppSetting) console (Phase 1)
  r(
    "api_route",
    "GET /admin/settings",
    "read",
    "Config",
    "List effective config settings",
  ),
  r(
    "api_route",
    "GET /admin/settings/:key",
    "read",
    "Config",
    "View one effective config setting",
  ),
  r(
    "api_route",
    "PATCH /admin/settings/:key",
    "write",
    "Config",
    "Override a config setting",
  ),
  // Config — full asset + fiat catalog view (Phase 6b, READ-ONLY). The public
  // GET /config is enabled-only + secret-stripped; this admin view adds the
  // disabled (paused/off) rows and per-entry live status the catalog screens show.
  r(
    "api_route",
    "GET /admin/config/catalog",
    "read",
    "Config",
    "View the full asset + currency catalog (incl. disabled)",
  ),

  // Users — end-user management & device/SIM-swap admin (Phase 2)
  r(
    "api_route",
    "GET /admin/users",
    "read",
    "Users",
    "List / search end users",
  ),
  r(
    "api_route",
    "GET /admin/users/:id",
    "read",
    "Users",
    "View an end user's detail",
  ),
  r(
    "api_route",
    "PATCH /admin/users/:id/tier",
    "write",
    "Users",
    "Change an end user's KYC tier",
  ),
  r(
    "api_route",
    "PATCH /admin/users/:id/status",
    "write",
    "Users",
    "Suspend / reactivate / deactivate an end user",
  ),
  r(
    "api_route",
    "POST /admin/users/:id/pin-reset",
    "write",
    "Users",
    "Trigger an end user's PIN reset",
  ),
  // Manual credit is a MAKER action: it raises a pending `manual_credit`
  // ChangeRequest a SECOND admin must approve (four-eyes, §3.1) — it never moves
  // money itself. `write` (it only creates a request; the engine credit happens
  // on approve, which is guarded by the approvals `execute` permission + step-up).
  r(
    "api_route",
    "POST /admin/users/:id/credit",
    "write",
    "Users",
    "Raise a manual-credit request for an end user's wallet (maker-checker)",
  ),
  r(
    "api_route",
    "GET /admin/users/:id/devices",
    "read",
    "Users",
    "List an end user's devices",
  ),
  r(
    "api_route",
    "GET /admin/users/:id/sessions",
    "read",
    "Users",
    "List an end user's active auth sessions",
  ),
  r(
    "api_route",
    "GET /admin/users/:id/limits",
    "read",
    "Users",
    "View an end user's effective limits & velocity usage",
  ),
  r(
    "api_route",
    "GET /admin/users/:id/timeline",
    "read",
    "Users",
    "View an end user's admin-action timeline",
  ),
  r(
    "api_route",
    "DELETE /admin/users/:id/devices/:deviceId",
    "write",
    "Users",
    "Revoke an end user's device",
  ),
  r(
    "api_route",
    "POST /admin/users/:id/sim-swap-reverify",
    "write",
    "Users",
    "Force SIM-swap re-verification for an end user",
  ),
  r(
    "api_route",
    "POST /admin/users/tags",
    "write",
    "Users",
    "Bulk-apply an operator tag to selected end users",
  ),
  r(
    "api_route",
    "POST /admin/users/message",
    "write",
    "Comms",
    "Bulk-queue a templated broadcast to selected end users",
  ),

  // KYC — review queue & approve/reject (Phase 2)
  r(
    "api_route",
    "GET /admin/kyc/queue",
    "read",
    "KYC",
    "List the KYC review queue",
  ),
  r(
    "api_route",
    "GET /admin/kyc/:userId",
    "read",
    "KYC",
    "View a KYC submission's detail",
  ),
  r(
    "api_route",
    "POST /admin/kyc/:userId/approve",
    "write",
    "KYC",
    "Approve a KYC submission",
  ),
  r(
    "api_route",
    "POST /admin/kyc/:userId/reject",
    "write",
    "KYC",
    "Reject a KYC submission",
  ),

  // Transactions — read-only oversight of the deterministic engine (Phase 3)
  r(
    "api_route",
    "GET /admin/transactions",
    "read",
    "Transactions",
    "List / search transactions",
  ),
  r(
    "api_route",
    "GET /admin/transactions/:id",
    "read",
    "Transactions",
    "View a transaction's detail (legs + timeline)",
  ),
  // Transactions — engine-brokered, audited, idempotent TRIAGE of stuck txns
  // (Phase 3, sub-area B). These EXECUTE actions never move money directly: a
  // mark-failed routes through the engine's atomic refund methods (§3.1); a retry
  // re-enqueues the settlement outbox for the existing reconciliation worker.
  r(
    "api_route",
    "POST /admin/transactions/:id/mark-failed",
    "execute",
    "Transactions",
    "Mark a stuck transaction failed and refund its reserve (engine-brokered)",
  ),
  r(
    "api_route",
    "POST /admin/transactions/:id/retry",
    "execute",
    "Transactions",
    "Re-enqueue a stuck transaction's settlement for the reconciliation worker",
  ),
  r(
    "api_route",
    "POST /admin/transactions/:id/reconcile",
    "write",
    "Transactions",
    "Re-run reconciliation for one transaction (read-only provider-vs-ledger detection; moves no money)",
  ),

  // Ledger — read-only double-entry history + integrity verification (Phase 3)
  r(
    "api_route",
    "GET /admin/ledger",
    "read",
    "Ledger",
    "Read an account's ledger history",
  ),
  // Global cross-account ledger browse + sequence-integrity summary (Phase 6b)
  r(
    "api_route",
    "GET /admin/ledger/all",
    "read",
    "Ledger",
    "Browse the global cross-account ledger",
  ),
  r(
    "api_route",
    "GET /admin/ledger/integrity",
    "read",
    "Ledger",
    "Read the global ledger sequence-integrity summary",
  ),
  r(
    "api_route",
    "POST /admin/ledger/verify/:transactionId",
    "execute",
    "Ledger",
    "Verify a transaction's double-entry integrity",
  ),

  // Compliance — flagged-event disposition, AML-rule CRUD, Travel-Rule, SAR/STR,
  // sanctions visibility (Phase 3, sub-area C). The disposition + AML writes and the
  // report submit are step-up-gated at the controller. Nothing here moves money.
  r(
    "api_route",
    "GET /admin/compliance/events",
    "read",
    "Compliance",
    "List flagged compliance events",
  ),
  r(
    "api_route",
    "GET /admin/compliance/events/:id",
    "read",
    "Compliance",
    "View a compliance event's detail",
  ),
  r(
    "api_route",
    "POST /admin/compliance/events/:id/disposition",
    "write",
    "Compliance",
    "Dispose of a flagged compliance event",
  ),
  r(
    "api_route",
    "GET /admin/compliance/sanctions",
    "read",
    "Compliance",
    "List sanctions screening records",
  ),
  r(
    "api_route",
    "POST /admin/compliance/sanctions/:id/disposition",
    "write",
    "Compliance",
    "Dispose of a sanctions screening match (clear / escalate / block)",
  ),
  r(
    "api_route",
    "GET /admin/compliance/monitoring",
    "read",
    "Compliance",
    "Read the sanctions ongoing-monitoring policy flags",
  ),
  r(
    "api_route",
    "GET /admin/compliance/aml-rules",
    "read",
    "Compliance",
    "List AML rules",
  ),
  r(
    "api_route",
    "POST /admin/compliance/aml-rules",
    "write",
    "Compliance",
    "Create an AML rule",
  ),
  r(
    "api_route",
    "PATCH /admin/compliance/aml-rules/:id",
    "write",
    "Compliance",
    "Edit an AML rule (bumps its version)",
  ),
  r(
    "api_route",
    "GET /admin/compliance/travel-rule",
    "read",
    "Compliance",
    "List captured Travel Rule data",
  ),
  r(
    "api_route",
    "GET /admin/compliance/reports",
    "read",
    "Compliance",
    "List SAR/STR compliance reports",
  ),
  r(
    "api_route",
    "POST /admin/compliance/reports",
    "write",
    "Compliance",
    "Draft a SAR/STR compliance report",
  ),
  r(
    "api_route",
    "POST /admin/compliance/reports/:id/submit",
    "execute",
    "Compliance",
    "Submit a drafted SAR/STR compliance report",
  ),

  // Treasury — aggregated-balance / exposure / alert / withdrawal-policy oversight
  // (Phase 3, sub-area D). All reads; only the alert acknowledge is a write (step-up
  // -gated at the controller). Nothing here moves money (§3.1).
  r(
    "api_route",
    "GET /admin/treasury/balances",
    "read",
    "Treasury",
    "List aggregated custodial balances by network + asset",
  ),
  r(
    "api_route",
    "GET /admin/treasury/exposure",
    "read",
    "Treasury",
    "List real-time treasury exposure-vs-limit snapshots",
  ),
  r(
    "api_route",
    "GET /admin/treasury/alerts",
    "read",
    "Treasury",
    "List treasury exposure-threshold alerts",
  ),
  r(
    "api_route",
    "POST /admin/treasury/alerts/:id/acknowledge",
    "write",
    "Treasury",
    "Acknowledge a treasury exposure alert",
  ),
  r(
    "api_route",
    "GET /admin/treasury/withdrawal-policies",
    "read",
    "Treasury",
    "List active per-wallet withdrawal policies",
  ),
  // Phase 6b (READ-ONLY): child-address sweeps, the pending payout/withdrawal
  // approval queue, NGN fiat-float vs target, and FX position / exposure headroom.
  // All reads — the approve/release WRITE is engine-brokered in Phase 7 (§3.1).
  r(
    "api_route",
    "GET /admin/treasury/sweeps",
    "read",
    "Treasury",
    "List child-address gas-sweep state (balance + lifecycle)",
  ),
  r(
    "api_route",
    "GET /admin/treasury/payout-queue",
    "read",
    "Treasury",
    "List pending payouts / withdrawals awaiting release",
  ),
  r(
    "api_route",
    "GET /admin/treasury/fiat-float",
    "read",
    "Treasury",
    "Show NGN fiat float vs the configured target",
  ),
  r(
    "api_route",
    "GET /admin/treasury/fx-position",
    "read",
    "Treasury",
    "Show FX net position + exposure headroom",
  ),
  // Reconciliation — provider-vs-ledger break list + cron status bar (Phase 6b,
  // READ-ONLY). Breaks are projected from unresolved compensations + stuck
  // settlements; nothing here moves money (§3.1). Grouped under Treasury (the
  // reconciliation desk is a treasury-oversight concern). The resolve/accept/
  // escalate/run-now WRITES are Phase 7.
  r(
    "api_route",
    "GET /admin/reconciliation/breaks",
    "read",
    "Treasury",
    "List provider-vs-ledger reconciliation breaks",
  ),
  r(
    "api_route",
    "GET /admin/reconciliation/status",
    "read",
    "Treasury",
    "Read the reconciliation-cron status (last/next run, open-break count)",
  ),
  // Reconciliation dispositions (Phase 7, WRITES). Resolve is engine-brokered — it
  // re-drives the offending transaction's settlement through the engine's atomic
  // outbox re-enqueue (execute); it NEVER auto-debits an over-credit (§3.1). Accept
  // records a no-debit disposition (write). Both are step-up-gated at the controller.
  r(
    "api_route",
    "POST /admin/reconciliation/breaks/:id/resolve",
    "execute",
    "Treasury",
    "Resolve a reconciliation break via the engine (re-drive settlement; never a raw debit)",
  ),
  r(
    "api_route",
    "POST /admin/reconciliation/breaks/:id/accept",
    "write",
    "Treasury",
    "Accept a reconciliation break as-is (dual-control, no debit)",
  ),
  r(
    "api_route",
    "POST /admin/reconciliation/breaks/:id/escalate",
    "write",
    "Treasury",
    "Escalate a reconciliation break into a compliance case (step-up-gated; opens a ComplianceEvent)",
  ),
  // Treasury payout / withdrawal approval (Phase 7, WRITE — maker-checker). Raising
  // an approval APPLIES NOTHING — it enters the four-eyes inbox for a SECOND admin to
  // confirm; the release is then applied through the engine's atomic path (§3.1).
  r(
    "api_route",
    "POST /admin/treasury/payouts/:id/approve",
    "execute",
    "Treasury",
    "Approve a queued payout via maker-checker (raises a four-eyes change request)",
  ),

  // Approvals — the maker-checker change-request subsystem (Phase 7, WRITES). A
  // sensitive mutation is captured as a pending request (create = write), then a
  // DIFFERENT admin approves (execute — APPLIES the change via the target service
  // atomically + audited) or rejects (write — records a reason). The requester can
  // never self-approve (four-eyes). Approve is step-up-gated at the controller; the
  // applied change routes through the target service's existing atomic path (§3.1).
  r(
    "api_route",
    "GET /admin/approvals/inbox",
    "read",
    "Approvals",
    "List the approvals inbox (awaiting-me / my-requests + counts)",
  ),
  r(
    "api_route",
    "POST /admin/approvals",
    "write",
    "Approvals",
    "Raise a change request for a second admin to approve",
  ),
  r(
    "api_route",
    "POST /admin/approvals/:id/approve",
    "execute",
    "Approvals",
    "Approve a change request and apply the change (engine/target-brokered)",
  ),
  r(
    "api_route",
    "POST /admin/approvals/:id/reject",
    "write",
    "Approvals",
    "Reject a change request with a reason",
  ),

  // Beneficiaries — saved-payout-destination oversight + first-use cooling-off
  // override (Phase 3, sub-area D). The override is step-up-gated at the controller
  // and audited; it clears the cooling-off lock but never moves money (§3.1).
  r(
    "api_route",
    "GET /admin/beneficiaries",
    "read",
    "Beneficiaries",
    "List end-user beneficiaries (payout destinations)",
  ),
  r(
    "api_route",
    "POST /admin/beneficiaries/:id/cooling-off-override",
    "write",
    "Beneficiaries",
    "Clear a beneficiary's first-use cooling-off lock",
  ),

  // Comms — notification-template CRUD + preview and read-only WhatsApp config
  // (Phase 4 wave 1). The create/patch writes are step-up-gated at the controller
  // and audited as config_change; nothing here moves money (§3.1). The WhatsApp
  // config view is read-only and returns NON-SECRET values only (§3.5).
  r(
    "api_route",
    "GET /admin/notification-templates",
    "read",
    "Comms",
    "List notification templates",
  ),
  r(
    "api_route",
    "GET /admin/notification-templates/:templateKey/:language/:channel",
    "read",
    "Comms",
    "View one notification template",
  ),
  r(
    "api_route",
    "POST /admin/notification-templates",
    "write",
    "Comms",
    "Create a notification template",
  ),
  r(
    "api_route",
    "PATCH /admin/notification-templates/:templateKey/:language/:channel",
    "write",
    "Comms",
    "Edit a notification template",
  ),
  r(
    "api_route",
    "POST /admin/notification-templates/preview",
    "read",
    "Comms",
    "Preview a rendered notification template",
  ),
  r(
    "api_route",
    "GET /admin/whatsapp/config",
    "read",
    "Comms",
    "View the non-secret WhatsApp configuration",
  ),
  // Phase 6b (Comms READ enrichment): the read-only notification delivery log
  // (recent issued notifications + aggregate bounce/complaint rates). Read-only,
  // moves no money (§3.1).
  r(
    "api_route",
    "GET /admin/notifications/delivery-log",
    "read",
    "Comms",
    "View the notification delivery log + bounce/complaint stats",
  ),
  // Phase 7 (Comms WRITES): send a broadcast to an audience cohort via the outbox.
  // Step-up gated; a large audience is deferred to maker-checker (§3.5). Moves no
  // money (§3.1).
  r(
    "api_route",
    "POST /admin/notifications/broadcast",
    "write",
    "Comms",
    "Send (or queue-for-approval) a broadcast to an audience cohort",
  ),

  // Tickets — read-only ticket-order oversight (Phase 4 wave 2). Enablement +
  // commission are tuned via /admin/settings; this surface only LISTS orders.
  r(
    "api_route",
    "GET /admin/tickets/orders",
    "read",
    "Tickets",
    "List ticket orders",
  ),

  // Agent — read-only config view + conversation/intent logs (Phase 4 wave 2).
  // The model id / enablement flag are edited via /admin/settings; the system
  // prompt is read-only and never editable (§3.1/§6). No write routes here.
  r(
    "api_route",
    "GET /admin/agent/config",
    "read",
    "Agent",
    "View the agent's read-only configuration (model id + enablement + prompt preview)",
  ),
  r(
    "api_route",
    "GET /admin/agent/conversations",
    "read",
    "Agent",
    "List agent conversations",
  ),
  r(
    "api_route",
    "GET /admin/agent/conversations/:id",
    "read",
    "Agent",
    "View an agent conversation's messages, intents, and replies",
  ),
  // Phase 6b (READ enrichment): the Agent console insights — guardrail params
  // (structured-output / checkpointer / PIN-step-up / max-tool-calls, all
  // architectural facts or from config), the typed-tool registry (read/write),
  // the live system-prompt version, and real 24h usage counts (no fabricated
  // tokens/cost — the schema stores none). Read-only (§3.1); no write routes.
  r(
    "api_route",
    "GET /admin/agent/insights",
    "read",
    "Agent",
    "View agent guardrails, the tool registry, the live prompt version, and 24h usage",
  ),

  // Metrics — read-only date-ranged dashboard aggregations (Phase 5 — FINAL).
  // Transaction volumes/success, revenue (fees + spread), KYC funnel, active
  // users, service health. Nothing here moves money (§3.1); revenue is surfaced
  // only to operators on this surface, never on an end-user surface.
  r(
    "api_route",
    "GET /admin/metrics/dashboard",
    "read",
    "Metrics",
    "Read the composite operational dashboard (all metric blocks)",
  ),
  r(
    "api_route",
    "GET /admin/metrics/transactions",
    "read",
    "Metrics",
    "Read transaction-volume + success-rate metrics",
  ),
  r(
    "api_route",
    "GET /admin/metrics/gmv",
    "read",
    "Metrics",
    "Read GMV (gross merchandise value — fiat notional summed by currency)",
  ),
  r(
    "api_route",
    "GET /admin/metrics/revenue",
    "read",
    "Metrics",
    "Read revenue (fees + spread) metrics by currency",
  ),
  r(
    "api_route",
    "GET /admin/metrics/kyc-funnel",
    "read",
    "Metrics",
    "Read the KYC funnel (counts by status + tier)",
  ),
  r(
    "api_route",
    "GET /admin/metrics/ops",
    "read",
    "Metrics",
    "Read operational-health metrics (system health, activity feed, open compliance cases)",
  ),
  r(
    "api_route",
    "GET /admin/ops",
    "read",
    "Metrics",
    "Read the System/ops board (provider status, webhook queues, background-jobs/cron registry)",
  ),
  // System/ops "Run now" (Phase 7, WRITE — execute). Triggers a manual run of a
  // declared background job by re-driving an EXISTING deterministic worker (e.g. the
  // settlement-reconciliation tick); it NEVER settles inline or moves money (§3.1).
  // Step-up-gated at the controller. Grouped under Ops (operator-run surfaces —
  // distinct from the strictly-read-only Metrics category).
  r(
    "api_route",
    "POST /admin/ops/jobs/:id/run",
    "execute",
    "Ops",
    "Trigger a manual run of a declared background job (engine-brokered; moves no money)",
  ),
  // Providers registry read (Phase 6b) + the "Test connection" liveness probe
  // (Phase 7, WRITE — execute). The probe is a real, non-mutating round-trip that
  // reports reachability + latency; it NEVER returns a secret value (§3.4/§3.5) and
  // NEVER moves money (§3.1). Grouped under Ops.
  r(
    "api_route",
    "GET /admin/providers",
    "read",
    "Ops",
    "Read the provider-registry view (posture-derived status; secret presence only)",
  ),
  r(
    "api_route",
    "POST /admin/providers/:key/test",
    "execute",
    "Ops",
    "Run a provider liveness probe (no secret exposure; moves no money)",
  ),

  // Web pages (nav/page gating — UX only; the API still enforces api_route perms)
  r(
    "web_page",
    "/admin/admins",
    "read",
    "Access",
    "Admin user management page",
  ),
  r(
    "web_page",
    "/admin/roles",
    "read",
    "Access",
    "Role & permission management page",
  ),
  r("web_page", "/admin/sessions", "read", "Access", "Admin sessions page"),
  r("web_page", "/admin/audit", "read", "Audit", "Audit log viewer page"),
  r(
    "web_page",
    "/admin/treasury",
    "read",
    "Treasury",
    "Treasury / wallet tools page",
  ),
  r(
    "web_page",
    "/admin/settings",
    "read",
    "Config",
    "Config settings management page",
  ),
  r("web_page", "/admin/users", "read", "Users", "End-user management page"),
  r("web_page", "/admin/kyc", "read", "KYC", "KYC review queue page"),
  r(
    "web_page",
    "/admin/transactions",
    "read",
    "Transactions",
    "Transactions oversight page",
  ),
  r("web_page", "/admin/ledger", "read", "Ledger", "Ledger oversight page"),
  r(
    "web_page",
    "/admin/compliance",
    "read",
    "Compliance",
    "Compliance console page",
  ),
  r(
    "web_page",
    "/admin/beneficiaries",
    "read",
    "Beneficiaries",
    "Beneficiary oversight page",
  ),
  r(
    "web_page",
    "/admin/notifications",
    "read",
    "Comms",
    "Notification-template management page",
  ),
  r(
    "web_page",
    "/admin/whatsapp",
    "read",
    "Comms",
    "WhatsApp configuration page",
  ),
  r("web_page", "/admin/tickets", "read", "Tickets", "Ticket orders page"),
  r(
    "web_page",
    "/admin/agent",
    "read",
    "Agent",
    "Agent config + conversation logs page",
  ),
  r(
    "web_page",
    "/admin/metrics",
    "read",
    "Metrics",
    "Operational dashboard / metrics page",
  ),
  // Menu items (nav groups)
  r("menu_item", "menu.access", "read", "Access", "Access & RBAC nav group"),
  r("menu_item", "menu.audit", "read", "Audit", "Audit nav group"),
  r("menu_item", "menu.treasury", "read", "Treasury", "Treasury nav group"),
  r("menu_item", "menu.config", "read", "Config", "Config nav group"),
  r("menu_item", "menu.users", "read", "Users", "Users nav group"),
  r("menu_item", "menu.kyc", "read", "KYC", "KYC nav group"),
  r(
    "menu_item",
    "menu.transactions",
    "read",
    "Transactions",
    "Transactions nav group",
  ),
  r("menu_item", "menu.ledger", "read", "Ledger", "Ledger nav group"),
  r(
    "menu_item",
    "menu.compliance",
    "read",
    "Compliance",
    "Compliance nav group",
  ),
  r(
    "menu_item",
    "menu.beneficiaries",
    "read",
    "Beneficiaries",
    "Beneficiaries nav group",
  ),
  r(
    "menu_item",
    "menu.notifications",
    "read",
    "Comms",
    "Notifications nav group",
  ),
  r("menu_item", "menu.whatsapp", "read", "Comms", "WhatsApp nav group"),
  r("menu_item", "menu.tickets", "read", "Tickets", "Tickets nav group"),
  r("menu_item", "menu.agent", "read", "Agent", "Agent nav group"),
  r("menu_item", "menu.metrics", "read", "Metrics", "Metrics nav group"),
  r("menu_item", "menu.approvals", "read", "Approvals", "Approvals nav group"),
];

// ── Built-in roles ─────────────────────────────────────────────────────────────
export const BUILTIN_ROLE_NAMES = [
  "super_admin",
  "ops",
  "compliance",
  "finance",
  "support",
] as const;
export type BuiltinRoleName = (typeof BUILTIN_ROLE_NAMES)[number];

export interface BuiltinRoleDef {
  name: BuiltinRoleName;
  description: string;
  isBuiltin: true;
  /** True iff this role is granted the given catalog entry. */
  grants: (entry: PermissionCatalogEntry) => boolean;
}

type CategoryGrants = Partial<
  Record<AdminPermissionCategory, AdminPermissionAction[]>
>;

function role(
  name: BuiltinRoleName,
  description: string,
  grants: CategoryGrants | "all",
): BuiltinRoleDef {
  return {
    name,
    description,
    isBuiltin: true,
    grants:
      grants === "all"
        ? () => true
        : (entry) => (grants[entry.category] ?? []).includes(entry.action),
  };
}

// Phase-0 grants. Later phases widen the per-category action sets as their
// surfaces (Config/Pricing/KYC/Users/Transactions/Compliance/…) are registered.
export const BUILTIN_ROLES: readonly BuiltinRoleDef[] = [
  role(
    "super_admin",
    "Full, unrestricted access to every admin capability.",
    "all",
  ),
  role(
    "ops",
    "Operations: oversight and treasury actions; no access management.",
    {
      Audit: ["read"],
      Treasury: ["read", "write", "execute"],
      Config: ["read"],
      Users: ["read", "write"],
      Transactions: ["read"],
      Compliance: ["read"],
      Beneficiaries: ["read", "write"],
      Comms: ["read", "write"],
      Tickets: ["read"],
      Agent: ["read"],
      Metrics: ["read"],
      // Ops owns the operational-run surfaces: provider registry + the execute-gated
      // "Run now" (job trigger) + provider "Test connection" probe — both
      // engine-brokered / non-mutating (§3.1), never a money movement.
      Ops: ["read", "execute"],
      // Ops raises pricing/capability/tier changes and acts as a checker on them.
      Approvals: ["read", "write", "execute"],
    },
  ),
  role(
    "compliance",
    "Compliance: KYC review, sanctions/AML, audit visibility.",
    {
      Audit: ["read"],
      Users: ["read", "write"],
      KYC: ["read", "write"],
      Transactions: ["read"],
      Compliance: ["read", "write", "execute"],
      Beneficiaries: ["read", "write"],
      Metrics: ["read"],
      // Compliance can raise + reject change requests (four-eyes checker), but is
      // not granted execute-apply on economic changes (that is ops/finance).
      Approvals: ["read", "write"],
    },
  ),
  role(
    "finance",
    "Finance: pricing/economics, treasury, ledger, audit visibility.",
    {
      Audit: ["read"],
      Treasury: ["read", "write", "execute"],
      Config: ["read", "write"],
      Transactions: ["read", "execute"],
      Ledger: ["read", "execute"],
      Metrics: ["read"],
      // Finance sees the operator-run surfaces (provider registry) but ops owns the
      // execute-gated run/probe actions.
      Ops: ["read"],
      // Finance raises pricing/refund changes and acts as a checker on them.
      Approvals: ["read", "write", "execute"],
    },
  ),
  role("support", "Support: read-only visibility into users and activity.", {
    Users: ["read"],
    KYC: ["read"],
    Beneficiaries: ["read"],
    Comms: ["read"],
    Agent: ["read"],
    Metrics: ["read"],
    Approvals: ["read"],
  }),
];
