import { z } from "zod";

import { KycStatusSchema, KycTierSchema } from "./user-mgmt.dto";

// KYC review-queue DTOs — the compliance reviewer's surface. PII is minimized:
// only the last 4 digits of NIN/BVN are surfaced (the API truncates; secrets
// are encrypted at rest). KycStatus/KycTier are reused from user-mgmt.dto, not
// redefined. Single source of truth shared by the API and web-admin.

export const KycQueueItemSchema = z.object({
  userId: z.string().uuid(),
  email: z.string().nullable(),
  // Applicant display name from the KYC profile (first + last); null until the
  // applicant has captured their name. The queue falls back to email in the UI.
  displayName: z.string().nullable(),
  // The tier the applicant is requesting (the KYC profile's target tier); null
  // when no KYC profile row exists yet.
  requestedTier: KycTierSchema.nullable(),
  status: KycStatusSchema,
  submittedAt: z.string().nullable(),
  // Age of the submission in whole seconds (now − submittedAt), computed
  // server-side so the SLA-age column is deterministic. 0 when submittedAt is null.
  slaAgeSeconds: z.number().int().nonnegative(),
});
export type KycQueueItem = z.infer<typeof KycQueueItemSchema>;

// Query params for GET /admin/kyc/queue. `status` feeds the design's status tabs
// (Pending / Needs-info / Approved / Rejected); it defaults to pending_review
// server-side when omitted. Cursor-paginated; `limit` is coerced from its string
// query-param form and bounded.
export const KycQueueQuerySchema = z.object({
  status: KycStatusSchema.optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
});
export type KycQueueQuery = z.infer<typeof KycQueueQuerySchema>;

export const KycQueueResponseSchema = z.object({
  items: z.array(KycQueueItemSchema),
  nextCursor: z.string().nullable(),
});
export type KycQueueResponse = z.infer<typeof KycQueueResponseSchema>;

// Last-4 only for NIN/BVN — PII minimization (the API truncates the full value).
export const KycSubmissionDetailSchema = z.object({
  userId: z.string().uuid(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  dateOfBirth: z.string().nullable(),
  ninLast4: z.string().nullable(),
  bvnLast4: z.string().nullable(),
  idDocumentType: z.string().nullable(),
  livenessResult: z.string(),
  status: KycStatusSchema,
  tier: KycTierSchema,
  rejectionReason: z.string().nullable(),
});
export type KycSubmissionDetail = z.infer<typeof KycSubmissionDetailSchema>;

// Approval promotes to a verified tier — never back to 'unverified'.
export const KycApproveRequestSchema = z.object({
  tier: z.enum(["tier_1", "tier_2", "tier_3"]),
});
export type KycApproveRequest = z.infer<typeof KycApproveRequestSchema>;

export const KycRejectRequestSchema = z.object({
  reason: z.string().min(1),
});
export type KycRejectRequest = z.infer<typeof KycRejectRequestSchema>;
