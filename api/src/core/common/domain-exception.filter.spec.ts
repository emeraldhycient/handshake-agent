/**
 * Unit tests for DomainExceptionFilter (I1/I2).
 *
 * The filter must turn domain errors into the CORRECT HTTP status with a CLEAN,
 * client-safe message — never an opaque 500, and never leaking the raw domain
 * message, internal codes, or a stack trace. NestJS HttpExceptions (which the
 * controllers already produce) pass through unchanged.
 */

import { type ArgumentsHost, ForbiddenException, Logger } from '@nestjs/common';

import { DomainExceptionFilter } from './domain-exception.filter';
import {
  InsufficientBalanceError,
  ProposalExpiredError,
  QuoteDriftError,
  ProposalNotExecutableError,
  BaseRateMisconfiguredError,
} from '../../modules/transactions/domain/execution-errors';
import {
  KycNotVerifiedError,
  TierLimitExceededError,
  VelocityExceededError,
} from '../../modules/identity/domain/gate-errors';
import {
  SanctionsBlockedError,
  SanctionsScreeningUnavailableError,
} from '../../modules/compliance/domain/compliance-errors';
import { PinInvalidError } from '../../core/auth/domain/pin-errors';
import { AgentUnavailableError } from '../../modules/agent/domain/agent-errors';
import {
  BeneficiaryCoolingOffError,
  BeneficiaryNotFoundError,
  BeneficiaryWrongTypeError,
  InvalidAddressError,
  NameEnquiryFailedError,
} from '../../modules/beneficiaries/domain/beneficiary-errors';

interface ErrorBody {
  statusCode: number;
  message: string;
  error?: string;
  code?: string;
}

interface CapturedResponse {
  // Typed so reading mock.calls[0][0] is not an unsafe `any` access.
  status: jest.Mock<{ json: jest.Mock }, [number]>;
  json: jest.Mock<void, [ErrorBody]>;
}

function mockHost(): { host: ArgumentsHost; res: CapturedResponse } {
  const json = jest.fn<void, [ErrorBody]>();
  const status = jest
    .fn<{ json: jest.Mock }, [number]>()
    .mockReturnValue({ json });
  const host = {
    switchToHttp: () => ({
      getResponse: () => ({ status }),
      getRequest: () => ({ url: '/test' }),
    }),
  } as unknown as ArgumentsHost;
  return { host, res: { status, json } };
}

function run(filter: DomainExceptionFilter, err: unknown) {
  const { host, res } = mockHost();
  filter.catch(err, host);
  const statusCode = res.status.mock.calls[0][0];
  const body = res.json.mock.calls[0][0];
  return { statusCode, body };
}

describe('DomainExceptionFilter', () => {
  let filter: DomainExceptionFilter;

  beforeEach(() => {
    filter = new DomainExceptionFilter();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('maps InsufficientBalanceError → 422 with a clean message (no raw balances leaked)', () => {
    const { statusCode, body } = run(
      filter,
      new InsufficientBalanceError('0', '5', 'USDT'),
    );
    expect(statusCode).toBe(422);
    expect(body.statusCode).toBe(422);
    expect(body.message).toBe('Insufficient balance for this transaction.');
    // The raw domain message reveals exact balances — it must NOT reach the client.
    expect(JSON.stringify(body)).not.toContain('have 0, need 5');
  });

  it('maps AgentUnavailableError → 503 (not an opaque 500)', () => {
    const { statusCode, body } = run(filter, new AgentUnavailableError());
    expect(statusCode).toBe(503);
    expect(body.statusCode).toBe(503);
    expect(body.message).toMatch(/temporarily unavailable/i);
  });

  it.each([
    [new KycNotVerifiedError('status'), 403],
    [new TierLimitExceededError(1000, 500, '1', 'NGN'), 403],
    [new VelocityExceededError('fiat', 1000, 500, '1', 'NGN'), 403],
    [new SanctionsBlockedError('addr', 'flagged', 'evt-1', 'ref-1'), 403],
    [new ProposalExpiredError(), 422],
    [new QuoteDriftError(150, 100), 422],
    [new ProposalNotExecutableError('bad state'), 409],
    [new BaseRateMisconfiguredError('USDT', 'NGN'), 503],
    [new SanctionsScreeningUnavailableError('chainalysis'), 503],
    [new PinInvalidError(3), 401],
    // Beneficiary errors were previously uncoded → opaque 500s. They now map.
    [
      new BeneficiaryCoolingOffError('ben-1', new Date('2099-01-01T00:00:00Z')),
      403,
    ],
    [new BeneficiaryNotFoundError('ben-1'), 404],
    [new InvalidAddressError('TRON', 'not-an-address'), 422],
    [
      new BeneficiaryWrongTypeError('ben-1', 'crypto_address', 'bank_account'),
      422,
    ],
    [new NameEnquiryFailedError('058', '0000000000', 'not found'), 422],
  ])('maps %s → %i', (err, expected) => {
    const { statusCode } = run(filter, err);
    expect(statusCode).toBe(expected);
  });

  it('does NOT leak the compliance event id for a sanctions block', () => {
    const { body } = run(
      filter,
      new SanctionsBlockedError('addr', 'OFAC hit', 'evt-secret-123', 'ref'),
    );
    expect(JSON.stringify(body)).not.toContain('evt-secret-123');
  });

  it('does NOT leak the internal beneficiary id for a cooling-off block', () => {
    const { statusCode, body } = run(
      filter,
      new BeneficiaryCoolingOffError('ben-secret-uuid', new Date('2099-01-01')),
    );
    expect(statusCode).toBe(403);
    expect(body.message).toMatch(/cooling-off period/i);
    expect(JSON.stringify(body)).not.toContain('ben-secret-uuid');
  });

  it('passes a NestJS HttpException through with its own status', () => {
    const { statusCode, body } = run(filter, new ForbiddenException('nope'));
    expect(statusCode).toBe(403);
    expect(body.message).toBe('nope');
  });

  it('maps an unknown error → generic 500, never leaking message or stack', () => {
    const secret = new Error('DB password is hunter2');
    const { statusCode, body } = run(filter, secret);
    expect(statusCode).toBe(500);
    expect(body.message).toBe('Something went wrong. Please try again.');
    expect(JSON.stringify(body)).not.toContain('hunter2');
    expect(JSON.stringify(body)).not.toContain('stack');
  });

  it('maps an error with an UNKNOWN code → generic 500 (only allow-listed codes are mapped)', () => {
    // e.g. a Prisma error carries a `code` like "P2002" — must NOT be exposed.
    const prismaLike = Object.assign(new Error('unique constraint'), {
      code: 'P2002',
    });
    const { statusCode, body } = run(filter, prismaLike);
    expect(statusCode).toBe(500);
    expect(JSON.stringify(body)).not.toContain('P2002');
  });
});
