import { z } from 'zod';

/**
 * The environment contract. Secrets and infra live here (layered config: env
 * sits between JSON defaults and the DB-admin layer — see root CLAUDE.md §7).
 * Invalid env fails the app at boot rather than at first use.
 */
export const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().url(),

  // LLM (LangGraph agent). Optional: tests fake the LlmProvider; a live key is
  // only needed to exercise the real agent. Empty in .env means "not provided" —
  // coerce '' → undefined so a blank placeholder passes boot, while a present
  // value must be non-empty. Without this, `ANTHROPIC_API_KEY=` fails `.min(1)`.
  ANTHROPIC_API_KEY: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().min(1).optional(),
  ),
  AGENT_MODEL: z.string().min(1).default('claude-opus-4-8'),

  // --- WhatsApp (Meta Cloud API + Flows, ADR-0003) ---
  // Required to send/receive at all.
  WHATSAPP_PHONE_NUMBER_ID: z.string().min(1),
  WHATSAPP_ACCESS_TOKEN: z.string().min(1),
  WHATSAPP_GRAPH_VERSION: z.string().min(1).default('v25.0'),
  // Base URL kept in env for testability (mirrors BLOCKRADAR_BASE_URL / FLUTTERWAVE_BASE_URL).
  WHATSAPP_GRAPH_BASE_URL: z
    .string()
    .url()
    .default('https://graph.facebook.com'),
  // Non-secret ids / convenience — optional.
  WHATSAPP_WABA_ID: z.string().optional().default(''),
  WHATSAPP_APP_ID: z.string().optional().default(''),
  WHATSAPP_TEST_RECIPIENT: z.string().optional().default(''),
  // Meta Flow ID — set by operator after publishing the confirmation+PIN Flow
  // in the WhatsApp Business dashboard. Empty string = Flow not yet published;
  // ConversationService falls back to plain-text confirmation in that case.
  WHATSAPP_FLOW_ID: z.string().optional().default(''),
  // Meta Flow ID for the beneficiary add/select flow (S3). Empty = flow not
  // yet published; controller falls back to directing user to the web/app.
  WHATSAPP_BENEFICIARY_FLOW_ID: z.string().optional().default(''),
  // Operator-supplied-later secrets (empty is valid at boot; enforced where used):
  //  - APP_SECRET: HMAC key for X-Hub-Signature-256 webhook verification.
  //  - VERIFY_TOKEN: GET webhook handshake token.
  //  - FLOW_PRIVATE_KEY: PEM RSA key to decrypt Flow payloads (KYC/confirm/PIN).
  WHATSAPP_APP_SECRET: z.string().optional().default(''),
  WHATSAPP_VERIFY_TOKEN: z.string().optional().default(''),
  WHATSAPP_FLOW_PRIVATE_KEY: z.string().optional().default(''),

  // --- Blockradar (WaaS; USDT-on-TRON). Auth is x-api-key; key is wallet-scoped. ---
  BLOCKRADAR_API_KEY: z.string().min(1),
  BLOCKRADAR_MASTER_WALLET_ID: z.string().min(1),
  BLOCKRADAR_BASE_URL: z.string().url().default('https://api.blockradar.co/v1'),

  // --- Flutterwave (NGN collection for buy) ---
  FLUTTERWAVE_SECRET_KEY: z.string().min(1),
  FLUTTERWAVE_BASE_URL: z
    .string()
    .url()
    .default('https://api.flutterwave.com/v3'),
  // Dashboard "secret hash" — verifies collection/transfer webhooks (verif-hash equality, v3).
  FLUTTERWAVE_WEBHOOK_SECRET: z.string().optional().default(''),

  // --- Engine ---
  // HMAC-SHA256 key for DirectiveGrant signing (ADR-0005/0006). Required before the
  // engine can execute; empty is tolerated until the engine phase is wired.
  DIRECTIVE_SIGNING_KEY: z.string().optional().default(''),
  // HMAC-SHA256 key for Receipt signing. Separate from DIRECTIVE_SIGNING_KEY so
  // each key can be rotated independently. Empty is tolerated at boot but the
  // settlement kernel throws ReceiptNotSignableError before inserting a receipt
  // (fail-closed — no unsigned receipt is ever written).
  RECEIPT_SIGNING_KEY: z.string().optional().default(''),
  // HMAC-SHA256 key for signing statement download links. Empty is tolerated at
  // boot but StatementTokenService.sign() throws StatementNotSignableError and the
  // public download endpoint returns 503 (fail-closed — no unsigned link is issued).
  STATEMENT_SIGNING_KEY: z.string().optional().default(''),

  // --- KYC (task K1) ---
  // When 'true', the MockKycProvider is active (the only adapter at launch).
  // Flip to 'false' once a real NIN/BVN provider is wired in IdentityModule.
  KYC_MOCK_MODE: z.enum(['true', 'false']).default('true'),

  // --- Sanctions / AML (compliance) ---
  // When 'true' (default), MockSanctionsScreener is active — no live Blockradar
  // AML calls. Set to 'false' to activate BlockradarAmlScreener (requires AML
  // enabled on the Blockradar plan and a valid BLOCKRADAR_API_KEY).
  SANCTIONS_MOCK_MODE: z.enum(['true', 'false']).default('true'),

  // --- Payment provider (Flutterwave NGN pay-in / pay-out) ---
  // When 'true' (default), MockPaymentProvider is active — deterministic fake
  // virtual accounts / payouts, NO live Flutterwave calls (safe for local dev,
  // tests, and CI without real keys). Set to 'false' to activate the real
  // FlutterwaveProvider (requires a valid FLUTTERWAVE_SECRET_KEY). Mirrors the
  // KYC_MOCK_MODE / SANCTIONS_MOCK_MODE pattern (TreasuryModule selects the
  // adapter via factory).
  PAYMENTS_MOCK_MODE: z.enum(['true', 'false']).default('true'),

  // --- Bank name-enquiry (BeneficiariesModule) ---
  // When 'true' (default), MockNameEnquiry is active — deterministic fake
  // resolved names, NO live Flutterwave calls (safe for local dev / tests and
  // CI without real keys). Set to 'false' to activate FlutterwaveNameEnquiry
  // (POST /accounts/resolve; requires a valid FLUTTERWAVE_SECRET_KEY).
  // Mirrors PAYMENTS_MOCK_MODE / SANCTIONS_MOCK_MODE. BeneficiariesModule
  // selects the adapter via factory (selectNameEnquiryProvider).
  NAME_ENQUIRY_MOCK_MODE: z.enum(['true', 'false']).default('true'),

  // --- Wallet provider (Blockradar WaaS; USDT-on-TRON) ---
  // When 'true' (default), MockWalletProvider is active — deterministic fake
  // addresses / balances / withdrawals, NO live Blockradar calls. Set to 'false'
  // to activate the real BlockradarProvider (requires a valid BLOCKRADAR_API_KEY
  // + master wallet id). WalletsModule selects the adapter via factory.
  WALLET_MOCK_MODE: z.enum(['true', 'false']).default('true'),

  // --- Web App (K3 KYC web handoff) ---
  // Base URL for the web application. Used to build the KYC CTA URL:
  //   `${WEB_APP_BASE_URL}/kyc?t=<token>`
  // Optional: when unset, ConversationService falls back to a plain-text message.
  // Coerce '' → undefined so an empty placeholder passes boot-time validation
  // (same pattern as ANTHROPIC_API_KEY above).
  WEB_APP_BASE_URL: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().url().optional(),
  ),
  // Public base URL of THIS api (used to build absolute statement download links
  // for both web and WhatsApp). Coerce '' → undefined; when unset the token
  // service falls back to `http://localhost:${PORT}` (dev only).
  PUBLIC_API_BASE_URL: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().url().optional(),
  ),

  // --- Job queue (BQ-1: BullMQ / Redis) ---
  // URL for the Redis instance backing BullMQ. Uses lazyConnect so the app
  // boots even when Redis is absent (see JobsModule comments). In staging/prod,
  // point this at the real Redis; in local dev the default works with a local Redis.
  REDIS_URL: z.string().default('redis://localhost:6379'),

  // --- Admin API (WN-5 / CLAUDE.md §4 admin module) ---
  // Bearer token for POST /admin/wallets/backfill-networks (and future admin
  // endpoints). Fail-closed: when unset (empty string / missing), AdminTokenGuard
  // denies every request with 403 — the endpoint ships disabled and unexploitable
  // by default. Set to a long random secret to enable.
  //
  // Swap seam: when the admin UI + proper admin-session auth is built, replace
  // AdminTokenGuard with a session/role guard — this env var can then be removed.
  // (Retained only for the Bull Board dashboard until that too is migrated.)
  ADMIN_API_TOKEN: z.string().optional().default(''),

  // --- Admin platform (RBAC console) — separate principal from end users ---
  // SECRETS, all fail-closed (empty disables the corresponding capability):
  //   ADMIN_JWT_SECRET   — signs admin session JWTs. Distinct from JWT_SECRET so an
  //                        admin token can never be confused with a user token.
  //   ADMIN_MFA_ENC_KEY  — 64 hex chars (32 bytes) for AES-256-GCM encryption of
  //                        AdminUser.mfaSecret at rest. Validated at use-site.
  //   ADMIN_BOOTSTRAP_TOKEN — one-time bootstrap of the first super_admin invitation
  //                        (only honoured when zero AdminUsers exist).
  ADMIN_JWT_SECRET: z.string().optional().default(''),
  ADMIN_MFA_ENC_KEY: z.string().optional().default(''),
  ADMIN_BOOTSTRAP_TOKEN: z.string().optional().default(''),
  // TTLs (seconds). Absolute admin session lifetime and step-up freshness window.
  ADMIN_SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(28800),
  ADMIN_STEP_UP_TTL_SECONDS: z.coerce.number().int().positive().default(300),

  // --- Swap provider (Blockradar crypto-to-crypto swaps) ---
  // When 'true' (default), MockSwapProvider is active — deterministic fake quotes /
  // execute responses, NO live Blockradar calls (safe for local dev, tests, and CI
  // without real credentials). Set to 'false' to activate BlockradarSwapProvider
  // (requires a valid BLOCKRADAR_API_KEY and at least 2 enabled assets in the
  // catalog). Mirrors WALLET_MOCK_MODE / PAYMENTS_MOCK_MODE.
  SWAP_MOCK_MODE: z.enum(['true', 'false']).default('true'),

  // --- Media (speech-to-text + document extraction) ---
  // Mock adapters are the only active ones until real keys are provided (mirror KYC_MOCK_MODE).
  TRANSCRIPTION_MOCK_MODE: z.enum(['true', 'false']).default('true'),
  TRANSCRIPTION_API_KEY: z.string().optional().default(''),
  TRANSCRIPTION_BASE_URL: z.string().url().default('https://api.openai.com/v1'),
  TRANSCRIPTION_MODEL: z.string().min(1).default('whisper-1'),
  MEDIA_EXTRACTION_MOCK_MODE: z.enum(['true', 'false']).default('true'),
  // Vision extraction reuses ANTHROPIC_API_KEY; only the model id is separate.
  MEDIA_EXTRACTION_MODEL: z.string().min(1).default('claude-opus-4-8'),

  // --- Auth (web sessions) ---
  // JWT_SECRET is a SECRET — empty disables token issuance (fail-closed in
  // TokenService), mirroring ADMIN_API_TOKEN. TTLs live in the config JSON layer
  // (configuration.ts auth.*), not here.
  JWT_SECRET: z.string().optional().default(''),
  AUTH_DEV_EXPOSE_OTP: z.enum(['true', 'false']).default('false'),

  // --- Email delivery (Resend) ---
  // Empty/absent → MockEmailProvider (log-only). Non-empty → ResendEmailProvider
  // (real delivery). Coerce '' → undefined so an empty placeholder passes boot-time
  // validation (same pattern as ANTHROPIC_API_KEY).
  RESEND_API_KEY: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().min(1).optional(),
  ),
  // Sender address in "Name <addr>" or plain "addr" form. Falls back to a safe
  // default when unset; provide a verified domain in production.
  EMAIL_FROM: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().min(1).optional(),
  ),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration: ${details}`);
  }
  return parsed.data;
}
