import { z } from "zod";

// Admin COMPLIANCE CONSOLE DTOs (Phase 3, sub-area C) — flagged-event disposition,
// sanctions denylist visibility, AML-rule CRUD, Travel-Rule list, and SAR/STR
// reports. The enums mirror the Prisma audit/compliance schema (`01-audit.prisma`):
// ComplianceStatus, Severity, ScreeningVerdict, AmlRuleType, AmlRuleAction,
// TravelRuleTrigger, ComplianceReportType, ComplianceReportStatus. Single source of
// truth shared by the API (request validation + response parsing) and web-admin.
// Nothing here moves money (§3.1) — these shapes only project / annotate existing
// compliance rows.

// ── Shared enums ────────────────────────────────────────────────────────────────
export const ComplianceEventStatusSchema = z.enum([
  "flagged",
  "under_review",
  "approved",
  "blocked",
  "dismissed",
]);
export type ComplianceEventStatus = z.infer<typeof ComplianceEventStatusSchema>;

export const ComplianceSeveritySchema = z.enum([
  "low",
  "medium",
  "high",
  "critical",
]);
export type ComplianceSeverity = z.infer<typeof ComplianceSeveritySchema>;

// ── Compliance events — flagged-event queue + disposition ─────────────────────────
export const ComplianceEventItemSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  transactionId: z.string().nullable(),
  eventType: z.string(),
  severity: ComplianceSeveritySchema,
  status: ComplianceEventStatusSchema,
  screeningProvider: z.string(),
  ruleOrHit: z.string().nullable(),
  createdAt: z.string(),
});
export type ComplianceEventItem = z.infer<typeof ComplianceEventItemSchema>;

export const ComplianceEventListResponseSchema = z.object({
  items: z.array(ComplianceEventItemSchema),
  nextCursor: z.string().nullable(),
});
export type ComplianceEventListResponse = z.infer<
  typeof ComplianceEventListResponseSchema
>;

export const ComplianceEventDetailSchema = ComplianceEventItemSchema.extend({
  details: z.record(z.unknown()),
  dispositionComment: z.string().nullable(),
  dispositionAt: z.string().nullable(),
});
export type ComplianceEventDetail = z.infer<typeof ComplianceEventDetailSchema>;

// `under_review` is a valid disposition target (move into review); `flagged` is the
// initial state and is intentionally NOT a target. `comment` is the audited note.
export const ComplianceDispositionRequestSchema = z.object({
  status: z.enum(["approved", "blocked", "dismissed", "under_review"]),
  comment: z.string().optional(),
});
export type ComplianceDispositionRequest = z.infer<
  typeof ComplianceDispositionRequestSchema
>;

// ── Sanctions records — immutable screening-run history (read-only) ────────────────
// Enrichment (Phase 6b): the admin match-card design needs a human matched-list
// name, a human match-type label, and a numeric confidence for the Score slot —
// none of which exist as first-class columns on the immutable SanctionsRecord.
// They are DERIVED server-side from the columns that DO exist (matchedList ⇐
// provider, matchType ⇐ screeningType, matchScore ⇐ verdict band) so the operator
// sees a labelled card without any schema change or fabricated per-row data.
export const SanctionsRecordItemSchema = z.object({
  id: z.string().uuid(),
  counterpartyId: z.string(),
  verdict: z.enum(["clear", "hit", "inconclusive"]),
  provider: z.string(),
  screeningType: z.string(),
  /** Human matched-list name derived from `provider` (e.g. "OpenSanctions"). */
  matchedList: z.string(),
  /** Human match-type label derived from `screeningType` (e.g. "Counterparty match"). */
  matchType: z.string(),
  /** 0–100 confidence banded from `verdict` (hit → high, inconclusive → mid,
   *  clear → low). Not a fabricated precise score — a bounded verdict projection. */
  matchScore: z.number().int().min(0).max(100),
  createdAt: z.string(),
});
export type SanctionsRecordItem = z.infer<typeof SanctionsRecordItemSchema>;

export const SanctionsRecordListResponseSchema = z.object({
  items: z.array(SanctionsRecordItemSchema),
});
export type SanctionsRecordListResponse = z.infer<
  typeof SanctionsRecordListResponseSchema
>;

