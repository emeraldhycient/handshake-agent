/**
 * PatService — mint / list / revoke personal access tokens (Wave C, PAT/MCP).
 *
 * Security invariants:
 *   - Minting is a SENSITIVE action: the user's transaction PIN is verified
 *     through the lockout-protected PinService BEFORE anything is created
 *     (§3.3/§3.4). PIN errors propagate untouched so the global filter maps
 *     them exactly like every other pin-verification surface.
 *   - The raw token (`hsk_pat_` + 32 CSPRNG bytes hex) is returned ONCE and
 *     never persisted — only its SHA-256 hex (core/crypto sha256Hex) is stored,
 *     mirroring the Session token-hashing pattern.
 *   - Scopes come from the shared PatScopeSchema ('read' | 'chat:propose');
 *     no execute scope exists, so a PAT can never move money (§3.1).
 */

import { randomBytes } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import {
  PAT_TOKEN_PREFIX,
  type CreatePatResponse,
  type PatListResponse,
  type PatScope,
} from '@handshake-agent/contracts';

import { sha256Hex } from '../../../core/crypto/hmac';
import { PinService } from '../../../core/auth/pin.service';
import { PatNotFoundError } from '../domain/pat-errors';
import {
  PAT_REPOSITORY,
  type IPatRepository,
  type PatRecord,
} from './ports/pat.repository.port';

const TOKEN_BYTES = 32;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface MintPatInput {
  userId: string;
  label: string;
  /** Raw transaction PIN — verified, never stored or logged. */
  pin: string;
  scopes: PatScope[];
  expiresInDays?: number;
}

@Injectable()
export class PatService {
  constructor(
    @Inject(PAT_REPOSITORY) private readonly patRepo: IPatRepository,
    private readonly pinService: PinService,
  ) {}

  /** Verifies the PIN, then mints and returns the raw token exactly once. */
  async mint(input: MintPatInput): Promise<CreatePatResponse> {
    // Lockout-protected PIN gate FIRST — nothing is created on failure.
    await this.pinService.verifyPin(input.userId, input.pin);

    const rawToken = `${PAT_TOKEN_PREFIX}${randomBytes(TOKEN_BYTES).toString('hex')}`;
    const scopes = [...new Set(input.scopes)];
    const expiresAt =
      input.expiresInDays !== undefined
        ? new Date(Date.now() + input.expiresInDays * DAY_MS)
        : null;

    const record = await this.patRepo.create({
      userId: input.userId,
      label: input.label,
      tokenHash: sha256Hex(rawToken),
      scopes,
      expiresAt,
    });

    return {
      id: record.id,
      label: record.label,
      scopes: record.scopes as PatScope[],
      token: rawToken,
      createdAt: record.createdAt.toISOString(),
      expiresAt: record.expiresAt?.toISOString() ?? null,
    };
  }

  /** Masked list — id/label/scopes/timestamps only; the token is unrecoverable. */
  async list(userId: string): Promise<PatListResponse> {
    const rows = await this.patRepo.listForUser(userId);
    return { tokens: rows.map((row) => this.toListItem(row)) };
  }

  /** Soft-revokes an OWNED token; foreign/unknown ids fail closed as not-found. */
  async revoke(userId: string, patId: string): Promise<void> {
    const revoked = await this.patRepo.revoke(userId, patId, new Date());
    if (!revoked) {
      throw new PatNotFoundError();
    }
  }

  private toListItem(row: PatRecord): PatListResponse['tokens'][number] {
    return {
      id: row.id,
      label: row.label,
      scopes: row.scopes as PatScope[],
      createdAt: row.createdAt.toISOString(),
      lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
      expiresAt: row.expiresAt?.toISOString() ?? null,
    };
  }
}
