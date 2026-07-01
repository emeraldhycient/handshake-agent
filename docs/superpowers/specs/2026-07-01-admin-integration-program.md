# Admin Console — FE↔BE Integration Program (Phases 6–8)

> Turns the certified 1:1 design reproduction (mock data) into a fully live operator console.
> Companion data: [`2026-07-01-admin-fe-be-gap-matrix.json`](./2026-07-01-admin-fe-be-gap-matrix.json) — all 168 features, per-domain, each tagged with a gap type + effort. This spec organizes them into phases; the JSON is the authoritative per-item source.

## 1. Where we are

The `web-admin` screens are a certified pixel/behaviour reproduction of the operator-console design, rendering the design's **mock data** (module consts). A real admin backend + api-client layer exists from Phases 0–5 (`api/src/modules/admin/*`, `packages/contracts/src/admin/*`, `web-admin/lib/api/*`, TanStack hooks). A gap analysis (10-domain workflow, `wgh6na301`) classified every feature:

| Gap                         | Count | Meaning                                                                       |
| --------------------------- | ----- | ----------------------------------------------------------------------------- |
| `just-wire`                 | 55    | endpoint + contract + client exist; screen renders mock instead of calling it |
| `mock-only-needs-backend`   | 78    | design shows it, **no API** — build backend, then wire                        |
| `backend-only-not-surfaced` | 24    | endpoint exists, no screen uses it — surface in FE                            |
| `both-missing`              | 7     | neither side real — build both                                                |
| `complete`                  | 4     | already wired (RBAC)                                                          |

## 2. Decisions (user)

- **Scope: full 1:1 build** — every mock-only feature gets a real backend so the console matches the design exactly.
- **Invariant-sensitive items** — BUILD (with safeguards): **Manual credit** (engine-brokered + maker-checker + audit, never raw ledger, §3.1) and **Bulk tag/message** (new user-tags model + bulk comms via notifications). REMOVE the mock (do not build): **full NIN/BVN reveal** (keep last-4 only — the "full PII never leaves the backend" invariant §3.4 stands) and **view-as/impersonate re-scoping** (remove the mock role-switch re-scoping; keep only an honest read-only role display).

## 3. Invariants that constrain every write (non-negotiable)

- No LLM/UI output moves money — the **deterministic engine** executes; admin mutations that touch funds (manual credit, refund, reconciliation-resolve, payout approval) go through the engine's atomic idempotent methods, never raw ledger writes (§3.1).
- Every money/compliance mutation: **reason → step-up (TOTP) → engine/maker-checker**, idempotency-keyed, **immutably audited** (hash-chained log).
- Server-side KYC/limit/sanctions re-checks on money-moving endpoints (§3.3); PII minimised (last-4 only, §3.4); agent core stays DB-free (§3.2).
- Contracts-first: every FE↔BE shape is a Zod DTO in `packages/contracts/src/admin/` (§8); FE parses request+response.

## 4. Phase structure

Each phase runs as its own multi-agent workflow (understand → parallel implement → adversarial verify), with a written plan authored just-in-time and a checkpoint between phases. "Full 1:1 build" makes each phase large; the backend-build phase (7) is the heaviest and will be split into sub-workflows by subsystem.

### Phase 6 — Reads: every screen shows real data

Wire the 55 `just-wire` views + build the **read-side** of `mock-only` data views + surface `backend-only` reads. Read-only ⇒ low funds-risk, fastest visible payoff.

