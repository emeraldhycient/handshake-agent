/**
 * Unit tests for AdminWalletsController + AdminTokenGuard (WN-5).
 *
 * TDD: tests written first (red → green → refactor).
 *
 * Covers:
 *   1. Guard: ADMIN_API_TOKEN unset → 403 for every request.
 *   2. Guard: wrong token → 403.
 *   3. Guard: correct token → calls WalletBackfillService + returns report.
 *   4. Body is parsed via the contract DTO (batchSize / dryRun forwarded).
 */

import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ZodValidationPipe } from 'nestjs-zod';

import type { BackfillReport } from '@handshake-agent/contracts';
import { AdminWalletsController } from './admin-wallets.controller';
import { AdminTokenGuard } from '../guards/admin-token.guard';
import { WalletBackfillService } from '../../wallets/application/wallet-backfill.service';
import { BackfillNetworksDto } from './dto/backfill-networks.dto';
import type { Env } from '../../../core/config/env.schema';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FAKE_REPORT: BackfillReport = {
  usersScanned: 5,
  perNetwork: { TRON: { alreadyHad: 3, provisioned: 2 } },
  failures: [],
};

function makeBackfillServiceMock() {
  return {
    backfillMissingNetworkAddresses: jest.fn().mockResolvedValue(FAKE_REPORT),
  };
}

/**
 * Build a TestingModule with the guard wired against a given ADMIN_API_TOKEN value.
 */
async function buildModule(
  adminToken: string,
  backfillSvc = makeBackfillServiceMock(),
): Promise<{ controller: AdminWalletsController; module: TestingModule }> {
  const configStub: Partial<ConfigService<Env, true>> = {
    get: jest.fn().mockImplementation((key: string) => {
      if (key === 'ADMIN_API_TOKEN') return adminToken;
      return undefined;
    }) as ConfigService<Env, true>['get'],
  };

  const module = await Test.createTestingModule({
    controllers: [AdminWalletsController],
    providers: [
      { provide: WalletBackfillService, useValue: backfillSvc },
      { provide: ConfigService, useValue: configStub },
      ZodValidationPipe,
    ],
  }).compile();

  const controller = module.get(AdminWalletsController);
  return { controller, module };
}

// ---------------------------------------------------------------------------
// Helper: invoke the guard directly
// ---------------------------------------------------------------------------

function makeGuard(configuredToken: string): AdminTokenGuard {
  const configStub: Partial<ConfigService<Env, true>> = {
    get: jest.fn().mockReturnValue(configuredToken) as ConfigService<
      Env,
      true
    >['get'],
  };
  return new AdminTokenGuard(configStub as ConfigService<Env, true>);
}

function makeExecutionContext(authHeader?: string) {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        headers: authHeader ? { authorization: authHeader } : {},
      }),
    }),
  } as Parameters<AdminTokenGuard['canActivate']>[0];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AdminTokenGuard', () => {
  it('denies all requests when ADMIN_API_TOKEN is not set (empty string)', () => {
    const guard = makeGuard('');
    expect(() => guard.canActivate(makeExecutionContext('Bearer any'))).toThrow(
      ForbiddenException,
    );
  });

  it('denies all requests when ADMIN_API_TOKEN is undefined', () => {
    const configStub: Partial<ConfigService<Env, true>> = {
      get: jest.fn().mockReturnValue(undefined) as ConfigService<
        Env,
        true
      >['get'],
    };
    const guard = new AdminTokenGuard(configStub as ConfigService<Env, true>);
    expect(() => guard.canActivate(makeExecutionContext('Bearer any'))).toThrow(
      ForbiddenException,
    );
  });

  it('denies when the supplied token is wrong', () => {
    const guard = makeGuard('correct-token-secret');
    expect(() =>
      guard.canActivate(makeExecutionContext('Bearer wrong-token')),
    ).toThrow(ForbiddenException);
  });

  it('denies when the Authorization header is missing entirely', () => {
    const guard = makeGuard('correct-token');
    expect(() => guard.canActivate(makeExecutionContext())).toThrow(
      ForbiddenException,
    );
  });

  it('denies when the Authorization header lacks Bearer prefix', () => {
    const guard = makeGuard('correct-token');
    expect(() =>
      guard.canActivate(makeExecutionContext('correct-token')),
    ).toThrow(ForbiddenException);
  });

  it('permits when the supplied token matches (constant-time)', () => {
    const guard = makeGuard('super-secret-admin-token');
    const ctx = makeExecutionContext('Bearer super-secret-admin-token');
    expect(guard.canActivate(ctx)).toBe(true);
  });
});

describe('AdminWalletsController', () => {
  it('calls WalletBackfillService.backfillMissingNetworkAddresses and returns the report', async () => {
    const backfillSvc = makeBackfillServiceMock();
    const { controller } = await buildModule('any-token', backfillSvc);

    const dto: BackfillNetworksDto = {
      batchSize: 50,
      dryRun: true,
    };
    const result = await controller.backfillNetworks(dto);

    expect(backfillSvc.backfillMissingNetworkAddresses).toHaveBeenCalledWith({
      batchSize: 50,
      dryRun: true,
    });
    expect(result).toEqual(FAKE_REPORT);
  });

  it('forwards undefined options when DTO fields are absent', async () => {
    const backfillSvc = makeBackfillServiceMock();
    const { controller } = await buildModule('any-token', backfillSvc);

    const dto: BackfillNetworksDto = {};
    await controller.backfillNetworks(dto);

    expect(backfillSvc.backfillMissingNetworkAddresses).toHaveBeenCalledWith({
      batchSize: undefined,
      dryRun: undefined,
    });
  });
});
