import { z } from "zod";

// Admin BENEFICIARY OVERSIGHT DTOs (Phase 3, sub-area D) — read-only listing of
// saved payout destinations plus the cooling-off override surface. The type enum
// mirrors the Prisma `BeneficiaryType` (`02-identity.prisma`). A first-use crypto
// beneficiary carries a cooling-off lock (`firstUseLockedUntil`, IDN-08); an
// authorized admin can clear it (the override is a POST with no body). Single
// source of truth shared by the API (response parsing) and web-admin. Nothing
// here moves money (§3.1).

export const AdminBeneficiaryTypeSchema = z.enum([
  "bank_account",
  "crypto_address",
]);
export type AdminBeneficiaryType = z.infer<typeof AdminBeneficiaryTypeSchema>;

export const AdminBeneficiarySchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  type: AdminBeneficiaryTypeSchema,
  label: z.string(),
  verificationStatus: z.string(),
  firstUseLockedUntil: z.string().nullable(),
  // Derived: true iff firstUseLockedUntil is set AND still in the future.
  coolingOffActive: z.boolean(),
  createdAt: z.string(),
});
export type AdminBeneficiary = z.infer<typeof AdminBeneficiarySchema>;

export const AdminBeneficiaryListResponseSchema = z.object({
  items: z.array(AdminBeneficiarySchema),
});
export type AdminBeneficiaryListResponse = z.infer<
  typeof AdminBeneficiaryListResponseSchema
>;
