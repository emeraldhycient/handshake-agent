/**
 * Unit tests for BullBoardBasicAuthMiddleware (BQ-1, fail-closed).
 *
 * Verifies:
 *   1. 401 when ADMIN_API_TOKEN is unset (fail-closed).
 *   2. 401 when no Authorization header is supplied.
 *   3. 401 when credentials are wrong.
 *   4. next() called when credentials are correct (username arbitrary, password = token).
 */
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule, ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';

import { BullBoardBasicAuthMiddleware } from './bull-board.middleware';

function makeReqRes(authHeader?: string): {
  req: Partial<Request>;
  res: {
    status: jest.Mock;
    json: jest.Mock;
    setHeader: jest.Mock;
  };
  next: jest.Mock;
} {
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    setHeader: jest.fn().mockReturnThis(),
  };
  return {
    req: { headers: authHeader ? { authorization: authHeader } : {} },
    res,
    next: jest.fn(),
  };
}

function basicAuth(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
}

async function buildMiddleware(
  token: string,
): Promise<BullBoardBasicAuthMiddleware> {
  const module: TestingModule = await Test.createTestingModule({
    imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true })],
    providers: [BullBoardBasicAuthMiddleware],
  })
    .overrideProvider(ConfigService)
    .useValue({
      get: (key: string) => (key === 'ADMIN_API_TOKEN' ? token : undefined),
    })
    .compile();

  return module.get(BullBoardBasicAuthMiddleware);
}

describe('BullBoardBasicAuthMiddleware', () => {
  describe('fail-closed: ADMIN_API_TOKEN unset', () => {
    it('returns 401 when the token is empty string', async () => {
      const middleware = await buildMiddleware('');
      const { req, res, next } = makeReqRes();

      middleware.use(req as Request, res as unknown as Response, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('ADMIN_API_TOKEN is set', () => {
    const TOKEN = 'super-secret-admin-token-abc123';

    let middleware: BullBoardBasicAuthMiddleware;

    beforeEach(async () => {
      middleware = await buildMiddleware(TOKEN);
    });

    it('returns 401 when no Authorization header is provided', () => {
      const { req, res, next } = makeReqRes();
      middleware.use(req as Request, res as unknown as Response, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    it('returns 401 when Authorization header is not Basic', () => {
      const { req, res, next } = makeReqRes(`Bearer ${TOKEN}`);
      middleware.use(req as Request, res as unknown as Response, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    it('returns 401 when the password is wrong', () => {
      const { req, res, next } = makeReqRes(
        basicAuth('admin', 'wrong-password'),
      );
      middleware.use(req as Request, res as unknown as Response, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    it('calls next() when the correct password is supplied (username arbitrary)', () => {
      const { req, res, next } = makeReqRes(basicAuth('anything', TOKEN));
      middleware.use(req as Request, res as unknown as Response, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
    });

    it('calls next() regardless of the username (only password matters)', () => {
      const { req, res, next } = makeReqRes(basicAuth('', TOKEN));
      middleware.use(req as Request, res as unknown as Response, next);

      expect(next).toHaveBeenCalledTimes(1);
    });
  });
});
