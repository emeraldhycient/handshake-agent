import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import {
  AmlRuleCreateRequestSchema,
  AmlRuleUpdateRequestSchema,
  ComplianceDispositionRequestSchema,
  ComplianceReportDraftRequestSchema,
  ComplianceReportSubmitRequestSchema,
  SanctionsDispositionRequestSchema,
} from '@handshake-agent/contracts';

/** Query DTO for GET /admin/compliance/events (status/severity/userId + cursor). */
export const ComplianceEventQuerySchema = z.object({
  status: z.string().optional(),
  severity: z.string().optional(),
  userId: z.string().uuid().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
});
export class ComplianceEventQueryDto extends createZodDto(
  ComplianceEventQuerySchema,
) {}

/** Query DTO for the bounded sanctions / Travel-Rule feeds (optional limit). */
export const ComplianceFeedQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(200).optional(),
});
export class ComplianceFeedQueryDto extends createZodDto(
  ComplianceFeedQuerySchema,
) {}

/** Body DTO for POST /admin/compliance/events/:id/disposition. */
export class ComplianceDispositionDto extends createZodDto(
  ComplianceDispositionRequestSchema,
) {}

/** Body DTO for POST /admin/compliance/sanctions/:id/disposition. */
export class SanctionsDispositionDto extends createZodDto(
  SanctionsDispositionRequestSchema,
) {}

/** Body DTO for POST /admin/compliance/aml-rules. */
export class AmlRuleCreateDto extends createZodDto(
  AmlRuleCreateRequestSchema,
) {}

/** Body DTO for PATCH /admin/compliance/aml-rules/:id. */
export class AmlRuleUpdateDto extends createZodDto(
  AmlRuleUpdateRequestSchema,
) {}

/** Body DTO for POST /admin/compliance/reports. */
export class ComplianceReportDraftDto extends createZodDto(
  ComplianceReportDraftRequestSchema,
) {}

/** Body DTO for POST /admin/compliance/reports/:id/submit. */
export class ComplianceReportSubmitDto extends createZodDto(
  ComplianceReportSubmitRequestSchema,
) {}
