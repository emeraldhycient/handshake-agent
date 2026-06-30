import { AdminMfaService } from './admin-mfa.service';
import { MfaSecretCipher } from '../infrastructure/mfa-secret.cipher';
import type { IAdminUserRepository } from './ports/admin-user.repository.port';
import type { ITotpProvider } from './ports/totp.port';
import type { IPasswordHasher } from './ports/password-hasher.port';
import type { Env } from '../../../core/config/env.schema';

const ENC_KEY = 'a'.repeat(64);

type Mocked = {
  svc: AdminMfaService;
  userRepo: jest.Mocked<IAdminUserRepository>;
  totp: jest.Mocked<ITotpProvider>;
  hasher: jest.Mocked<IPasswordHasher>;
  cipher: MfaSecretCipher;
};

function build(): Mocked {
  const userRepo = {
    createInvited: jest.fn(),
    findByEmail: jest.fn(),
    findById: jest.fn(),
    list: jest.fn(),
    setStatus: jest.fn(),
    updateRole: jest.fn(),
    setPasswordAndActivate: jest.fn(),
    enableMfa: jest.fn().mockResolvedValue(undefined),
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

  const cipher = new MfaSecretCipher(ENC_KEY);

  const config = {
    get: (key: keyof Env) =>
      key === 'ADMIN_MFA_ENC_KEY' ? ENC_KEY : undefined,
  };

  const svc = new AdminMfaService(userRepo, totp, hasher, config as never);
  return { svc, userRepo, totp, hasher, cipher };
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
      const cipher = new MfaSecretCipher(ENC_KEY);
      expect(cipher.decrypt(encSecret)).toBe('TOTPSECRET');
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
      mfaSecret: new MfaSecretCipher(ENC_KEY).encrypt('TOTPSECRET'),
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
});
