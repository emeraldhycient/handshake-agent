/**
 * Prisma-backed implementation of IComplianceReportRepository (SAR/STR filings).
 *
 * Only this file (infrastructure layer) imports the generated Prisma client;
 * application and domain never see it (CLAUDE.md §3.2 / §4.1).
 */

import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../../core/prisma/prisma.service';
import {
  ComplianceReportStatus,
  ComplianceReportType,
  Prisma,
} from '../../../../generated/prisma/client';
import type {
  IComplianceReportRepository,
  ComplianceReportRecord,
  CreateComplianceReportInput,
} from '../application/ports/compliance-report.repository.port';

const REPORT_SELECT = {
  id: true,
  reportType: true,
  status: true,
  relatedEvents: true,
  submittedAt: true,
  submissionRef: true,
  createdAt: true,
} as const;

@Injectable()
export class ComplianceReportPrismaRepository implements IComplianceReportRepository {
  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<ComplianceReportRecord[]> {
    const rows = await this.prisma.complianceReport.findMany({
      select: REPORT_SELECT,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    return rows.map(toRecord);
  }

  async findById(id: string): Promise<ComplianceReportRecord | null> {
    const row = await this.prisma.complianceReport.findUnique({
      where: { id },
      select: REPORT_SELECT,
    });
    return row !== null ? toRecord(row) : null;
  }

  async createDraft(
    input: CreateComplianceReportInput,
    adminId: string,
  ): Promise<ComplianceReportRecord> {
    const row = await this.prisma.complianceReport.create({
      data: {
        reportType: input.reportType,
        relatedEvents: input.relatedEvents,
        content: input.content as Prisma.InputJsonValue,
        status: 'draft',
        createdByAdminId: adminId,
      },
      select: REPORT_SELECT,
    });
    return toRecord(row);
  }

  async submit(
    id: string,
    submissionRef: string,
    at: Date,
  ): Promise<ComplianceReportRecord> {
    const row = await this.prisma.complianceReport.update({
      where: { id },
      data: {
        status: 'submitted',
        submissionRef,
        submittedAt: at,
      },
      select: REPORT_SELECT,
    });
    return toRecord(row);
  }
}

function toRecord(row: {
  id: string;
  reportType: ComplianceReportType;
  status: ComplianceReportStatus;
  relatedEvents: string[];
  submittedAt: Date | null;
  submissionRef: string | null;
  createdAt: Date;
}): ComplianceReportRecord {
  return {
    id: row.id,
    reportType: row.reportType,
    status: row.status,
    relatedEvents: row.relatedEvents,
    submittedAt: row.submittedAt,
    submissionRef: row.submissionRef,
    createdAt: row.createdAt,
  };
}
