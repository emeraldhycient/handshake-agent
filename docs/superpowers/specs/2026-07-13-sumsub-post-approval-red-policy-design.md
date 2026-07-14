# Sumsub post-approval RED — enforcement policy (hybrid: auto-downgrade + compliance flag)

**Date:** 2026-07-13
**Branch:** `feat/sumsub-red-compliance-flag` (off `feat/onboarding-redesign`)
**Status:** design + implemented
**Relates to:** root CLAUDE.md §3.1 / §3.3, `docs/onboarding-redesign`, the Sumsub webhook vertical (`sumsub-webhook.handler.ts`).

## Problem

The capability gate (`kyc-gate.service.ts`) decides purely on `kycTier` (+ SIM-swap /
cooling-off / limits) and no longer reads `kycStatus`. On a Sumsub RED webhook the
handler previously called `markSumsubRejected`, which set `kycStatus='rejected'` but
**preserved `kycTier`**. Consequence: a RED delivered **after** a prior GREEN grant
(re-review / ongoing-monitoring flags fraud on a tier_2/tier_3 applicant) left the user
with full send/sell/swap capability — the RED had **zero enforcement effect**. Only a
manual admin `setKycTier` stopped them.

This is a compliance-policy gap, not a code bug (a single `kycStatus` can't distinguish
"tier_2 rejected" from "tier_3 attempt rejected, tier_2 still valid"). It blocked go-live
sign-off.

## Decision

Adopt the **hybrid** policy for a post-approval RED:

1. **Auto-downgrade (deterministic containment).** A RED at a known level drops the user
   to the rung directly below it — a **tier_2-level RED → tier_1**, a **tier_3-level RED →
   tier_2** — never raising a tier. This re-locks send/sell/swap at the lower tier's gate
   (§3.3), closing the cash-out window immediately without a human in the loop.
   *(Landed separately on the branch: commit `8021858`, `downgradeSumsubTier` + mapper
   `downgradeTo` + `tier-order.tierBelow`.)*
2. **Compliance flag (human backstop).** Every post-approval RED for a known user also
   raises a `kyc_escalation` `ComplianceEvent` (status `flagged`) into the existing admin
   flagged-event queue, so an operator reviews it and can **reinstate a false positive**
   the deterministic downgrade would otherwise lock out. *(This spec's delta.)*

The two halves are complementary: (1) contains the fraud/AML risk instantly; (2) catches
the false positives that pure auto-revoke would strand — and covers the **fail-safe case**
where the RED's level is unmapped (no downgrade possible, but the flag still fires so
nothing slips through silently).

### Alternatives considered
- **(a) Alert/flag only, no auto-revoke** — safest against false-positive lockouts, but
  leaves the cash-out path open until a human acts (a weekend RED = full capability all
  weekend). Rejected as the *sole* mechanism.
- **(b) Auto-downgrade only** — deterministic, but no human path to reinstate a false
  positive, and no operator visibility. Rejected as the *sole* mechanism.
- **(c) Leave as-is** — rejected; it's the go-live blocker itself.

## Sub-decisions
- **FINAL vs RETRY:** downgrade on **both**. A `RETRY` RED is self-healing — a later GREEN
  restores the tier via `grantSumsubTier`'s no-downgrade grant — so downgrading is safe and
  recoverable. `reviewRejectType` is recorded on the flag.
- **Severity:** `FINAL → high`, `RETRY → medium` (derived in-code). `critical` stays
  reserved for sanctions-class hits.
- **Idempotency:** the webhook queue processes each delivery once but re-runs a handler that
  throws mid-way (BullMQ retry). Tier + status writes are already idempotent; flag creation
  is guarded by `findLatestOpenByUserAndType(userId, 'kyc_escalation')` — if an **open**
  (`flagged`/`under_review`) case already exists, skip. This never loses a flag on retry and
  never piles duplicate open cases (a fresh RED while one is still open, or a replay). Once
  the case is disposed, a genuinely new adverse RED raises a fresh flag. Flag `details` are
  derived from the payload (stable across retries), never the observed pre/post tier.

## Components (this delta)
| Layer | File | Change |
|---|---|---|
| app (port) | `compliance/.../ports/compliance-event.repository.port.ts` | `findLatestOpenByUserAndType(userId, eventType)` |
| infra | `compliance/infrastructure/compliance-event.prisma.repository.ts` | implement finder (`findFirst`, status ∈ {flagged, under_review}, latest) |
| app (handler) | `identity/application/sumsub-webhook.handler.ts` | inject `COMPLIANCE_EVENT_REPOSITORY`; raise the idempotent `kyc_escalation` flag on a known-user RED |
| wiring | `identity/sumsub-webhook.module.ts` | import `ComplianceModule` (acyclic; boundary allowed by `.dependency-cruiser.cjs`, mirrors admin/transactions) |
| tests | handler spec, e2e (`sumsub-webhook.e2e-spec.ts`), + 3 compliance-event mock updates | flag created (severity by FINAL/RETRY), dedup, unknown-user no-op; e2e proves the flag end-to-end + no duplicate on replay |

## Verification
Unit (`jest`) + api typecheck green. E2e (`sumsub-webhook.e2e-spec.ts`, real Postgres via
Testcontainers): a signed post-GREEN RED downgrades tier_2→tier_1, re-locks the `crypto.send`
gate, **and** flags exactly one `kyc_escalation` `ComplianceEvent`; a replayed RED adds no
duplicate. `depcruise` must be run on Node ≤22 (the boundary is unchanged in kind — an
`application → compliance/application/ports` import that admin/transactions already make).