- **Just-wire reads:** Users list/detail, KYC queue/submission, Transactions list/detail, Ledger, Audit (+ server-side filters/pagination), Metrics/Dashboard KPIs, Compliance cases/AML-rules/travel-rule/reports, RBAC admins/roles/sessions, Settings/pricing values.
- **Build read endpoints (mock-only):** sanctions screening match cards; treasury exposure/FX/NGN-float/sweeps; reconciliation break list + cron status; ops provider-board + webhook-queue depths + jobs registry; metrics GMV, daily volume-by-capability, system-health (provider latency/webhook-depth/recon-drift), live activity feed, approvals-awaiting-me count; agent guardrail params + tool registry + 24h cost/usage; whatsapp health + Flows registry + (redacted) conversation monitor; providers status/latency/mock-mode + readiness checklist; assets/currencies catalog reads; per-user limits/velocity + sessions + admin-note timeline; transactions amount(USDT+NGN)/asset/user-name/idempotency columns + view-tab counts + free-text search; tx-detail itemized params.
- **Surface backend-only reads:** per-user chat/intent log, per-user transactions filter, recentLedger, compliance-event detail, active-users + service-health metrics, template read/edit, agent conversation logs, system prompt preview.

### Phase 7 — Writes: actions, funds-safety flows, maker-checker

Build + wire all mutations. **Build the maker-checker / approvals subsystem FIRST** — it is foundational (every "enters Pending approval" toggle + high-risk config change + refund creates an approval request; the Approvals inbox and Dashboard "approvals awaiting me" consume it).

- **Approvals/maker-checker core:** change-request entity + create/approve/reject endpoints + inbox (Awaiting-me / My-requests) + the write path that routes high-risk changes (pricing spread, capability flip, tier override, refund) into it.
- **Engine-brokered money actions:** transaction refund (partial, maker-checker over threshold) via `settle*RefundAtomic`; **manual credit** (approved item — engine + maker-checker + audit); reconciliation resolve/accept; treasury payout/withdrawal approval; ops run-now (engine-action, no money).
- **Compliance/KYC writes:** KYC approve/reject/request-info; tier override; freeze/status; sanctions per-match clear/escalate/block + monitoring toggles; blocked add/remove; AML rule create/edit; SAR/CTR draft+submit; compliance-event disposition.
- **Config writes (real persistence):** flags/capabilities/currencies/assets toggles → real enable/disable (via maker-checker for high-risk); settings/pricing/limits edits; providers test-connection probe + reveal-key (step-up, last-4… keep providers' own key policy).
- **Comms writes:** notification-template CRUD; broadcast send/queue-for-approval (maker-checker on large audience); **bulk tag/message** (approved — tags model + bulk comms); resend-verification; add-note.

### Phase 8 — Full features, surfacing, polish

- **RBAC management UI:** roles/permissions editor, admins CRUD + invitations, reset-2FA-for-another-admin, admin display name, admin notification prefs.
- **Both-missing builds:** tickets event-catalog + vendor-payout-reconciliation; per-tx webhook history + re-run-recon; reconciliation→compliance-case escalation; refund-approval kind.
- **Surfacing leftovers:** MFA self-enroll (QR + recovery codes), theme-pref persistence, SIM-swap reverify trigger, wallet-backfill as an ops job, service-health on ops.
- **Exports:** CSV for Users / Ledger / Audit (audited, PII-minimised, filter-respecting).
- **Mock removal (per decision):** strip the full-PII-reveal flow (keep last-4); remove view-as re-scoping mock (keep honest role display); remove any remaining dead mock affordances.

## 5. Sequencing & method

1. The `web/` pre-existing-test fix (separate session) merges to `main` first; then pull `main` and branch off it — this program's PRs sit on top of that.
2. Per phase: author a detailed `docs/superpowers/plans/…` plan (TDD, contracts-first, exact files), run the implement workflow, adversarially verify (gates + live runtime), commit, checkpoint with the user.
3. Backend before FE within each feature: contract (Zod DTO + tests) → domain/application service → infrastructure repo (Prisma) → presentation controller (RBAC-gated) → e2e → FE api-client + query hook → wire the screen (four async branches) → runtime-verify.
4. Testcontainers Postgres for integration; ~100% coverage on money/compliance logic; `depcruise` clean; workspace typecheck + lint green.
