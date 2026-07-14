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

// A fully-populated set of Sumsub credentials/level names — what an operator
// supplies once KYC_MOCK_MODE=false (Task 3.2). Reused by the boot-guard tests
// below whenever a "real KYC" env needs to satisfy the KYC_MOCK_MODE=false
// superRefine requirement without that being the thing under test.
const validSumsub = {
  SUMSUB_API_TOKEN: 'sbx:test-token',
  SUMSUB_API_SECRET_KEY: 'test-secret',
  SUMSUB_WEBHOOK_SECRET: 'test-webhook-secret',
  SUMSUB_LEVEL_TIER2: 'basic-kyc-level',
  SUMSUB_LEVEL_TIER3: 'enhanced-kyc-level',
};

// KYC_MOCK_MODE=false plus everything it requires (KYC_ENCRYPTION_KEY + the
// five Sumsub fields) — spread this into any "accepts ... in production" test
// so the new KYC_MOCK_MODE prod guard doesn't fail tests unrelated to KYC.
const realKyc = {
  KYC_MOCK_MODE: 'false',
  KYC_ENCRYPTION_KEY: 'a'.repeat(64),
  ...validSumsub,
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

  it('defaults RESEND_BASE_URL to https://api.resend.com', () => {
    expect(validateEnv(validRaw).RESEND_BASE_URL).toBe(
      'https://api.resend.com',
    );
  });

  it('defaults ANTHROPIC_BASE_URL to https://api.anthropic.com', () => {
    expect(validateEnv(validRaw).ANTHROPIC_BASE_URL).toBe(
      'https://api.anthropic.com',
    );
  });

  it('throws when ANTHROPIC_BASE_URL is not a valid URL', () => {
    expect(() =>
      validateEnv({ ...validRaw, ANTHROPIC_BASE_URL: 'nope' }),
    ).toThrow(/ANTHROPIC_BASE_URL/);
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
    // Real KYC mode requires an encryption key + Sumsub credentials (boot guard) — supply them.
    const env = validateEnv({
      ...validRaw,
      ...realKyc,
    });

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
    // Real wallet mode requires a receipt-signing key (boot guard) — supply it.
    const env = validateEnv({
      ...validRaw,
      WALLET_MOCK_MODE: 'false',
      RECEIPT_SIGNING_KEY: 'receipt-key',
    });

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

// --- Fail-fast boot guards (cross-field superRefine, CLAUDE.md §7) ---

describe('env.schema boot guards', () => {
  // 1. AUTH_DEV_EXPOSE_OTP must never echo OTP/verification tokens in prod.
  it('rejects AUTH_DEV_EXPOSE_OTP=true when NODE_ENV=production', () => {
    expect(() =>
      validateEnv({
        ...validRaw,
        NODE_ENV: 'production',
        AUTH_DEV_EXPOSE_OTP: 'true',
      }),
    ).toThrow(/AUTH_DEV_EXPOSE_OTP/);
  });

  it('accepts AUTH_DEV_EXPOSE_OTP=true outside production', () => {
    const env = validateEnv({
      ...validRaw,
      NODE_ENV: 'development',
      AUTH_DEV_EXPOSE_OTP: 'true',
    });
    expect(env.AUTH_DEV_EXPOSE_OTP).toBe('true');
  });

  it('accepts AUTH_DEV_EXPOSE_OTP=false in production', () => {
    const env = validateEnv({
      ...validRaw,
      NODE_ENV: 'production',
      AUTH_DEV_EXPOSE_OTP: 'false',
      // satisfy the other prod-only guards so this test isolates the OTP one
      STATEMENT_SIGNING_KEY: 'stmt-key',
      DIRECTIVE_SIGNING_KEY: 'directive-key',
      RESEND_API_KEY: 're_test_key',
      SANCTIONS_MOCK_MODE: 'false',
      ...realKyc,
    });
    expect(env.AUTH_DEV_EXPOSE_OTP).toBe('false');
  });

  // 2. RECEIPT_SIGNING_KEY must be present when real deposits settle.
  it('rejects an empty RECEIPT_SIGNING_KEY when WALLET_MOCK_MODE=false', () => {
    expect(() =>
      validateEnv({
        ...validRaw,
        WALLET_MOCK_MODE: 'false',
        RECEIPT_SIGNING_KEY: '',
      }),
    ).toThrow(/RECEIPT_SIGNING_KEY/);
  });

  it('rejects a missing RECEIPT_SIGNING_KEY when WALLET_MOCK_MODE=false', () => {
    expect(() =>
      validateEnv({ ...validRaw, WALLET_MOCK_MODE: 'false' }),
    ).toThrow(/RECEIPT_SIGNING_KEY/);
  });

  it('accepts a present RECEIPT_SIGNING_KEY when WALLET_MOCK_MODE=false', () => {
    const env = validateEnv({
      ...validRaw,
      WALLET_MOCK_MODE: 'false',
      RECEIPT_SIGNING_KEY: 'receipt-key',
    });
    expect(env.RECEIPT_SIGNING_KEY).toBe('receipt-key');
  });

  it('tolerates an empty RECEIPT_SIGNING_KEY while WALLET_MOCK_MODE=true', () => {
    const env = validateEnv({ ...validRaw, WALLET_MOCK_MODE: 'true' });
    expect(env.RECEIPT_SIGNING_KEY).toBe('');
  });

  // 3. STATEMENT_SIGNING_KEY must be present in production (else statements 503).
  it('rejects an empty STATEMENT_SIGNING_KEY when NODE_ENV=production', () => {
    expect(() =>
      validateEnv({
        ...validRaw,
        NODE_ENV: 'production',
        AUTH_DEV_EXPOSE_OTP: 'false',
        STATEMENT_SIGNING_KEY: '',
      }),
    ).toThrow(/STATEMENT_SIGNING_KEY/);
  });

  it('accepts a present STATEMENT_SIGNING_KEY in production', () => {
    const env = validateEnv({
      ...validRaw,
      NODE_ENV: 'production',
      AUTH_DEV_EXPOSE_OTP: 'false',
      STATEMENT_SIGNING_KEY: 'stmt-key',
      // satisfy the other prod-only guards so this test isolates the statement one
      DIRECTIVE_SIGNING_KEY: 'directive-key',
      RESEND_API_KEY: 're_test_key',
      SANCTIONS_MOCK_MODE: 'false',
      ...realKyc,
    });
    expect(env.STATEMENT_SIGNING_KEY).toBe('stmt-key');
  });

  it('tolerates an empty STATEMENT_SIGNING_KEY outside production', () => {
    const env = validateEnv({ ...validRaw, NODE_ENV: 'development' });
    expect(env.STATEMENT_SIGNING_KEY).toBe('');
  });

  // 4. DIRECTIVE_SIGNING_KEY must be present in production — it is the sole
  //    authenticator of the stateless WhatsApp flow_token; an empty key makes
  //    the HMAC attacker-computable (forgeable victim userId).
  it('rejects an empty DIRECTIVE_SIGNING_KEY when NODE_ENV=production', () => {
    expect(() =>
      validateEnv({
        ...validRaw,
        NODE_ENV: 'production',
        AUTH_DEV_EXPOSE_OTP: 'false',
        STATEMENT_SIGNING_KEY: 'stmt-key',
        DIRECTIVE_SIGNING_KEY: '',
      }),
    ).toThrow(/DIRECTIVE_SIGNING_KEY/);
  });

  it('rejects a missing DIRECTIVE_SIGNING_KEY when NODE_ENV=production', () => {
    expect(() =>
      validateEnv({
        ...validRaw,
        NODE_ENV: 'production',
        AUTH_DEV_EXPOSE_OTP: 'false',
        STATEMENT_SIGNING_KEY: 'stmt-key',
      }),
    ).toThrow(/DIRECTIVE_SIGNING_KEY/);
  });

  it('accepts a present DIRECTIVE_SIGNING_KEY in production', () => {
    const env = validateEnv({
      ...validRaw,
      NODE_ENV: 'production',
      AUTH_DEV_EXPOSE_OTP: 'false',
      STATEMENT_SIGNING_KEY: 'stmt-key',
      DIRECTIVE_SIGNING_KEY: 'directive-key',
      RESEND_API_KEY: 're_test_key',
      SANCTIONS_MOCK_MODE: 'false',
      ...realKyc,
    });
    expect(env.DIRECTIVE_SIGNING_KEY).toBe('directive-key');
  });

  it('tolerates an empty DIRECTIVE_SIGNING_KEY outside production', () => {
    const env = validateEnv({ ...validRaw, NODE_ENV: 'development' });
    expect(env.DIRECTIVE_SIGNING_KEY).toBe('');
  });

  // 6. RESEND_API_KEY must be present in production — without it the
  //    MockEmailProvider is selected, which LOGS login OTPs instead of
  //    delivering them (an account-takeover oracle for anyone with log access).
  it('rejects a missing RESEND_API_KEY when NODE_ENV=production', () => {
    expect(() =>
      validateEnv({
        ...validRaw,
        NODE_ENV: 'production',
        STATEMENT_SIGNING_KEY: 'stmt-key',
        DIRECTIVE_SIGNING_KEY: 'directive-key',
      }),
    ).toThrow(/RESEND_API_KEY/);
  });

  it('rejects an empty RESEND_API_KEY when NODE_ENV=production', () => {
    expect(() =>
      validateEnv({
        ...validRaw,
        NODE_ENV: 'production',
        STATEMENT_SIGNING_KEY: 'stmt-key',
        DIRECTIVE_SIGNING_KEY: 'directive-key',
        RESEND_API_KEY: '',
      }),
    ).toThrow(/RESEND_API_KEY/);
  });

  it('accepts a present RESEND_API_KEY in production', () => {
    const env = validateEnv({
      ...validRaw,
      NODE_ENV: 'production',
      STATEMENT_SIGNING_KEY: 'stmt-key',
      DIRECTIVE_SIGNING_KEY: 'directive-key',
      RESEND_API_KEY: 're_test_key',
      SANCTIONS_MOCK_MODE: 'false',
      ...realKyc,
    });
    expect(env.RESEND_API_KEY).toBe('re_test_key');
  });

  it('tolerates a missing RESEND_API_KEY outside production (mock email ok in dev)', () => {
    const env = validateEnv({ ...validRaw, NODE_ENV: 'development' });
    expect(env.RESEND_API_KEY).toBeUndefined();
  });

  // 7. FLUTTERWAVE_SCENARIO_KEY is a SANDBOX-ONLY simulation header (X-Scenario-Key).
  //    Leaking it into production would silently simulate pay-ins instead of
  //    collecting real money — it must be empty when NODE_ENV=production.
  it('rejects a non-empty FLUTTERWAVE_SCENARIO_KEY when NODE_ENV=production', () => {
    expect(() =>
      validateEnv({
        ...validRaw,
        NODE_ENV: 'production',
        STATEMENT_SIGNING_KEY: 'stmt-key',
        DIRECTIVE_SIGNING_KEY: 'directive-key',
        RESEND_API_KEY: 're_test_key',
        FLUTTERWAVE_SCENARIO_KEY: 'scenario:successful',
      }),
    ).toThrow(/FLUTTERWAVE_SCENARIO_KEY/);
  });

  it('accepts an empty FLUTTERWAVE_SCENARIO_KEY in production', () => {
    const env = validateEnv({
      ...validRaw,
      NODE_ENV: 'production',
      STATEMENT_SIGNING_KEY: 'stmt-key',
      DIRECTIVE_SIGNING_KEY: 'directive-key',
      RESEND_API_KEY: 're_test_key',
      FLUTTERWAVE_SCENARIO_KEY: '',
      SANCTIONS_MOCK_MODE: 'false',
      ...realKyc,
    });
    expect(env.FLUTTERWAVE_SCENARIO_KEY).toBe('');
  });

  it('accepts a non-empty FLUTTERWAVE_SCENARIO_KEY outside production (sandbox)', () => {
    const env = validateEnv({
      ...validRaw,
      NODE_ENV: 'development',
      FLUTTERWAVE_SCENARIO_KEY: 'scenario:successful',
    });
    expect(env.FLUTTERWAVE_SCENARIO_KEY).toBe('scenario:successful');
  });

  // 8. SANCTIONS_MOCK_MODE must be 'false' in production — the mock screener
  //    screens NOTHING (every counterparty passes AML/sanctions). Real AML via
  //    Blockradar is mandatory in prod (F4). Screen-nothing must be impossible.
  it('rejects SANCTIONS_MOCK_MODE=true when NODE_ENV=production', () => {
    expect(() =>
      validateEnv({
        ...validRaw,
        NODE_ENV: 'production',
        STATEMENT_SIGNING_KEY: 'stmt-key',
        DIRECTIVE_SIGNING_KEY: 'directive-key',
        RESEND_API_KEY: 're_test_key',
        SANCTIONS_MOCK_MODE: 'true',
      }),
    ).toThrow(/SANCTIONS_MOCK_MODE/);
  });

  it('rejects a defaulted (omitted) SANCTIONS_MOCK_MODE when NODE_ENV=production', () => {
    // The default is 'true' — omitting it in prod must still fail closed.
    expect(() =>
      validateEnv({
        ...validRaw,
        NODE_ENV: 'production',
        STATEMENT_SIGNING_KEY: 'stmt-key',
        DIRECTIVE_SIGNING_KEY: 'directive-key',
        RESEND_API_KEY: 're_test_key',
      }),
    ).toThrow(/SANCTIONS_MOCK_MODE/);
  });

  it('accepts SANCTIONS_MOCK_MODE=false in production', () => {
    const env = validateEnv({
      ...validRaw,
      NODE_ENV: 'production',
      STATEMENT_SIGNING_KEY: 'stmt-key',
      DIRECTIVE_SIGNING_KEY: 'directive-key',
      RESEND_API_KEY: 're_test_key',
      SANCTIONS_MOCK_MODE: 'false',
      ...realKyc,
    });
    expect(env.SANCTIONS_MOCK_MODE).toBe('false');
  });

  it('tolerates SANCTIONS_MOCK_MODE=true outside production (dev/test)', () => {
    const env = validateEnv({ ...validRaw, NODE_ENV: 'development' });
    expect(env.SANCTIONS_MOCK_MODE).toBe('true');
  });

  // 9. AUTH_COOKIE_SECURE must not be 'false' in production — the auth cookies
  //    (ha_refresh / ha_admin_session) would ship over cleartext HTTP (R1).
  const validProd = {
    ...validRaw,
    NODE_ENV: 'production',
    STATEMENT_SIGNING_KEY: 'stmt-key',
    DIRECTIVE_SIGNING_KEY: 'directive-key',
    RESEND_API_KEY: 're_test_key',
    SANCTIONS_MOCK_MODE: 'false',
    ...realKyc,
  };

  it('rejects AUTH_COOKIE_SECURE=false when NODE_ENV=production', () => {
    expect(() =>
      validateEnv({ ...validProd, AUTH_COOKIE_SECURE: 'false' }),
    ).toThrow(/AUTH_COOKIE_SECURE/);
  });

  it('accepts AUTH_COOKIE_SECURE=true in production', () => {
    const env = validateEnv({ ...validProd, AUTH_COOKIE_SECURE: 'true' });
    expect(env.AUTH_COOKIE_SECURE).toBe('true');
  });

  it('accepts an omitted AUTH_COOKIE_SECURE in production (defaults to secure)', () => {
    const env = validateEnv(validProd);
    expect(env.AUTH_COOKIE_SECURE).toBeUndefined();
  });

  it('tolerates AUTH_COOKIE_SECURE=false outside production (dev/test)', () => {
    const env = validateEnv({ ...validRaw, AUTH_COOKIE_SECURE: 'false' });
    expect(env.AUTH_COOKIE_SECURE).toBe('false');
  });
});

// --- Live market-rate feed (F1) env keys ---

describe('env.schema pricing-feed keys', () => {
  it('defaults the source base URLs and treats COINGECKO_API_KEY as optional', () => {
    const env = validateEnv(validRaw);
    expect(env.COINGECKO_API_KEY).toBe('');
    expect(env.COINGECKO_BASE_URL).toBe('https://api.coingecko.com/api/v3');
    expect(env.QUIDAX_BASE_URL).toBe('https://www.quidax.com/api/v1');
    expect(env.EXCHANGERATE_BASE_URL).toBe('https://open.er-api.com/v6');
  });

  it('accepts an operator-supplied COINGECKO_API_KEY', () => {
    const env = validateEnv({ ...validRaw, COINGECKO_API_KEY: 'cg-demo-123' });
    expect(env.COINGECKO_API_KEY).toBe('cg-demo-123');
  });

  it('throws when a feed base URL is not a valid URL', () => {
    expect(() =>
      validateEnv({ ...validRaw, COINGECKO_BASE_URL: 'not-a-url' }),
    ).toThrow(/COINGECKO_BASE_URL/);
  });
});

// --- CORS + auth-cookie keys (Wave H) ---

describe('env.schema CORS + auth-cookie keys', () => {
  it('treats ADMIN_APP_BASE_URL + cookie keys as optional (undefined when omitted)', () => {
    const env = validateEnv(validRaw);
    expect(env.ADMIN_APP_BASE_URL).toBeUndefined();
    expect(env.AUTH_COOKIE_SAMESITE).toBeUndefined();
    expect(env.ADMIN_COOKIE_SAMESITE).toBeUndefined();
    expect(env.AUTH_COOKIE_SECURE).toBeUndefined();
  });

  it('coerces an empty ADMIN_APP_BASE_URL to undefined (dev CORS falls back)', () => {
    const env = validateEnv({ ...validRaw, ADMIN_APP_BASE_URL: '' });
    expect(env.ADMIN_APP_BASE_URL).toBeUndefined();
  });

  it('accepts a valid ADMIN_APP_BASE_URL', () => {
    const env = validateEnv({
      ...validRaw,
      ADMIN_APP_BASE_URL: 'https://admin.handshake.example',
    });
    expect(env.ADMIN_APP_BASE_URL).toBe('https://admin.handshake.example');
  });

  it('throws when ADMIN_APP_BASE_URL is not a valid URL', () => {
    expect(() =>
      validateEnv({ ...validRaw, ADMIN_APP_BASE_URL: 'not-a-url' }),
    ).toThrow(/ADMIN_APP_BASE_URL/);
  });

  it('accepts the three SameSite values and rejects anything else', () => {
    for (const v of ['lax', 'strict', 'none'] as const) {
      expect(
        validateEnv({ ...validRaw, AUTH_COOKIE_SAMESITE: v })
          .AUTH_COOKIE_SAMESITE,
      ).toBe(v);
    }
    expect(() =>
      validateEnv({ ...validRaw, AUTH_COOKIE_SAMESITE: 'weak' }),
    ).toThrow(/AUTH_COOKIE_SAMESITE/);
  });

  it('accepts the three SameSite values for the admin cookie and rejects anything else', () => {
    for (const v of ['lax', 'strict', 'none'] as const) {
      expect(
        validateEnv({ ...validRaw, ADMIN_COOKIE_SAMESITE: v })
          .ADMIN_COOKIE_SAMESITE,
      ).toBe(v);
    }
    expect(() =>
      validateEnv({ ...validRaw, ADMIN_COOKIE_SAMESITE: 'weak' }),
    ).toThrow(/ADMIN_COOKIE_SAMESITE/);
  });

  it('accepts AUTH_COOKIE_SECURE=true|false and rejects other values', () => {
    expect(
      validateEnv({ ...validRaw, AUTH_COOKIE_SECURE: 'true' })
        .AUTH_COOKIE_SECURE,
    ).toBe('true');
    expect(() =>
      validateEnv({ ...validRaw, AUTH_COOKIE_SECURE: 'yes' }),
    ).toThrow(/AUTH_COOKIE_SECURE/);
  });
});

// --- KYC encryption key (NIN/BVN at-rest encryption) ---

describe('env.schema KYC_ENCRYPTION_KEY', () => {
  it('defaults KYC_ENCRYPTION_KEY to an empty string when omitted', () => {
    const env = validateEnv(validRaw);
    expect(env.KYC_ENCRYPTION_KEY).toBe('');
  });

  it('rejects an empty KYC_ENCRYPTION_KEY when KYC_MOCK_MODE=false', () => {
    expect(() =>
      validateEnv({
        ...validRaw,
        KYC_MOCK_MODE: 'false',
        KYC_ENCRYPTION_KEY: '',
      }),
    ).toThrow(/KYC_ENCRYPTION_KEY/);
  });

  it('rejects a missing KYC_ENCRYPTION_KEY when KYC_MOCK_MODE=false', () => {
    expect(() => validateEnv({ ...validRaw, KYC_MOCK_MODE: 'false' })).toThrow(
      /KYC_ENCRYPTION_KEY/,
    );
  });

  it('accepts a present KYC_ENCRYPTION_KEY when KYC_MOCK_MODE=false', () => {
    const env = validateEnv({
      ...validRaw,
      ...realKyc,
    });
    expect(env.KYC_ENCRYPTION_KEY).toBe('a'.repeat(64));
  });

  it('tolerates an empty KYC_ENCRYPTION_KEY while KYC_MOCK_MODE=true', () => {
    const env = validateEnv({ ...validRaw, KYC_MOCK_MODE: 'true' });
    expect(env.KYC_ENCRYPTION_KEY).toBe('');
  });
});

// --- Sumsub (real KYC provider, Task 3.2) ---

describe('env.schema Sumsub keys', () => {
  it('defaults every Sumsub field to empty string and SUMSUB_BASE_URL to the real API host', () => {
    const env = validateEnv(validRaw);
    expect(env.SUMSUB_API_TOKEN).toBe('');
    expect(env.SUMSUB_API_SECRET_KEY).toBe('');
    expect(env.SUMSUB_WEBHOOK_SECRET).toBe('');
    expect(env.SUMSUB_LEVEL_TIER2).toBe('');
    expect(env.SUMSUB_LEVEL_TIER3).toBe('');
    expect(env.SUMSUB_BASE_URL).toBe('https://api.sumsub.com');
  });

  it('accepts operator-supplied Sumsub values', () => {
    const env = validateEnv({
      ...validRaw,
      ...validSumsub,
      SUMSUB_BASE_URL: 'https://api.sumsub.com',
    });
    expect(env.SUMSUB_API_TOKEN).toBe('sbx:test-token');
    expect(env.SUMSUB_API_SECRET_KEY).toBe('test-secret');
    expect(env.SUMSUB_WEBHOOK_SECRET).toBe('test-webhook-secret');
    expect(env.SUMSUB_LEVEL_TIER2).toBe('basic-kyc-level');
    expect(env.SUMSUB_LEVEL_TIER3).toBe('enhanced-kyc-level');
  });

  it('throws when SUMSUB_BASE_URL is not a valid URL', () => {
    expect(() =>
      validateEnv({ ...validRaw, SUMSUB_BASE_URL: 'not-a-url' }),
    ).toThrow(/SUMSUB_BASE_URL/);
  });

  // This mirrors the CURRENT local api/.env reality: SUMSUB_API_TOKEN/SECRET_KEY/
  // WEBHOOK_SECRET are set, but SUMSUB_LEVEL_TIER2/TIER3 are not — and
  // KYC_MOCK_MODE is omitted (defaults to 'true'). Boot must still succeed.
  it('accepts dev env with KYC_MOCK_MODE=true and Sumsub level names absent (current local .env)', () => {
    const env = validateEnv({
      ...validRaw,
      SUMSUB_API_TOKEN: 'sbx:test-token',
      SUMSUB_API_SECRET_KEY: 'test-secret',
      SUMSUB_WEBHOOK_SECRET: 'test-webhook-secret',
      // SUMSUB_LEVEL_TIER2 / SUMSUB_LEVEL_TIER3 intentionally omitted.
    });
    expect(env.KYC_MOCK_MODE).toBe('true');
    expect(env.SUMSUB_LEVEL_TIER2).toBe('');
    expect(env.SUMSUB_LEVEL_TIER3).toBe('');
  });

  // Also accepts the fully-absent case (no Sumsub keys at all) in mock mode.
  it('accepts dev env with KYC_MOCK_MODE=true and ALL Sumsub fields absent', () => {
    const env = validateEnv(validRaw);
    expect(env.KYC_MOCK_MODE).toBe('true');
    expect(env.SUMSUB_API_TOKEN).toBe('');
  });

  it('rejects KYC_MOCK_MODE=false with every Sumsub field absent', () => {
    expect(() => validateEnv({ ...validRaw, KYC_MOCK_MODE: 'false' })).toThrow(
      /SUMSUB_API_TOKEN/,
    );
  });

  it.each([
    'SUMSUB_API_TOKEN',
    'SUMSUB_API_SECRET_KEY',
    'SUMSUB_WEBHOOK_SECRET',
    'SUMSUB_LEVEL_TIER2',
    'SUMSUB_LEVEL_TIER3',
  ])(
    'rejects KYC_MOCK_MODE=false with %s missing (others present)',
    (missingKey) => {
      const raw: Record<string, unknown> = {
        ...validRaw,
        KYC_MOCK_MODE: 'false',
        KYC_ENCRYPTION_KEY: 'a'.repeat(64),
        ...validSumsub,
      };
      delete raw[missingKey];
      expect(() => validateEnv(raw)).toThrow(new RegExp(missingKey));
    },
  );

  it('accepts KYC_MOCK_MODE=false with every Sumsub field present', () => {
    const env = validateEnv({
      ...validRaw,
      KYC_MOCK_MODE: 'false',
      KYC_ENCRYPTION_KEY: 'a'.repeat(64),
      ...validSumsub,
    });
    expect(env.KYC_MOCK_MODE).toBe('false');
    expect(env.SUMSUB_API_TOKEN).toBe('sbx:test-token');
    expect(env.SUMSUB_LEVEL_TIER3).toBe('enhanced-kyc-level');
  });
});

// --- KYC_MOCK_MODE production boot guard (mirrors SANCTIONS_MOCK_MODE) ---

describe('env.schema KYC_MOCK_MODE production guard', () => {
  it('rejects KYC_MOCK_MODE=true when NODE_ENV=production', () => {
    expect(() =>
      validateEnv({
        ...validRaw,
        NODE_ENV: 'production',
        STATEMENT_SIGNING_KEY: 'stmt-key',
        DIRECTIVE_SIGNING_KEY: 'directive-key',
        RESEND_API_KEY: 're_test_key',
        SANCTIONS_MOCK_MODE: 'false',
        KYC_MOCK_MODE: 'true',
      }),
    ).toThrow(/KYC_MOCK_MODE/);
  });

  it('rejects a defaulted (omitted) KYC_MOCK_MODE when NODE_ENV=production', () => {
    // The default is 'true' — omitting it in prod must still fail closed.
    expect(() =>
      validateEnv({
        ...validRaw,
        NODE_ENV: 'production',
        STATEMENT_SIGNING_KEY: 'stmt-key',
        DIRECTIVE_SIGNING_KEY: 'directive-key',
        RESEND_API_KEY: 're_test_key',
        SANCTIONS_MOCK_MODE: 'false',
      }),
    ).toThrow(/KYC_MOCK_MODE/);
  });

  it('accepts KYC_MOCK_MODE=false in production (with Sumsub credentials supplied)', () => {
    const env = validateEnv({
      ...validRaw,
      NODE_ENV: 'production',
      STATEMENT_SIGNING_KEY: 'stmt-key',
      DIRECTIVE_SIGNING_KEY: 'directive-key',
      RESEND_API_KEY: 're_test_key',
      SANCTIONS_MOCK_MODE: 'false',
      KYC_MOCK_MODE: 'false',
      KYC_ENCRYPTION_KEY: 'a'.repeat(64),
      ...validSumsub,
    });
    expect(env.KYC_MOCK_MODE).toBe('false');
  });

  it('tolerates KYC_MOCK_MODE=true outside production (dev/test)', () => {
    const env = validateEnv({ ...validRaw, NODE_ENV: 'development' });
    expect(env.KYC_MOCK_MODE).toBe('true');
  });
});
