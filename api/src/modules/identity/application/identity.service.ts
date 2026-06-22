import { Inject, Injectable } from '@nestjs/common';

import type {
  ContactRecord,
  IIdentityRepository,
  UserRecord,
} from './ports/identity.repository.port';
import { IDENTITY_REPOSITORY } from './ports/identity.repository.port';

// ---------------------------------------------------------------------------
// Output type
// ---------------------------------------------------------------------------

export type ResolvedIdentity =
  | { kind: 'user'; user: UserRecord; requiresReverification: boolean }
  | { kind: 'contact'; contact: ContactRecord };

// ---------------------------------------------------------------------------
// Input type — channel is a string so application stays decoupled from the
// Prisma enum. The infra layer passes raw string values from the DB records.
// ---------------------------------------------------------------------------

export interface ResolveByChannelInput {
  channel: string;
  channelAddress: string;
  normalizedPhone?: string;
}

/**
 * Application-layer identity resolution service. Resolves an inbound channel
 * address (e.g. a WhatsApp phone) to either a linked User or an unlinked Contact.
 *
 * Invariant (CLAUDE.md §3.4): identity is anchored to KYC + device + PIN —
 * NEVER the phone number. The phone is a routing key on ChannelIdentity only.
 */
@Injectable()
export class IdentityService {
  constructor(
    @Inject(IDENTITY_REPOSITORY)
    private readonly repo: IIdentityRepository,
  ) {}

  async resolveByChannel(
    input: ResolveByChannelInput,
  ): Promise<ResolvedIdentity> {
    const { channel, channelAddress, normalizedPhone } = input;

    const channelIdentity = await this.repo.findActiveChannelIdentity(
      channel,
      channelAddress,
    );

    // ── Case 1: known channel identity linked to a User ──
    if (channelIdentity !== null && channelIdentity.userId !== null) {
      const user = await this.repo.loadUser(channelIdentity.userId);

      if (user === null) {
        // Defensive: CI points to a non-existent User (data inconsistency).
        // Safe path: treat as a new contact rather than throwing, so no funds
        // are gated behind a corrupt FK. This should alert ops via monitoring.
        return this.createAndReturnContact({
          channel,
          channelAddress,
          normalizedPhone,
        });
      }

      const requiresReverification = Boolean(
        user.simSwapDetectedAt ?? channelIdentity.simSwapDetectedAt,
      );

      return { kind: 'user', user, requiresReverification };
    }

    // ── Case 2: known channel identity linked to a Contact (not yet a User) ──
    if (channelIdentity !== null && channelIdentity.contactId !== null) {
      const contact = await this.repo.loadContact(channelIdentity.contactId);

      if (contact === null) {
        // Defensive: CI points to a non-existent Contact (data inconsistency).
        return this.createAndReturnContact({
          channel,
          channelAddress,
          normalizedPhone,
        });
      }

      return { kind: 'contact', contact };
    }

    // ── Case 3: CI exists but has neither userId nor contactId (corrupt row) ──
    // Or Case 4: no CI exists at all → create Contact + ChannelIdentity.
    return this.createAndReturnContact({
      channel,
      channelAddress,
      normalizedPhone,
    });
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async createAndReturnContact(input: {
    channel: string;
    channelAddress: string;
    normalizedPhone?: string;
  }): Promise<{ kind: 'contact'; contact: ContactRecord }> {
    const { contact } = await this.repo.createContactWithChannelIdentity(input);
    return { kind: 'contact', contact };
  }
}
