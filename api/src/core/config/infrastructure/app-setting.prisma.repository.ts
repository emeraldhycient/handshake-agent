import { Injectable } from '@nestjs/common';

import { Prisma } from '../../../../generated/prisma/client';
import type { AppSetting } from '../../../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  type AppSettingRow,
  type AppSettingScope,
  type IAppSettingRepository,
  type UpsertAppSettingInput,
} from '../application/ports/app-setting.repository.port';

/**
 * Prisma adapter for the DB-admin config layer (root CLAUDE.md §7). Realizes the
 * pure `IAppSettingRepository` port; the generated client lives only here, never
 * leaking Prisma types up to application/domain (§3.2). The composite key
 * `(key, scope, scopeValue)` is unique, but `scopeValue` is nullable — and a
 * Prisma compound-unique `where` cannot carry a null — so reads and upserts both
 * use `findFirst` to match the nullable column uniformly.
 */
@Injectable()
export class AppSettingPrismaRepository implements IAppSettingRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findAllEditable(): Promise<AppSettingRow[]> {
    const rows = await this.prisma.appSetting.findMany({
      where: { isEditable: true },
    });
    return rows.map(toRow);
  }

  async findAll(): Promise<AppSettingRow[]> {
    const rows = await this.prisma.appSetting.findMany();
    return rows.map(toRow);
  }

  async findByKey(
    key: string,
    scope: AppSettingScope,
    scopeValue: string | null,
  ): Promise<AppSettingRow | null> {
    const row = await this.prisma.appSetting.findFirst({
      where: { key, scope, scopeValue },
    });
    return row ? toRow(row) : null;
  }

  async upsert(input: UpsertAppSettingInput): Promise<AppSettingRow> {
    // findFirst + update/create rather than `upsert`: the unique target is the
    // composite (key, scope, scopeValue), but its compound-unique `where` input
    // requires a non-null scopeValue, so it cannot address a global (null) row.
    const existing = await this.prisma.appSetting.findFirst({
      where: {
        key: input.key,
        scope: input.scope,
        scopeValue: input.scopeValue,
      },
      select: { id: true },
    });

    const row = existing
      ? await this.prisma.appSetting.update({
          where: { id: existing.id },
          data: {
            value: input.value as Prisma.InputJsonValue,
            isSecret: input.isSecret,
            isEditable: input.isEditable,
            updatedByAdminId: input.updatedByAdminId,
          },
        })
      : await this.prisma.appSetting.create({
          data: {
            key: input.key,
            value: input.value as Prisma.InputJsonValue,
            scope: input.scope,
            scopeValue: input.scopeValue,
            isSecret: input.isSecret,
            isEditable: input.isEditable,
            updatedByAdminId: input.updatedByAdminId,
          },
        });

    return toRow(row);
  }
}

function toRow(row: AppSetting): AppSettingRow {
  return {
    key: row.key,
    // The DB column is Json (Prisma `JsonValue`); it widens to the port's
    // `unknown` with no assertion, so no Prisma type leaks past the boundary.
    value: row.value,
    scope: row.scope,
    scopeValue: row.scopeValue,
    isSecret: row.isSecret,
    isEditable: row.isEditable,
  };
}
