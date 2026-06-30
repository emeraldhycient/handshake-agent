/**
 * Prisma-backed implementation of IAmlRuleRepository (admin CRUD).
 *
 * `update` BUMPS the version (`version: { increment: 1 }`) so historical rule
 * evaluations stay attributable to the snapshot they ran on. Only this file
 * (infrastructure layer) imports the generated Prisma client; application and
 * domain never see it (CLAUDE.md §3.2 / §4.1).
 */

import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../../core/prisma/prisma.service';
import {
  AmlRuleAction,
  AmlRuleType,
  Prisma,
} from '../../../../generated/prisma/client';
import type {
  IAmlRuleRepository,
  AmlRuleRecord,
  CreateAmlRuleInput,
  UpdateAmlRuleInput,
} from '../application/ports/aml-rule.repository.port';

const RULE_SELECT = {
  id: true,
  ruleKey: true,
  name: true,
  description: true,
  enabled: true,
  ruleType: true,
  action: true,
  parameters: true,
  version: true,
} as const;

@Injectable()
export class AmlRulePrismaRepository implements IAmlRuleRepository {
  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<AmlRuleRecord[]> {
    const rows = await this.prisma.amlRule.findMany({
      select: RULE_SELECT,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    return rows.map(toRecord);
  }

  async findById(id: string): Promise<AmlRuleRecord | null> {
    const row = await this.prisma.amlRule.findUnique({
      where: { id },
      select: RULE_SELECT,
    });
    return row !== null ? toRecord(row) : null;
  }

  async create(
    input: CreateAmlRuleInput,
    adminId: string,
  ): Promise<AmlRuleRecord> {
    const row = await this.prisma.amlRule.create({
      data: {
        ruleKey: input.ruleKey,
        name: input.name,
        description: input.description,
        enabled: input.enabled,
        ruleType: input.ruleType,
        action: input.action,
        parameters: input.parameters as Prisma.InputJsonValue,
        createdByAdminId: adminId,
        updatedByAdminId: adminId,
      },
      select: RULE_SELECT,
    });
    return toRecord(row);
  }

  async update(
    id: string,
    patch: UpdateAmlRuleInput,
    adminId: string,
  ): Promise<AmlRuleRecord> {
    const row = await this.prisma.amlRule.update({
      where: { id },
      data: {
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.description !== undefined
          ? { description: patch.description }
          : {}),
        ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
        ...(patch.action !== undefined ? { action: patch.action } : {}),
        ...(patch.parameters !== undefined
          ? { parameters: patch.parameters as Prisma.InputJsonValue }
          : {}),
        // Every admin edit bumps the version and re-stamps the editor.
        version: { increment: 1 },
        updatedByAdminId: adminId,
      },
      select: RULE_SELECT,
    });
    return toRecord(row);
  }
}

function toRecord(row: {
  id: string;
  ruleKey: string;
  name: string;
  description: string;
  enabled: boolean;
  ruleType: AmlRuleType;
  action: AmlRuleAction;
  parameters: unknown;
  version: number;
}): AmlRuleRecord {
  return {
    id: row.id,
    ruleKey: row.ruleKey,
    name: row.name,
    description: row.description,
    enabled: row.enabled,
    ruleType: row.ruleType,
    action: row.action,
    parameters: (row.parameters ?? {}) as Record<string, unknown>,
    version: row.version,
  };
}
