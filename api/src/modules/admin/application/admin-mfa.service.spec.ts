import { AdminMfaService } from './admin-mfa.service';
import type { AuditService } from '../../../core/audit/application/audit.service';
import type { IAdminUserRepository } from './ports/admin-user.repository.port';
import type { ITotpProvider } from './ports/totp.port';
import type { IPasswordHasher } from './ports/password-hasher.port';
import type { IMfaCipher } from './ports/mfa-cipher.port';

// Deterministic reversible fake — the real AES-256-GCM cipher is covered by its
// own infra spec; the application spec must not import infrastructure (§4).
const fakeCipher: IMfaCipher = {
  encrypt: (plain) => `enc:${Buffer.from(plain, 'utf8').toString('base64')}`,
  decrypt: (payload) =>
    Buffer.from(payload.replace(/^enc:/, ''), 'base64').toString('utf8'),
};

type Mocked = {
  svc: AdminMfaService;
  userRepo: jest.Mocked<IAdminUserRepository>;
  totp: jest.Mocked<ITotpProvider>;
  hasher: jest.Mocked<IPasswordHasher>;
  cipher: IMfaCipher;
  audit: jest.Mocked<AuditService>;
};

function build(): Mocked {
  const userRepo = {
    createInvited: jest.fn(),
    findByEmail: jest.fn(),
    findById: jest.fn(),
    list: jest.fn(),
    setStatus: jest.fn(),
    updateRole: jest.fn(),
    setDisplayName: jest.fn().mockResolvedValue(undefined),
    setPasswordAndActivate: jest.fn(),
    enableMfa: jest.fn().mockResolvedValue(undefined),
    disableMfa: jest.fn().mockResolvedValue(undefined),
    consumeRecoveryCode: jest.fn(),
    recordLogin: jest.fn(),
  } as unknown as jest.Mocked<IAdminUserRepository>;

  const totp = {
    generateSecret: jest.fn().mockReturnValue('TOTPSECRET'),
    keyUri: jest.fn().mockReturnValue('otpauth://totp/x'),
    verify: jest.fn(),
  } as unknown as jest.Mocked<ITotpProvider>;

  const hasher = {
    hash: jest.fn((plain: string) => Promise.resolve(`hashed:${plain}`)),
    verify: jest.fn((hash: string, plain: string) =>
      Promise.resolve(hash === `hashed:${plain}`),
    ),
  } as unknown as jest.Mocked<IPasswordHasher>;

  const audit = {
    record: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<AuditService>;

  const svc = new AdminMfaService(userRepo, totp, hasher, fakeCipher, audit);
  return { svc, userRepo, totp, hasher, cipher: fakeCipher, audit };
}

describe('AdminMfaService', () => {
  describe('enroll', () => {
    it('stores an encrypted secret + hashed recovery codes and returns plaintext codes + uri', async () => {
      const { svc, userRepo, totp } = build();
      const result = await svc.enroll('admin-1', 'admin@x.io');

      expect(totp.generateSecret).toHaveBeenCalled();
      expect(totp.keyUri).toHaveBeenCalledWith('admin@x.io', 'TOTPSECRET');
      expect(result.otpauthUri).toBe('otpauth://totp/x');
      expect(result.recoveryCodes).toHaveLength(8);

      expect(userRepo.enableMfa).toHaveBeenCalledTimes(1);
      const [adminId, encSecret, hashedCodes] =
        userRepo.enableMfa.mock.calls[0];
      expect(adminId).toBe('admin-1');
      // Encrypted (not the plaintext secret) and decryptable back to it.
      expect(encSecret).not.toBe('TOTPSECRET');
      expect(fakeCipher.decrypt(encSecret)).toBe('TOTPSECRET');
      // Recovery codes are hashed, not plaintext.
      expect(hashedCodes).toHaveLength(8);
      for (let i = 0; i < 8; i += 1) {
        expect(hashedCodes[i]).toBe(`hashed:${result.recoveryCodes[i]}`);
      }
    });

    it('generates unique recovery codes', async () => {
      const { svc } = build();
      const { recoveryCodes } = await svc.enroll('admin-1', 'admin@x.io');
      expect(new Set(recoveryCodes).size).toBe(recoveryCodes.length);
    });
  });

  describe('verifyForLogin', () => {
    const user = {
      id: 'admin-1',
      mfaEnabled: true,
      mfaSecret: fakeCipher.encrypt('TOTPSECRET'),
      mfaRecoveryCodes: ['hashed:CODE1', 'hashed:CODE2'],
    };

    it('returns true for a valid TOTP', async () => {
      const { svc, totp } = build();
      totp.verify.mockReturnValue(true);
      await expect(svc.verifyForLogin(user, '123456')).resolves.toBe(true);
      expect(totp.verify).toHaveBeenCalledWith('123456', 'TOTPSECRET');
    });

    it('returns false for a wrong TOTP', async () => {
      const { svc, totp } = build();
      totp.verify.mockReturnValue(false);
      await expect(svc.verifyForLogin(user, '000000')).resolves.toBe(false);
    });

    it('returns false when the stored secret is null', async () => {
      const { svc } = build();
      await expect(
        svc.verifyForLogin({ ...user, mfaSecret: null }, '123456'),
      ).resolves.toBe(false);
    });

    it('consumes a matching recovery code and returns true', async () => {
      const { svc, userRepo } = build();
      userRepo.consumeRecoveryCode.mockResolvedValue(true);
      await expect(svc.verifyForLogin(user, undefined, 'CODE1')).resolves.toBe(
        true,
      );
      expect(userRepo.consumeRecoveryCode).toHaveBeenCalledTimes(1);
    });

    it('returns false for an unknown recovery code', async () => {
      const { svc, userRepo } = build();
      userRepo.consumeRecoveryCode.mockResolvedValue(false);
      await expect(svc.verifyForLogin(user, undefined, 'NOPE')).resolves.toBe(
        false,
      );
    });

    it('returns false when neither a totp nor a recovery code is supplied', async () => {
      const { svc } = build();
      await expect(svc.verifyForLogin(user)).resolves.toBe(false);
    });
  });

  describe('resetForAdmin', () => {
    const now = new Date('2026-07-02T00:00:00Z');

    it('clears the target admin MFA via the repo and records an audit', async () => {
      const { svc, userRepo, audit } = build();

      await svc.resetForAdmin('target-1', 'actor-9', 'lost device', now);

      expect(userRepo.disableMfa).toHaveBeenCalledTimes(1);
      expect(userRepo.disableMfa).toHaveBeenCalledWith('target-1');

      expect(audit.record).toHaveBeenCalledTimes(1);
      const call = audit.record.mock.calls[0][0];
      expect(call.action).toBe('admin_override');
      expect(call.subject).toBe('Admin:target-1');
      expect(call.actorAdminId).toBe('actor-9');
      expect(call.details?.reason).toBe('lost device');
    });

    it('never surfaces any secret (returns void)', async () => {
      const { svc } = build();
      const result = await svc.resetForAdmin(
        'target-1',
        'actor-9',
        'reason',
        now,
      );
      expect(result).toBeUndefined();
    });
  });
});
