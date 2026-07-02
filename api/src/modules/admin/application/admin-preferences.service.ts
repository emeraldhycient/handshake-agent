import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import { AuditService } from '../../../core/audit/application/audit.service';
import {
  ADMIN_PREFERENCES_REPOSITORY,
  type AdminPreferencesRecord,
  type IAdminPreferencesRepository,
} from './ports/admin-preferences.repository.port';

/** All-true default — a fresh admin (no persisted row) sees every toggle on. */
const DEFAULT_PREFERENCES: AdminPreferencesRecord = {
  emailAlerts: true,
  approvalMentions: true,
  weeklyDigest: true,
};

/**
 * ADM Phase 8 — the SELF-SCOPED admin notification-preferences service. An admin
 * reads and writes only their OWN row: the caller's adminId is threaded straight
 * from the authenticated principal (never a path/body param), so this surface can
 * never read or mutate another admin's preferences.
 *
 * `get` falls back to the all-true default when no row exists (a first-time admin
 * sees every toggle on). `update` is a full-state replace (the toggle UI always
 * submits all three flags), and every write is immutably audited as `admin_update`
 * with `subject = Admin:<self>` plus a before/after snapshot. It moves no money
 * (§3.1) and holds no Prisma import — it reaches data only through the injected
 * port (§3.2).
 */
@Injectable()
export class AdminPreferencesService {
  constructor(
    @Inject(ADMIN_PREFERENCES_REPOSITORY)
    private readonly repo: IAdminPreferencesRepository,
    private readonly audit: AuditService,
  ) {}

  /** The caller's persisted preferences, or the all-true default if none exist. */
  async get(adminId: string): Promise<AdminPreferencesRecord> {
    const stored = await this.repo.get(adminId);
    return stored ?? { ...DEFAULT_PREFERENCES };
  }

  /**
   * Full-state replace of the caller's own preferences. Upserts the row, audits the
   * change (before = prior state or the default, after = the new state), and returns
   * the persisted state.
   */
  async update(
    adminId: string,
    prefs: AdminPreferencesRecord,
  ): Promise<AdminPreferencesRecord> {
    const before = (await this.repo.get(adminId)) ?? { ...DEFAULT_PREFERENCES };
    const after = await this.repo.upsert(adminId, prefs);

    await this.audit.record({
      correlationId: randomUUID(),
      actorAdminId: adminId,
      subject: `Admin:${adminId}`,
      action: 'admin_update',
      before,
      after,
    });

    return after;
  }
}
