import { Argon2PasswordHasher } from './argon2-password.hasher';

describe('Argon2PasswordHasher', () => {
  const hasher = new Argon2PasswordHasher();

  it('verifies a correct password against its hash', async () => {
    const hash = await hasher.hash('pw');
    await expect(hasher.verify(hash, 'pw')).resolves.toBe(true);
  });

  it('rejects a wrong password', async () => {
    const hash = await hasher.hash('pw');
    await expect(hasher.verify(hash, 'wrong')).resolves.toBe(false);
  });

  it('returns false (does not throw) for a malformed hash string', async () => {
    await expect(hasher.verify('not-a-valid-hash', 'pw')).resolves.toBe(false);
  });

  it('produces a different hash for the same input (random salt)', async () => {
    const a = await hasher.hash('pw');
    const b = await hasher.hash('pw');
    expect(a).not.toBe(b);
  });
});
