import { Injectable } from '@nestjs/common';

import {
  SupportedAsset,
  Network,
  WalletStatus,
} from '../../../../generated/prisma/client';
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
 * Uses generated Prisma enums (`SupportedAsset`, `Network`, `WalletStatus`)
 * directly — no `as never` casts (brief instruction).
 */
@Injectable()
export class WalletPrismaRepository implements IWalletRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByUserAssetNetwork(
    userId: string,
    asset: string,
    network: string,
  ): Promise<WalletRecord | null> {
    const row = await this.prisma.wallet.findUnique({
      where: {
        userId_asset_network: {
          userId,
          asset: asset as SupportedAsset,
          network: network as Network,
        },
      },
      select: {
        id: true,
        userId: true,
        asset: true,
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
        asset: data.asset as SupportedAsset,
        network: data.network as Network,
        address: data.address,
        providerReference: data.providerReference,
        status: data.status as WalletStatus,
        provisionedAt: data.provisionedAt,
      },
      select: {
        id: true,
        userId: true,
        asset: true,
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
    asset: SupportedAsset;
    network: Network;
    address: string;
    providerReference: string;
    status: WalletStatus;
  }): WalletRecord {
    return {
      id: row.id,
      userId: row.userId,
      asset: row.asset,
      network: row.network,
      address: row.address,
      providerReference: row.providerReference,
      status: row.status,
    };
  }
}
