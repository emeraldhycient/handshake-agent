import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../../core/prisma/prisma.service';
import {
  type AdminPreferencesRecord,
  type IAdminPreferencesRepository,
} from '../application/ports/admin-preferences.repository.port';

/** The three boolean flags the projection returns (shared by both queries). */
const PREFERENCE_FIELDS = {
  emailAlerts: true,
  approvalMentions: true,
  weeklyDigest: true,
} as const;

/**
 * Prisma-backed self-scoped admin-preferences repository (ADM Phase 8). Reads and
 * writes the `admin_preferences` row keyed on adminId. `upsert` creates the row on
 * first PATCH (defaulting is all-true at the schema level, but a write always
 * carries the full explicit state). Only this infrastructure repository imports the
 * generated client via PrismaService (§3.2 / §4).
 */
@Injectable()
export class AdminPreferencesPrismaRepository implements IAdminPreferencesRepository {
  constructor(private readonly prisma: PrismaService) {}

  async get(adminId: string): Promise<AdminPreferencesRecord | null> {
    const row = await this.prisma.adminPreferences.findUnique({
      where: { adminId },
      select: PREFERENCE_FIELDS,
    });
    return row ?? null;
  }

  async upsert(
    adminId: string,
    prefs: AdminPreferencesRecord,
  ): Promise<AdminPreferencesRecord> {
    return this.prisma.adminPreferences.upsert({
      where: { adminId },
      create: { adminId, ...prefs },
      update: prefs,
      select: PREFERENCE_FIELDS,
    });
  }
}
