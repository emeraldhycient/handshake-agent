import { BadRequestException } from '@nestjs/common';

import {
  TransactionHistoryController,
  StatementDownloadController,
} from './transaction-history.controller';
import type { TransactionHistoryService } from '../../transactions/application/transaction-history.service';
import type { StatementTokenService } from '../../transactions/application/statement-token.service';
import type { AuthenticatedUser } from '../../auth/presentation/jwt-auth.guard';

const USER = { userId: 'u1' } as AuthenticatedUser;

const RESP = {
  window: { from: 'F', to: 'T', label: 'This month' },
  items: [],
  totalCount: 0,
  truncated: false,
  hasMore: false,
  nextCursor: null,
  txType: 'all',
  downloadUrl:
    'https://api.example.com/transactions/statement/download?token=tok',
};

function makeController() {
  const history = {
    query: jest.fn().mockResolvedValue(RESP),
    queryPage: jest.fn().mockResolvedValue(RESP),
    queryAllInRange: jest
      .fn()
      .mockResolvedValue({ items: [], totalCount: 0, truncated: false }),
  };
  const controller = new TransactionHistoryController(
    history as unknown as TransactionHistoryService,
  );
  return { controller, history };
}

describe('TransactionHistoryController.get', () => {
  it('routes a named-period query to query() (not queryPage)', async () => {
    const { controller, history } = makeController();
    await controller.get(USER, { period: 'this_month' });
    expect(history.query).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({ period: 'this_month' }),
    );
    expect(history.queryPage).not.toHaveBeenCalled();
  });

  it('coerces + forwards a relative-duration query to query()', async () => {
    const { controller, history } = makeController();
    await controller.get(USER, { relativeAmount: '2', relativeUnit: 'week' });
    expect(history.query).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({ relativeAmount: 2, relativeUnit: 'week' }),
    );
  });

  it('routes a cursor request to queryPage() with the frozen absolute window', async () => {
    const { controller, history } = makeController();
    await controller.get(USER, {
      cursor: 'CUR',
      from: '2026-06-01T00:00:00.000Z',
      to: '2026-06-29T10:00:00.000Z',
      txType: 'send',
    });
    expect(history.query).not.toHaveBeenCalled();
    expect(history.queryPage).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u1',
        cursor: 'CUR',
        txType: 'send',
        from: new Date('2026-06-01T00:00:00.000Z'),
        to: new Date('2026-06-29T10:00:00.000Z'),
      }),
    );
  });

  it('rejects an invalid txType with 400 (via the shared schema)', async () => {
    const { controller } = makeController();
    await expect(
      controller.get(USER, { txType: 'gift' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a cursor request missing from/to with 400', async () => {
    const { controller } = makeController();
    await expect(
      controller.get(USER, { cursor: 'CUR' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an over-large limit with 400', async () => {
    const { controller } = makeController();
    await expect(controller.get(USER, { limit: '500' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

describe('StatementDownloadController.download', () => {
  function makeDownload() {
    const history = {
      queryAllInRange: jest
        .fn()
        .mockResolvedValue({ items: [], totalCount: 0, truncated: false }),
      queryResolved: jest.fn(),
    };
    const tokens = {
      verify: jest.fn().mockReturnValue({
        userId: 'u1',
        from: '2026-06-01T00:00:00.000Z',
        to: '2026-06-29T10:00:00.000Z',
        txType: 'all',
      }),
    };
    const generator = {
      generate: jest.fn().mockResolvedValue({
        buffer: Buffer.from('pdf'),
        contentType: 'application/pdf',
        filename: 'statement.pdf',
      }),
    };
    const controller = new StatementDownloadController(
      history as unknown as TransactionHistoryService,
      tokens as unknown as StatementTokenService,
      generator,
    );
    return { controller, history, generator };
  }

  it('gathers the FULL range via queryAllInRange (not the single-page queryResolved)', async () => {
    const { controller, history, generator } = makeDownload();
    await controller.download('valid.token');
    expect(history.queryAllInRange).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', txType: 'all' }),
    );
    expect(history.queryResolved).not.toHaveBeenCalled();
    expect(generator.generate).toHaveBeenCalledTimes(1);
  });
});
