/**
 * DI token and port for the compliance-report repository (SAR/STR filings).
 *
 * ComplianceReport is the SAR/STR filing record (AUD-10): drafted by an admin from
 * related compliance events, then submitted with a filing-authority confirmation
 * ref. Infrastructure implements this port with Prisma; the application layer
 * never imports the generated client (CLAUDE.md §3.2 / §4.1).
 */
export const COMPLIANCE_REPORT_REPOSITORY = Symbol(
  'COMPLIANCE_REPORT_REPOSITORY',
);

/** App-layer unions mirroring the Prisma report enums. */
export type ComplianceReportTypeValue = 'sar' | 'str';
export type ComplianceReportStatusValue =
  | 'draft'
  | 'submitted'
  | 'rejected'
  | 'closed';

/** DB-agnostic projection of a compliance report (list/detail summary). */
export interface ComplianceReportRecord {
  id: string;
  reportType: ComplianceReportTypeValue;
  status: ComplianceReportStatusValue;
  relatedEvents: string[];
  submittedAt: Date | null;
  submissionRef: string | null;
  createdAt: Date;
}

export interface CreateComplianceReportInput {
  reportType: ComplianceReportTypeValue;
  relatedEvents: string[];
  content: Record<string, unknown>;
}

export interface IComplianceReportRepository {
  /** All reports, newest-first. */
  list(): Promise<ComplianceReportRecord[]>;

  /** One report by id; null if absent. */
  findById(id: string): Promise<ComplianceReportRecord | null>;

  /** Create a draft (status='draft'), stamping createdByAdminId = adminId. */
  createDraft(
    input: CreateComplianceReportInput,
    adminId: string,
  ): Promise<ComplianceReportRecord>;

  /**
   * Submit a drafted report: sets status='submitted', submissionRef, submittedAt.
   * Returns the updated record.
   */
  submit(
    id: string,
    submissionRef: string,
    at: Date,
  ): Promise<ComplianceReportRecord>;
}
