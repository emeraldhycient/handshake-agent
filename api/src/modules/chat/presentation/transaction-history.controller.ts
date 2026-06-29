/**
 * Transaction-history read endpoints.
 *
 *   GET /transactions/history            — JWT; the authenticated user's history.
 *   GET /transactions/statement/download — PUBLIC; authorized by a signed token
 *                                          (so a browser opened from a WhatsApp
 *                                          link works). Streams a PDF statement.
 *
 * Security: history is scoped to the JWT user's id; the download token is bound to
 * a single userId + window. Read-only — the engine is never touched (§3.1).
 *
 * Route ordering: registered BEFORE TransactionStatusController so the literal
 * `transactions/history` path is matched before `transactions/:id` (Express 5).
 */
import {
  BadRequestException,
  Controller,
  Get,
  Inject,
  Query,
  ServiceUnavailableException,
  StreamableFile,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';

import type { TransactionHistoryResponse } from '@handshake-agent/contracts';

import {
  JwtAuthGuard,
  type AuthenticatedUser,
} from '../../auth/presentation/jwt-auth.guard';
import { CurrentUser } from '../../auth/presentation/current-user.decorator';

import { TransactionHistoryService } from '../../transactions/application/transaction-history.service';
import {
  StatementTokenService,
  StatementTokenInvalidError,
  StatementNotSignableError,
  type StatementTokenPayload,
} from '../../transactions/application/statement-token.service';
import {
  STATEMENT_GENERATOR,
  type IStatementGenerator,
} from '../../transactions/application/ports/statement-generator.port';
import { buildStatementModel } from '../../transactions/application/statement-model';

const PERIODS = new Set([
  'today',
  'yesterday',
  'this_week',
  'last_week',
  'this_month',
  'last_month',
  'all',
]);
const TX_TYPES = new Set(['buy', 'sell', 'send', 'receive', 'all']);

@Controller('transactions/history')
@UseGuards(JwtAuthGuard)
export class TransactionHistoryController {
  constructor(private readonly history: TransactionHistoryService) {}

  @Get()
  async get(
    @CurrentUser() user: AuthenticatedUser,
    @Query('period') period?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('txType') txType?: string,
  ): Promise<TransactionHistoryResponse> {
    if (period !== undefined && !PERIODS.has(period)) {
      throw new BadRequestException('invalid period');
    }
    if (txType !== undefined && !TX_TYPES.has(txType)) {
      throw new BadRequestException('invalid txType');
    }
    return this.history.query(user.userId, {
      period: period as never,
      from,
      to,
      txType: txType as never,
    });
  }
}

@Controller('transactions/statement')
export class StatementDownloadController {
  constructor(
    private readonly history: TransactionHistoryService,
    private readonly tokens: StatementTokenService,
    @Inject(STATEMENT_GENERATOR)
    private readonly generator: IStatementGenerator,
  ) {}

  @Get('download')
  async download(@Query('token') token: string): Promise<StreamableFile> {
    let payload: StatementTokenPayload;
    try {
      payload = this.tokens.verify(token ?? '');
    } catch (err) {
      if (err instanceof StatementNotSignableError) {
        throw new ServiceUnavailableException(
          'Statement downloads are not configured',
        );
      }
      if (err instanceof StatementTokenInvalidError) {
        throw new UnauthorizedException('Invalid or expired download link');
      }
      throw err;
    }

    const from = new Date(payload.from);
    const to = new Date(payload.to);
    const inner = await this.history.queryResolved({
      userId: payload.userId,
      from,
      to,
      txType: payload.txType,
    });

    const fromDay = payload.from.slice(0, 10);
    const toDay = payload.to.slice(0, 10);
    const model = buildStatementModel({
      items: inner.items,
      totalCount: inner.totalCount,
      truncated: inner.truncated,
      windowLabel: `${fromDay} – ${toDay}`,
      accountLabel: maskUser(payload.userId),
      generatedAt: to.toISOString(),
      filename: `handshake-statement-${fromDay}_${toDay}.pdf`,
    });

    const file = await this.generator.generate(model);
    return new StreamableFile(file.buffer, {
      type: file.contentType,
      disposition: `attachment; filename="${file.filename}"`,
      length: file.buffer.length,
    });
  }
}

function maskUser(userId: string): string {
  return userId.length <= 8 ? userId : `${userId.slice(0, 8)}…`;
}
