import { z } from "zod";

import { KycStatusSchema, KycTierSchema } from "./user-mgmt.dto";

// KYC review-queue DTOs — the compliance reviewer's surface. PII is minimized:
// only the last 4 digits of NIN/BVN are surfaced (the API truncates; secrets
// are encrypted at rest). KycStatus/KycTier are reused from user-mgmt.dto, not
// redefined. Single source of truth shared by the API and web-admin.

export const KycQueueItemSchema = z.object({
  userId: z.string().uuid(),
  email: z.string().nullable(),
  status: KycStatusSchema,
  submittedAt: z.string().nullable(),
});
export type KycQueueItem = z.infer<typeof KycQueueItemSchema>;

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
