import { z } from "zod";

// Admin TREASURY-ACTION DTOs (Phase 7, WRITE) — the payout / withdrawal APPROVE
// action for the treasury approval queue (design §6.13). This is
// FUNDS-SAFETY-CRITICAL and never releases money directly: an approval is captured
// as a maker-checker CHANGE REQUEST that a DIFFERENT admin must confirm before the
// release is applied through the deterministic engine's atomic path (§3.1). The
// requester can never self-approve (four-eyes). Single source of truth shared by the
// API (request + response parsing) and web-admin. No end-user PII crosses this
// boundary — the payout is referenced by opaque id + reference only (§3.4).

// ── Request: raise a maker-checker approval for a queued payout ───────────────────
// `reason` is the maker's audited justification (3–500 chars, mirroring the
// change-request `reason` bounds). Raising an approval APPLIES NOTHING — it enters
// the four-eyes inbox for a second admin to confirm.
export const TreasuryPayoutApproveRequestSchema = z.object({
  reason: z.string().min(3).max(500),
});
export type TreasuryPayoutApproveRequest = z.infer<
  typeof TreasuryPayoutApproveRequestSchema
>;

// ── Response: the pending maker-checker request raised for this payout ────────────
// `payoutId` echoes the queued payout; `changeRequestId` is the pending
// change-request now awaiting a second admin; `status` is always "pending" (the
// release is NOT applied here — a four-eyes checker applies it). `released` is
// ALWAYS false — approving raises a request; it never moves money on this surface
// (§3.1). The always-false field makes the invariant explicit in the wire shape.
export const TreasuryPayoutApproveResponseSchema = z.object({
  payoutId: z.string(),
  changeRequestId: z.string(),
  status: z.literal("pending"),
  released: z.literal(false),
});
export type TreasuryPayoutApproveResponse = z.infer<
  typeof TreasuryPayoutApproveResponseSchema
>;

// ── Retry a stuck settling sell payout (go-readiness #2, WRITE — single-admin) ────
// `reason` is the operator's audited justification (3–500 chars, mirroring the
// approve/change-request bounds). Unlike approve, retry APPLIES the re-drive
// synchronously (single-admin step-up), but it moves NO money on this surface: it
// re-arms the EXISTING settlement outbox row so the engine's reconciler re-verifies
// the payout with the provider and finalises/refunds atomically (§3.1).
export const TreasuryPayoutRetryRequestSchema = z.object({
  reason: z.string().min(3).max(500),
});
export type TreasuryPayoutRetryRequest = z.infer<
  typeof TreasuryPayoutRetryRequestSchema
>;

// ── Response: the re-drive was enqueued for the offending sell payout ──────────────
// `payoutId` echoes the queued payout; `transactionId` is the SERVER-resolved sell
// transaction; `status` is always "retry_enqueued" (the engine settles asynchronously
// — no money moves here); `reChecked` is always true (the user passed the server-side
// KYC/status/compliance re-check before the re-drive was armed, §3.3).
export const TreasuryPayoutRetryResponseSchema = z.object({
  payoutId: z.string(),
  transactionId: z.string(),
  status: z.literal("retry_enqueued"),
  reChecked: z.boolean(),
});
export type TreasuryPayoutRetryResponse = z.infer<
  typeof TreasuryPayoutRetryResponseSchema
>;
