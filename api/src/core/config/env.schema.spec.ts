import { validateEnv } from './env.schema';

// A fully-populated, valid raw env. Mirrors the required keys an operator must
// supply for the WhatsApp buy vertical (secrets/infra, CLAUDE.md §7).
const validRaw = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/handshake_agent',
  WHATSAPP_PHONE_NUMBER_ID: '1248377751698132',
  WHATSAPP_ACCESS_TOKEN: 'EAAW-test-token',
  BLOCKRADAR_API_KEY: 'test_blockradar_key',
  BLOCKRADAR_MASTER_WALLET_ID: '1d7d770a-508c-42d3-a1bc-2e99ef6ce530',
  FLUTTERWAVE_SECRET_KEY: 'FLWSECK_TEST-abc-X',
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
    expect(() =>
      validateEnv({ ...validRaw, DATABASE_URL: 'not-a-url' }),
    ).toThrow(/DATABASE_URL/);
  });

  it('exposes the WhatsApp / Blockradar / Flutterwave staging vars', () => {
    const env = validateEnv(validRaw);

    expect(env.WHATSAPP_PHONE_NUMBER_ID).toBe('1248377751698132');
    expect(env.BLOCKRADAR_BASE_URL).toBe('https://api.blockradar.co/v1');
    expect(env.FLUTTERWAVE_SECRET_KEY).toBe('FLWSECK_TEST-abc-X');
  });

  it('defaults WHATSAPP_GRAPH_VERSION to v25.0', () => {
    const env = validateEnv(validRaw);

    expect(env.WHATSAPP_GRAPH_VERSION).toBe('v25.0');
  });

  it('defaults WHATSAPP_GRAPH_BASE_URL to https://graph.facebook.com', () => {
    const env = validateEnv(validRaw);

    expect(env.WHATSAPP_GRAPH_BASE_URL).toBe('https://graph.facebook.com');
  });

  it('throws when WHATSAPP_GRAPH_BASE_URL is not a valid URL', () => {
    expect(() =>
      validateEnv({ ...validRaw, WHATSAPP_GRAPH_BASE_URL: 'not-a-url' }),
    ).toThrow(/WHATSAPP_GRAPH_BASE_URL/);
  });

  it('allows operator-supplied-later secrets to be empty (dev)', () => {
    const env = validateEnv(validRaw);

    // These are added by the operator before going live; empty is valid at boot.
    expect(env.WHATSAPP_APP_SECRET).toBe('');
    expect(env.WHATSAPP_VERIFY_TOKEN).toBe('');
    expect(env.DIRECTIVE_SIGNING_KEY).toBe('');
  });

  it('defaults WHATSAPP_FLOW_ID to empty string (flow not yet published)', () => {
    const env = validateEnv(validRaw);

    // WHATSAPP_FLOW_ID is set by the operator after publishing the confirmation+PIN
    // Flow in the Meta dashboard; empty = not yet published, fall back to text.
    expect(env.WHATSAPP_FLOW_ID).toBe('');
  });

  it('accepts a non-empty WHATSAPP_FLOW_ID once the Flow is published', () => {
    const env = validateEnv({ ...validRaw, WHATSAPP_FLOW_ID: 'flow-id-123' });

    expect(env.WHATSAPP_FLOW_ID).toBe('flow-id-123');
  });

  it('throws when a required integration secret is missing', () => {
    const withoutBlockradar: Record<string, unknown> = { ...validRaw };
    delete withoutBlockradar.BLOCKRADAR_API_KEY;

    expect(() => validateEnv(withoutBlockradar)).toThrow(/BLOCKRADAR_API_KEY/);
  });

  it('throws when BLOCKRADAR_BASE_URL is not a valid url', () => {
    expect(() =>
      validateEnv({ ...validRaw, BLOCKRADAR_BASE_URL: 'not-a-url' }),
    ).toThrow(/BLOCKRADAR_BASE_URL/);
  });

  it('treats an empty ANTHROPIC_API_KEY as not provided (boot does not fail)', () => {
    // A blank placeholder in .env must not fail boot; tests fake the LlmProvider.
    const env = validateEnv({ ...validRaw, ANTHROPIC_API_KEY: '' });

    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it('accepts a present non-empty ANTHROPIC_API_KEY', () => {
    const env = validateEnv({ ...validRaw, ANTHROPIC_API_KEY: 'sk-ant-123' });

    expect(env.ANTHROPIC_API_KEY).toBe('sk-ant-123');
  });

  // --- KYC (task K1) ---

  it('defaults KYC_MOCK_MODE to "true" when omitted', () => {
    const env = validateEnv(validRaw);

    expect(env.KYC_MOCK_MODE).toBe('true');
  });

  it('accepts KYC_MOCK_MODE=false', () => {
    const env = validateEnv({ ...validRaw, KYC_MOCK_MODE: 'false' });

    expect(env.KYC_MOCK_MODE).toBe('false');
  });

  it('throws when KYC_MOCK_MODE is not "true" or "false"', () => {
    expect(() => validateEnv({ ...validRaw, KYC_MOCK_MODE: 'yes' })).toThrow(
      /KYC_MOCK_MODE/,
    );
  });

  // --- Payments / Wallet provider mock toggles ---

  it('defaults PAYMENTS_MOCK_MODE to "true" when omitted (safe default)', () => {
    const env = validateEnv(validRaw);

    expect(env.PAYMENTS_MOCK_MODE).toBe('true');
  });

  it('accepts PAYMENTS_MOCK_MODE=false (activates the real Flutterwave adapter)', () => {
    const env = validateEnv({ ...validRaw, PAYMENTS_MOCK_MODE: 'false' });

    expect(env.PAYMENTS_MOCK_MODE).toBe('false');
  });

  it('throws when PAYMENTS_MOCK_MODE is not "true" or "false"', () => {
    expect(() =>
      validateEnv({ ...validRaw, PAYMENTS_MOCK_MODE: 'yes' }),
    ).toThrow(/PAYMENTS_MOCK_MODE/);
  });

  it('defaults WALLET_MOCK_MODE to "true" when omitted (safe default)', () => {
    const env = validateEnv(validRaw);

    expect(env.WALLET_MOCK_MODE).toBe('true');
  });

  it('accepts WALLET_MOCK_MODE=false (activates the real Blockradar adapter)', () => {
    const env = validateEnv({ ...validRaw, WALLET_MOCK_MODE: 'false' });

    expect(env.WALLET_MOCK_MODE).toBe('false');
  });

  it('throws when WALLET_MOCK_MODE is not "true" or "false"', () => {
    expect(() =>
      validateEnv({ ...validRaw, WALLET_MOCK_MODE: 'maybe' }),
    ).toThrow(/WALLET_MOCK_MODE/);
  });
});

// --- Auth env keys (Task 2: web-auth config groundwork) ---

describe('env.schema auth keys', () => {
  it('defaults JWT_SECRET to empty string and AUTH_DEV_EXPOSE_OTP to false', () => {
    const env = validateEnv({ ...validRaw });
    expect(env.JWT_SECRET).toBe('');
    expect(env.AUTH_DEV_EXPOSE_OTP).toBe('false');
  });

  it('accepts a provided JWT_SECRET and dev-expose flag', () => {
    const env = validateEnv({
      ...validRaw,
      JWT_SECRET: 's3cret',
      AUTH_DEV_EXPOSE_OTP: 'true',
    });
    expect(env.JWT_SECRET).toBe('s3cret');
    expect(env.AUTH_DEV_EXPOSE_OTP).toBe('true');
  });

  it('rejects an invalid AUTH_DEV_EXPOSE_OTP value', () => {
    expect(() =>
      validateEnv({ ...validRaw, AUTH_DEV_EXPOSE_OTP: 'maybe' }),
    ).toThrow();
  });
});
