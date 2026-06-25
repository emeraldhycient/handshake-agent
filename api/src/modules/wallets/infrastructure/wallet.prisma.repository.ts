import { Injectable } from '@nestjs/common';

import { Network, WalletStatus } from '../../../../generated/prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import type {
  IWalletRepository,
  WalletRecord,
  CreateWalletData,
} from '../application/ports/wallet.repository.port';

/**
 * Prisma adapter for the wallet repository port. Maps DB rows to the
 * application-level `WalletRecord` type; the application layer never sees
 * Prisma-generated types (clean-arch §4.1, CLAUDE.md §3.2).
 *
 * WN-1: wallet is per (user, network) — `asset` field removed from Wallet.
 * Uses generated Prisma enums (`Network`, `WalletStatus`) directly — no
 * `as never` casts (brief instruction).
 */
@Injectable()
export class WalletPrismaRepository implements IWalletRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByUserNetwork(
    userId: string,
    network: string,
  ): Promise<WalletRecord | null> {
    const row = await this.prisma.wallet.findUnique({
      where: {
        userId_network: {
          userId,
          network: network as Network,
        },
      },
      select: {
        id: true,
        userId: true,
        network: true,
        address: true,
        providerReference: true,
        status: true,
      },
    });

    if (row === null) return null;

    return this.toRecord(row);
  }

  async findByAddress(address: string): Promise<WalletRecord | null> {
    const row = await this.prisma.wallet.findUnique({
      where: { address },
      select: {
        id: true,
        userId: true,
        network: true,
        address: true,
        providerReference: true,
        status: true,
      },
    });

    if (row === null) return null;

    return this.toRecord(row);
  }

  async create(data: CreateWalletData): Promise<WalletRecord> {
    const row = await this.prisma.wallet.create({
      data: {
        userId: data.userId,
        network: data.network as Network,
        address: data.address,
        providerReference: data.providerReference,
        status: data.status as WalletStatus,
        provisionedAt: data.provisionedAt,
      },
      select: {
        id: true,
        userId: true,
        network: true,
        address: true,
        providerReference: true,
        status: true,
      },
    });

    return this.toRecord(row);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private toRecord(row: {
    id: string;
    userId: string;
    network: Network;
    address: string;
    providerReference: string;
    status: WalletStatus;
  }): WalletRecord {
    return {
      id: row.id,
      userId: row.userId,
      network: row.network,
      address: row.address,
      providerReference: row.providerReference,
      status: row.status,
    };
  }
}