// ── Ongoing-monitoring policy view (read-only) ─────────────────────────────────────
// The four sanctions ongoing-monitoring policy flags shown on the admin sanctions
// screen. They live in layered AppSetting config (root §7); this read-only view
// projects the effective values. Toggling them is a Phase-7 write.
export const SanctionsMonitoringViewSchema = z.object({
  /** Re-screen all customers daily against updated lists. */
  reScreenDaily: z.boolean(),
  /** Screen every counterparty on outbound transfer. */
  screenOnOutbound: z.boolean(),
  /** Alert on new PEP (politically exposed person) matches. */
  pepAlert: z.boolean(),
  /** Auto-block confirmed OFAC SDN-list hits. */
  autoBlockOfac: z.boolean(),
});
export type SanctionsMonitoringView = z.infer<
  typeof SanctionsMonitoringViewSchema
>;

// ── AML rules — admin-tunable, versioned engine rules (CRUD) ───────────────────────
export const AmlRuleSchema = z.object({
  id: z.string().uuid(),
  ruleKey: z.string(),
  name: z.string(),
  description: z.string(),
  enabled: z.boolean(),
  ruleType: z.enum([
    "velocity_amount",
    "velocity_count",
    "behavior_pattern",
    "kyc_gate",
    "rate_limit",
  ]),
  action: z.enum(["flag", "block"]),
  parameters: z.record(z.unknown()),
  version: z.number(),
});
export type AmlRule = z.infer<typeof AmlRuleSchema>;

export const AmlRuleListResponseSchema = z.object({
  rules: z.array(AmlRuleSchema),
});
export type AmlRuleListResponse = z.infer<typeof AmlRuleListResponseSchema>;

export const AmlRuleCreateRequestSchema = z.object({
  ruleKey: z.string(),
  name: z.string(),
  description: z.string(),
  ruleType: z.enum([
    "velocity_amount",
    "velocity_count",
    "behavior_pattern",
    "kyc_gate",
    "rate_limit",
  ]),
  action: z.enum(["flag", "block"]),
  parameters: z.record(z.unknown()),
  enabled: z.boolean().default(true),
});
export type AmlRuleCreateRequest = z.infer<typeof AmlRuleCreateRequestSchema>;

export const AmlRuleUpdateRequestSchema = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  enabled: z.boolean().optional(),
  action: z.enum(["flag", "block"]).optional(),
  parameters: z.record(z.unknown()).optional(),
});
export type AmlRuleUpdateRequest = z.infer<typeof AmlRuleUpdateRequestSchema>;

// ── Travel Rule — qualifying-transfer capture (read-only) ──────────────────────────
export const TravelRuleItemSchema = z.object({
  id: z.string().uuid(),
  transactionId: z.string(),
  asset: z.string(),
  amount: z.string(),
  amountFiat: z.string(),
  triggeringFactor: z.string(),
  capturedAt: z.string(),
  reportedAt: z.string().nullable(),
});
export type TravelRuleItem = z.infer<typeof TravelRuleItemSchema>;

export const TravelRuleListResponseSchema = z.object({
  items: z.array(TravelRuleItemSchema),
});
export type TravelRuleListResponse = z.infer<
  typeof TravelRuleListResponseSchema
>;

// ── Compliance reports — SAR/STR filings (draft + submit) ──────────────────────────
export const ComplianceReportSchema = z.object({
  id: z.string().uuid(),
  reportType: z.enum(["sar", "str"]),
  status: z.enum(["draft", "submitted", "rejected", "closed"]),
  relatedEvents: z.array(z.string()),
  submittedAt: z.string().nullable(),
  submissionRef: z.string().nullable(),
  createdAt: z.string(),
});
export type ComplianceReport = z.infer<typeof ComplianceReportSchema>;

export const ComplianceReportListResponseSchema = z.object({
  items: z.array(ComplianceReportSchema),
});
export type ComplianceReportListResponse = z.infer<
  typeof ComplianceReportListResponseSchema
>;

export const ComplianceReportDraftRequestSchema = z.object({
  reportType: z.enum(["sar", "str"]),
  relatedEvents: z.array(z.string()),
  content: z.record(z.unknown()),
});
export type ComplianceReportDraftRequest = z.infer<
  typeof ComplianceReportDraftRequestSchema
>;

export const ComplianceReportSubmitRequestSchema = z.object({
  submissionRef: z.string().min(1),
});
export type ComplianceReportSubmitRequest = z.infer<
  typeof ComplianceReportSubmitRequestSchema
>;
