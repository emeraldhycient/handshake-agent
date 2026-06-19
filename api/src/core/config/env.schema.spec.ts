import { validateEnv } from './env.schema';

const validRaw = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/handshake_agent',
};

describe('validateEnv', () => {
  it('applies defaults for omitted optional vars', () => {
    const env = validateEnv(validRaw);

    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(3000);
    expect(env.AGENT_MODEL).toBe('claude-opus-4-8');
  });

  it('coerces PORT from a string to a number', () => {
    const env = validateEnv({ ...validRaw, PORT: '4000' });

    expect(env.PORT).toBe(4000);
  });

  it('throws when DATABASE_URL is missing', () => {
    expect(() => validateEnv({})).toThrow(/DATABASE_URL/);
  });

  it('throws when DATABASE_URL is not a valid url', () => {
    expect(() => validateEnv({ DATABASE_URL: 'not-a-url' })).toThrow(
      /DATABASE_URL/,
    );
  });
});
