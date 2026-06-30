/**
 * Typed admin compliance-console API clients (Phase 3, sub-area C) — flagged-event
 * disposition, sanctions denylist visibility, AML-rule CRUD, Travel-Rule list, and
 * SAR/STR reports. Each parses its input through the request schema before the
 * request fires and parses the response through the response schema after (§3.3 /
 * §8: the FE gate is UX, never the only check; shapes that cross the boundary come
 * from contracts).
 *
 * The list filters (event status/severity/userId; feed limit) are internal read
 * queries scoped to the API presentation layer — not cross-boundary bodies — so
 * their param shapes are declared locally here. Disposition / AML-write /
 * report-submit are sensitive and may 403 with ADMIN_STEP_UP_REQUIRED; the caller
 * wraps them in `useStepUpRetry`.
 *
 * This file lives in `lib/` and must NOT import from `components/` or `app/`.
 */
import {
  ComplianceEventListResponseSchema,
  ComplianceEventDetailSchema,
  ComplianceDispositionRequestSchema,
  SanctionsRecordListResponseSchema,
  AmlRuleListResponseSchema,
  AmlRuleSchema,
  AmlRuleCreateRequestSchema,
  AmlRuleUpdateRequestSchema,
  TravelRuleListResponseSchema,
  ComplianceReportListResponseSchema,
  ComplianceReportSchema,
  ComplianceReportDraftRequestSchema,
  ComplianceReportSubmitRequestSchema,
  type ComplianceEventListResponse,
  type ComplianceEventDetail,
  type ComplianceDispositionRequest,
  type SanctionsRecordListResponse,
  type AmlRuleListResponse,
  type AmlRule,
  type AmlRuleCreateRequest,
  type AmlRuleUpdateRequest,
  type TravelRuleListResponse,
  type ComplianceReportListResponse,
  type ComplianceReport,
  type ComplianceReportDraftRequest,
  type ComplianceReportSubmitRequest,
} from "@handshake-agent/contracts"

import { api } from "./client"

/** The flagged-event queue filter (mirrors the API presentation DTO). */
export interface ComplianceEventQuery {
  status?: string
  severity?: string
  userId?: string
  cursor?: string
  limit?: number
}

// ─── Events ─────────────────────────────────────────────────────────────────────

/** GET /admin/compliance/events — the flagged-event queue. */
export async function listComplianceEvents(
  query: ComplianceEventQuery
): Promise<ComplianceEventListResponse> {
  const res = await api.get("/admin/compliance/events", { params: query })
  return ComplianceEventListResponseSchema.parse(res.data)
}

/** GET /admin/compliance/events/:id — one event's detail (raw screening payload). */
export async function getComplianceEvent(
  id: string
): Promise<ComplianceEventDetail> {
  const res = await api.get(`/admin/compliance/events/${id}`)
  return ComplianceEventDetailSchema.parse(res.data)
}

/** Sensitive — may 403 with code ADMIN_STEP_UP_REQUIRED. Returns the updated event. */
export async function disposeComplianceEvent(
  id: string,
  input: ComplianceDispositionRequest
): Promise<ComplianceEventDetail> {
  const body = ComplianceDispositionRequestSchema.parse(input)
  const res = await api.post(`/admin/compliance/events/${id}/disposition`, body)
  return ComplianceEventDetailSchema.parse(res.data)
}

// ─── Sanctions ──────────────────────────────────────────────────────────────────

/** GET /admin/compliance/sanctions — immutable screening-run history (read-only). */
export async function listSanctions(): Promise<SanctionsRecordListResponse> {
  const res = await api.get("/admin/compliance/sanctions")
  return SanctionsRecordListResponseSchema.parse(res.data)
}

// ─── AML rules ──────────────────────────────────────────────────────────────────

/** GET /admin/compliance/aml-rules — the admin-tunable engine rules. */
export async function listAmlRules(): Promise<AmlRuleListResponse> {
  const res = await api.get("/admin/compliance/aml-rules")
  return AmlRuleListResponseSchema.parse(res.data)
}

/** Sensitive — may 403 with code ADMIN_STEP_UP_REQUIRED. Returns the created rule. */
export async function createAmlRule(
  input: AmlRuleCreateRequest
): Promise<AmlRule> {
  const body = AmlRuleCreateRequestSchema.parse(input)
  const res = await api.post("/admin/compliance/aml-rules", body)
  return AmlRuleSchema.parse(res.data)
}

/** Sensitive — may 403 with code ADMIN_STEP_UP_REQUIRED. Returns the updated rule. */
export async function updateAmlRule(
  id: string,
  input: AmlRuleUpdateRequest
): Promise<AmlRule> {
  const body = AmlRuleUpdateRequestSchema.parse(input)
  const res = await api.patch(`/admin/compliance/aml-rules/${id}`, body)
  return AmlRuleSchema.parse(res.data)
}

// ─── Travel Rule ────────────────────────────────────────────────────────────────

/** GET /admin/compliance/travel-rule — qualifying-transfer capture (read-only). */
export async function listTravelRule(): Promise<TravelRuleListResponse> {
  const res = await api.get("/admin/compliance/travel-rule")
  return TravelRuleListResponseSchema.parse(res.data)
}

// ─── Reports ────────────────────────────────────────────────────────────────────

/** GET /admin/compliance/reports — SAR/STR filings. */
export async function listComplianceReports(): Promise<ComplianceReportListResponse> {
  const res = await api.get("/admin/compliance/reports")
  return ComplianceReportListResponseSchema.parse(res.data)
}

/** Sensitive — may 403 with code ADMIN_STEP_UP_REQUIRED. Returns the drafted report. */
export async function draftComplianceReport(
  input: ComplianceReportDraftRequest
): Promise<ComplianceReport> {
  const body = ComplianceReportDraftRequestSchema.parse(input)
  const res = await api.post("/admin/compliance/reports", body)
  return ComplianceReportSchema.parse(res.data)
}

/** Sensitive — may 403 with code ADMIN_STEP_UP_REQUIRED. Returns the submitted report. */
export async function submitComplianceReport(
  id: string,
  input: ComplianceReportSubmitRequest
): Promise<ComplianceReport> {
  const body = ComplianceReportSubmitRequestSchema.parse(input)
  const res = await api.post(`/admin/compliance/reports/${id}/submit`, body)
  return ComplianceReportSchema.parse(res.data)
}
