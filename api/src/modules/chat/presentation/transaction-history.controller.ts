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

import {
  TransactionHistoryQuerySchema,
  type TransactionHistoryResponse,
} from '@handshake-agent/contracts';

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

@Controller('transactions/history')
@UseGuards(JwtAuthGuard)
export class TransactionHistoryController {
  constructor(private readonly history: TransactionHistoryService) {}

  /**
   * First page (named period / relative spec / explicit from-to date range) OR a
   * keyset continuation. The presence of `cursor` is the discriminator: a cursor
   * request carries the FROZEN absolute window (full ISO from/to) so a relative
   * range ("today") cannot drift between page loads — the server skips
   * resolveWindow for those. Query shape is validated by the shared Zod schema
   * (no hand-rolled allow-lists); invalid input → 400.
   */
  @Get()
  async get(
    @CurrentUser() user: AuthenticatedUser,
    @Query() rawQuery: Record<string, string | undefined>,
  ): Promise<TransactionHistoryResponse> {
    const parsed = TransactionHistoryQuerySchema.safeParse(rawQuery);
    if (!parsed.success) {
      throw new BadRequestException('Invalid transaction-history query');
    }
    const q = parsed.data;

    if (q.cursor) {
      // Continuation page: the absolute (already-resolved) window is required so
      // the keyset seek targets the same window page-1 used.
      if (!q.from || !q.to) {
        throw new BadRequestException('A cursor page requires from and to');
      }
      const from = new Date(q.from);
      const to = new Date(q.to);
      if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
        throw new BadRequestException('Invalid from/to for a cursor page');
      }
      return this.history.queryPage({
        userId: user.userId,
        from,
        to,
        txType: q.txType ?? 'all',
        cursor: q.cursor,
        limit: q.limit,
      });
    }

    return this.history.query(user.userId, {
      period: q.period,
      from: q.from,
      to: q.to,
      relativeAmount: q.relativeAmount,
      relativeUnit: q.relativeUnit,
      txType: q.txType,
      limit: q.limit,
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
    // Full-range statement: gather EVERY row in the window (paged internally up
    // to the statementMaxRows safety cap), not just the first page.
    const inner = await this.history.queryAllInRange({
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
