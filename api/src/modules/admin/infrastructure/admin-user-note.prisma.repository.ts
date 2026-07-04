import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../../core/prisma/prisma.service';
import {
  type AdminUserNoteRecord,
  type CreateAdminUserNoteInput,
  type IAdminUserNoteRepository,
} from '../application/ports/admin-user-note.repository.port';

/**
 * Prisma-backed operator user-notes repository (ADM Phase 9). Appends and lists rows
 * on the `admin_user_notes` table (AdminUserNote model). Notes are append-only, so
 * only `create` and `listForUser` exist — there is no update/delete. `listForUser`
 * orders newest-first. Only this infrastructure repository imports the generated
 * client via PrismaService (§3.2 / §4). The returned rows carry native `Date`s; the
 * application service renders them to ISO at the boundary.
 */
@Injectable()
export class AdminUserNotePrismaRepository implements IAdminUserNoteRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(input: CreateAdminUserNoteInput): Promise<AdminUserNoteRecord> {
    return this.prisma.adminUserNote.create({
      data: {
        userId: input.userId,
        authorAdminId: input.authorAdminId,
        body: input.body,
      },
    });
  }

  listForUser(userId: string): Promise<AdminUserNoteRecord[]> {
    return this.prisma.adminUserNote.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }
}
