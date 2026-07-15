import {
  KycDomainError,
  SumsubPrerequisiteNotMetError,
  AlreadyVerifiedError,
} from './kyc-errors';

describe('kyc-errors', () => {
  it('expose stable codes and remain instanceof KycDomainError/Error', () => {
    const cases: [KycDomainError, string][] = [
      [
        new SumsubPrerequisiteNotMetError('tier_2', 'tier_1', 'unverified'),
        'SUMSUB_PREREQUISITE_NOT_MET',
      ],
      [new AlreadyVerifiedError('user-123'), 'ALREADY_VERIFIED'],
    ];
    for (const [err, code] of cases) {
      expect(err).toBeInstanceOf(KycDomainError);
      expect(err).toBeInstanceOf(Error);
      expect(err.code).toBe(code);
      expect(err.name).toBe(err.constructor.name);
      expect(err.message.length).toBeGreaterThan(0);
    }
  });

  it('SumsubPrerequisiteNotMetError carries the requested/required/actual tiers in its message', () => {
    const err = new SumsubPrerequisiteNotMetError('tier_3', 'tier_2', 'tier_1');
    expect(err.requestedLevel).toBe('tier_3');
    expect(err.requiredTier).toBe('tier_2');
    expect(err.actualTier).toBe('tier_1');
    expect(err.message).toContain('tier_3');
    expect(err.message).toContain('tier_2');
    expect(err.message).toContain('tier_1');
  });

  it('AlreadyVerifiedError carries the existing userId in its message (idempotent-signal)', () => {
    const err = new AlreadyVerifiedError('user-abc');
    expect(err.userId).toBe('user-abc');
    expect(err.message).toContain('user-abc');
  });
});
