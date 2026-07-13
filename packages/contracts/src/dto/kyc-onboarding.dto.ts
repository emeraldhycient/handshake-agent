import { z } from "zod";

/**
 * The two KYC tiers reachable through the Sumsub-driven onboarding upgrade
 * path. tier_1 is the default post-signup tier and is never requested here —
 * a user only calls the Sumsub token endpoint to step UP to tier_2 or tier_3.
 */
export const KycTierLevelSchema = z.enum(["tier_2", "tier_3"]);
export type KycTierLevel = z.infer<typeof KycTierLevelSchema>;

/**
 * Request DTO for the set-name step of onboarding. Captures only the display
 * name early in onboarding (before identity documents are collected via Sumsub).
 */
export const SetNameRequestSchema = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
});
export type SetNameRequest = z.infer<typeof SetNameRequestSchema>;

/** Request DTO for POST to mint a Sumsub WebSDK access token. */
export const SumsubTokenRequestSchema = z.object({
  level: KycTierLevelSchema,
});
export type SumsubTokenRequest = z.infer<typeof SumsubTokenRequestSchema>;

/** Response DTO carrying the minted Sumsub WebSDK access token. */
export const SumsubTokenResponseSchema = z.object({
  token: z.string().min(1),
  userId: z.string().uuid(),
});
export type SumsubTokenResponse = z.infer<typeof SumsubTokenResponseSchema>;

/** Sumsub's `reviewResult` shape, as carried on the `applicantReviewed` webhook. */
export const SumsubReviewResultSchema = z.object({
  reviewAnswer: z.enum(["GREEN", "RED"]),
  reviewRejectType: z.enum(["FINAL", "RETRY"]).optional(),
  rejectLabels: z.array(z.string()).optional(),
});
export type SumsubReviewResult = z.infer<typeof SumsubReviewResultSchema>;

/**
 * Inbound Sumsub webhook payload — a boundary schema for a third-party
 * webhook, intentionally loose. Only `type` and `externalUserId` (our own
 * userId) are required so the handler can route on those two fields even
 * when Sumsub sends event types this schema does not fully model; every
 * other field is optional. Mirrors the `applicantReviewed` webhook shape.
 */
export const SumsubWebhookPayloadSchema = z.object({
  type: z.string(), // e.g. "applicantReviewed"
  applicantId: z.string().optional(),
  externalUserId: z.string().min(1), // === our userId
  levelName: z.string().optional(),
  reviewResult: SumsubReviewResultSchema.optional(),
});
export type SumsubWebhookPayload = z.infer<typeof SumsubWebhookPayloadSchema>;
