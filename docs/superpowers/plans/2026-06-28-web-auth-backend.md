# Web Auth — Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the backend HTTP surface for email-first web authentication — signup (email + WhatsApp phone) → email-verification → email-OTP login → JWT access + refresh session, plus `GET /auth/me` — reusing the existing `User`/`Device`/`Session` schema, `PinService`, and `ConfigService`.

**Architecture:** A new `api/src/modules/auth/` feature module (clean-arch: domain/application/infrastructure/presentation). The agent and engine are untouched. Tokens: a short-lived signed **access JWT** (verified statelessly, plus a server-side active-session check by `accessTokenHash` for revocation) and an opaque **refresh token** (rotated on use). OTP/email-verification codes are stored hashed in a new `AuthChallenge` table with TTL + attempt limits. Email/OTP delivery is a port with a dev mock that logs and (behind a flag) echoes the code.

**Tech Stack:** NestJS 11, Prisma 7 (multi-file schema under `api/prisma/schema/`), `@nestjs/jwt`, `nestjs-zod` DTOs from `@handshake-agent/contracts`, Jest unit + supertest e2e against Testcontainers Postgres, `zod@^3.25.x`.

## Global Constraints

- **No LLM/agent/engine changes** — this is auth only (root CLAUDE.md §3.1/§3.2 untouched).
- **Clean-arch boundaries (enforced by `dependency-cruiser`):** `presentation → application → domain`; `infrastructure` implements `application` ports; **`application` never imports `infrastructure` or the Prisma client**; only `infrastructure` imports `PrismaService`/generated client.
- **Identity is not the phone (§3.4):** the phone captured at signup is a routing key stored as a _pending_ WhatsApp `ChannelIdentity`; the auth anchor is the verified account email + (later) KYC + bound device + PIN.
- **Secrets never in plaintext at rest or in logs:** OTPs, email tokens, access/refresh tokens are stored **only as SHA-256 hashes**; PINs via `PinService` (already scrypt). `JWT_SECRET` is a secret → env. TTLs are tunable → `configuration.ts` JSON layer (root §7).
- **Fail-closed:** if `JWT_SECRET` is empty, auth token operations throw (the app still boots, mirroring the `ADMIN_API_TOKEN` pattern). `AUTH_DEV_EXPOSE_OTP` defaults `false` and must never expose codes in production.
- **Shapes that cross FE/BE come from `@handshake-agent/contracts`** (§8). Money is never a float on the wire (N/A here, but amounts stay strings everywhere).
- **Zod pinned `^3.25.32`**; schemas are plain zod (no `.openapi()`); api DTOs wrap them with `createZodDto`.
- **TDD, Conventional Commits, one coherent change per commit.** Run `pnpm --filter @handshake-agent/api typecheck` after each task; run the **full** `pnpm --filter @handshake-agent/api test` + `test:e2e` + `pnpm depcruise` at the end (a new injectable can break `AppModule` boot without failing its own narrow test).

## Canonical types & signatures (every task aligns to these)

**Contracts (`packages/contracts/src/auth/*`):**

```ts
SignupRequest        = { email: string; phone: string }
SignupResponse       = { status: 'pending_verification'; devToken?: string }
VerifyEmailRequest   = { token: string }
VerifyEmailResponse  = { verified: true }
LoginRequest         = { email: string }
LoginRequestResponse = { status: 'otp_sent'; devOtp?: string }
LoginVerifyRequest   = { email: string; otp: string; deviceFingerprint: string }
MeResponse           = { userId: string; email: string; kycStatus: string; kycTier: string; hasPin: boolean }
LoginVerifyResponse  = { accessToken: string; refreshToken: string; user: MeResponse }
RefreshRequest       = { refreshToken: string }
RefreshResponse      = { accessToken: string; refreshToken: string }
```

**Ports (application layer):**

```ts
// EMAIL_PROVIDER
interface IEmailProvider {
  sendEmailVerification(to: string, token: string): Promise<void>;
  sendLoginOtp(to: string, otp: string): Promise<void>;
}
// AUTH_CHALLENGE_REPOSITORY  (type ∈ 'email_verification' | 'otp_email')
interface IAuthChallengeRepository {
  upsert(input: {
    userId: string;
    type: string;
    challengeHash: string;
    expiresAt: Date;
  }): Promise<void>;
  findActiveByHashAndType(
    challengeHash: string,
    type: string,
    now: Date,
  ): Promise<{ id: string; userId: string } | null>;
  findActiveByUserAndType(
    userId: string,
    type: string,
    now: Date,
  ): Promise<{
    id: string;
    challengeHash: string;
    attemptCount: number;
  } | null>;
  incrementAttempt(id: string): Promise<void>;
  consume(id: string, now: Date): Promise<void>;
}
// AUTH_USER_REPOSITORY
interface AuthUserRecord {
  id: string;
  email: string;
  emailVerifiedAt: Date | null;
  kycStatus: string;
  kycTier: string;
  pinHash: string | null;
}
interface IAuthUserRepository {
  createSignup(input: {
    email: string;
    phone: string;
  }): Promise<{ userId: string; created: boolean }>;
  findByEmail(email: string): Promise<AuthUserRecord | null>;
  markEmailVerified(userId: string, now: Date): Promise<void>;
  bindDevice(input: {
    userId: string;
    fingerprint: string;
    userAgent?: string;
    ip?: string;
  }): Promise<{ deviceId: string }>;
  loadMe(userId: string): Promise<MeProjection | null>; // { userId, email, kycStatus, kycTier, hasPin }
}
// AUTH_SESSION_REPOSITORY
interface IAuthSessionRepository {
  create(input: {
    userId: string;
    deviceId: string;
    accessTokenHash: string;
    refreshTokenHash: string;
    expiresAt: Date;
  }): Promise<{ sessionId: string }>;
  findActiveByAccessHash(
    accessTokenHash: string,
    now: Date,
  ): Promise<{ id: string; userId: string; deviceId: string | null } | null>;
  findActiveByRefreshHash(
    refreshTokenHash: string,
    now: Date,
  ): Promise<{ id: string; userId: string; deviceId: string | null } | null>;
  rotate(
    sessionId: string,
    input: { accessTokenHash: string; refreshTokenHash: string; now: Date },
  ): Promise<void>;
  revoke(sessionId: string, now: Date, reason?: string): Promise<void>;
}
```

**TokenService (application service, no port — pure crypto + jwt):**

```ts
signAccessToken(userId: string): string;                 // JWT { sub: userId }, ttl from config
verifyAccessToken(token: string): { sub: string };       // throws on bad sig/exp
generateOpaqueToken(): string;                            // 32 random bytes → hex
hash(value: string): string;                             // sha256 hex
generateNumericOtp(length: number): string;              // crypto-strong digits
```

**AuthService (application) → consumed by AuthController:**

```ts
signup(input: SignupRequest): Promise<SignupResponse>;
verifyEmail(input: VerifyEmailRequest): Promise<VerifyEmailResponse>;
loginRequest(input: LoginRequest): Promise<LoginRequestResponse>;
loginVerify(input: LoginVerifyRequest & { userAgent?: string; ip?: string }): Promise<LoginVerifyResponse>;
refresh(input: RefreshRequest): Promise<RefreshResponse>;
logout(sessionId: string): Promise<void>;
me(userId: string): Promise<MeResponse>;
```

**Guard output:** `JwtAuthGuard` attaches `req.user = { userId: string; sessionId: string; deviceId: string | null }`; `@CurrentUser()` returns it.

---

### Task 1: Auth contracts schemas

**Files:**

- Create: `packages/contracts/src/auth/auth.dto.ts`
- Create: `packages/contracts/src/auth/index.ts`
- Modify: `packages/contracts/src/index.ts` (add `export * from './auth/index'`)
- Test: `packages/contracts/src/auth/auth.dto.spec.ts`

**Interfaces:**

- Produces: all schemas + inferred types listed in "Canonical types" (`SignupRequestSchema`/`SignupRequest`, … `RefreshResponseSchema`/`RefreshResponse`, `MeResponseSchema`/`MeResponse`).

- [ ] **Step 1: Write the failing test** — `packages/contracts/src/auth/auth.dto.spec.ts`

```ts
import { describe, expect, it } from "vitest";
import {
  SignupRequestSchema,
  VerifyEmailRequestSchema,
  LoginRequestSchema,
  LoginVerifyRequestSchema,
  LoginVerifyResponseSchema,
  MeResponseSchema,
  RefreshRequestSchema,
} from "./index";

describe("auth contracts", () => {
  it("accepts a valid signup body and lowercases nothing (server normalizes)", () => {
    const parsed = SignupRequestSchema.parse({
      email: "a@b.com",
      phone: "+2348012345678",
    });
    expect(parsed.email).toBe("a@b.com");
  });

  it("rejects a non-email signup", () => {
    expect(() =>
      SignupRequestSchema.parse({ email: "nope", phone: "+2348012345678" }),
    ).toThrow();
  });

  it("rejects a signup with a too-short phone", () => {
    expect(() =>
      SignupRequestSchema.parse({ email: "a@b.com", phone: "123" }),
    ).toThrow();
  });

  it("requires a non-empty verify-email token", () => {
    expect(() => VerifyEmailRequestSchema.parse({ token: "" })).toThrow();
    expect(VerifyEmailRequestSchema.parse({ token: "abc" }).token).toBe("abc");
  });

  it("login request requires an email", () => {
    expect(() => LoginRequestSchema.parse({})).toThrow();
  });

  it("login verify requires email, otp, deviceFingerprint", () => {
    expect(() =>
      LoginVerifyRequestSchema.parse({ email: "a@b.com", otp: "123456" }),
    ).toThrow();
    const ok = LoginVerifyRequestSchema.parse({
      email: "a@b.com",
      otp: "123456",
      deviceFingerprint: "fp-1",
    });
    expect(ok.otp).toBe("123456");
  });

  it("login verify response carries tokens and a user projection", () => {
    const v = LoginVerifyResponseSchema.parse({
      accessToken: "a",
      refreshToken: "r",
      user: {
        userId: "11111111-1111-1111-1111-111111111111",
        email: "a@b.com",
        kycStatus: "not_started",
        kycTier: "unverified",
        hasPin: false,
      },
    });
    expect(v.user.hasPin).toBe(false);
  });

  it("me response shape", () => {
    expect(() =>
      MeResponseSchema.parse({ userId: "x", email: "a@b.com" }),
    ).toThrow();
  });

  it("refresh request requires a token", () => {
    expect(() => RefreshRequestSchema.parse({ refreshToken: "" })).toThrow();
  });
});
```

- [ ] **Step 2: Run it to confirm failure**

Run: `pnpm --filter @handshake-agent/contracts test`
Expected: FAIL — cannot resolve `./index` auth exports.

- [ ] **Step 3: Write the schemas** — `packages/contracts/src/auth/auth.dto.ts`

```ts
import { z } from "zod";

// Email-first web auth. The phone is captured for later WhatsApp linking only —
// it is a routing key, never the auth anchor (root CLAUDE.md §3.4).
export const SignupRequestSchema = z.object({
  email: z.string().email().max(254),
  // Loose E.164-ish: leading + optional, 8–15 digits. Server normalizes.
  phone: z.string().regex(/^\+?[0-9]{8,15}$/, "Enter a valid phone number"),
});
export type SignupRequest = z.infer<typeof SignupRequestSchema>;

export const SignupResponseSchema = z.object({
  status: z.literal("pending_verification"),
  // Present ONLY when AUTH_DEV_EXPOSE_OTP=true (non-prod) — used by tests/dev.
  devToken: z.string().optional(),
});
export type SignupResponse = z.infer<typeof SignupResponseSchema>;

export const VerifyEmailRequestSchema = z.object({ token: z.string().min(1) });
export type VerifyEmailRequest = z.infer<typeof VerifyEmailRequestSchema>;

export const VerifyEmailResponseSchema = z.object({
  verified: z.literal(true),
});
export type VerifyEmailResponse = z.infer<typeof VerifyEmailResponseSchema>;

export const LoginRequestSchema = z.object({
  email: z.string().email().max(254),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const LoginRequestResponseSchema = z.object({
  status: z.literal("otp_sent"),
  devOtp: z.string().optional(),
});
export type LoginRequestResponse = z.infer<typeof LoginRequestResponseSchema>;

export const LoginVerifyRequestSchema = z.object({
  email: z.string().email().max(254),
  otp: z.string().min(4).max(10),
  deviceFingerprint: z.string().min(8).max(200),
});
export type LoginVerifyRequest = z.infer<typeof LoginVerifyRequestSchema>;

export const MeResponseSchema = z.object({
  userId: z.string().uuid(),
  email: z.string().email(),
  kycStatus: z.string(),
  kycTier: z.string(),
  hasPin: z.boolean(),
});
export type MeResponse = z.infer<typeof MeResponseSchema>;

export const LoginVerifyResponseSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  user: MeResponseSchema,
});
export type LoginVerifyResponse = z.infer<typeof LoginVerifyResponseSchema>;

export const RefreshRequestSchema = z.object({
  refreshToken: z.string().min(1),
});
export type RefreshRequest = z.infer<typeof RefreshRequestSchema>;

export const RefreshResponseSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
});
export type RefreshResponse = z.infer<typeof RefreshResponseSchema>;
```

- [ ] **Step 4: Write the barrel** — `packages/contracts/src/auth/index.ts`

```ts
export * from "./auth.dto";
```

- [ ] **Step 5: Wire into the root index** — `packages/contracts/src/index.ts`

Add after the existing `export * from './whatsapp/inbound'` line:

```ts
export * from "./auth/index";
```

- [ ] **Step 6: Run tests to verify pass**

Run: `pnpm --filter @handshake-agent/contracts test`
Expected: PASS (all auth contract tests green).

- [ ] **Step 7: Commit**

```bash
git add packages/contracts/src/auth packages/contracts/src/index.ts
git commit -m "feat(contracts): add web auth request/response schemas"
```

---

### Task 2: Dependencies, env, config TTLs, CORS

**Files:**

- Modify: `api/package.json` (add `@nestjs/jwt`)
- Modify: `api/src/core/config/env.schema.ts` (add `JWT_SECRET`, `AUTH_DEV_EXPOSE_OTP`)
- Modify: `api/src/core/config/configuration.ts` (extend `AuthConfig` with `jwt`/`otp`/`emailToken`)
- Modify: `api/.env.example`
- Modify: `api/src/main.ts` (enable CORS for the web origin)
- Test: `api/src/core/config/env.schema.spec.ts` (extend if present; else create)

**Interfaces:**

- Produces: env keys `JWT_SECRET` (string, default `''`), `AUTH_DEV_EXPOSE_OTP` (`'true'|'false'`, default `'false'`); config `auth.jwt.accessTtlSeconds`, `auth.jwt.refreshTtlSeconds`, `auth.otp.ttlSeconds`, `auth.otp.length`, `auth.otp.maxAttempts`, `auth.emailToken.ttlSeconds`.

- [ ] **Step 1: Add the dependency**

Run:

```bash
pnpm --filter @handshake-agent/api add @nestjs/jwt
```

Expected: `@nestjs/jwt` added to `api/package.json` dependencies; lockfile updated.

- [ ] **Step 2: Write a failing config test** — `api/src/core/config/env.schema.spec.ts`

Add these cases (create the file if it doesn't exist, importing `validateEnv` from `./env.schema`):

```ts
import { validateEnv } from "./env.schema";

const base = {
  DATABASE_URL: "postgresql://u:p@localhost:5432/db?schema=public",
};

describe("env.schema auth keys", () => {
  it("defaults JWT_SECRET to empty string and AUTH_DEV_EXPOSE_OTP to false", () => {
    const env = validateEnv({ ...base });
    expect(env.JWT_SECRET).toBe("");
    expect(env.AUTH_DEV_EXPOSE_OTP).toBe("false");
  });

  it("accepts a provided JWT_SECRET and dev-expose flag", () => {
    const env = validateEnv({
      ...base,
      JWT_SECRET: "s3cret",
      AUTH_DEV_EXPOSE_OTP: "true",
    });
    expect(env.JWT_SECRET).toBe("s3cret");
    expect(env.AUTH_DEV_EXPOSE_OTP).toBe("true");
  });

  it("rejects an invalid AUTH_DEV_EXPOSE_OTP value", () => {
    expect(() =>
      validateEnv({ ...base, AUTH_DEV_EXPOSE_OTP: "maybe" }),
    ).toThrow();
  });
});
```

- [ ] **Step 3: Run it to confirm failure**

Run: `pnpm --filter @handshake-agent/api test -- env.schema`
Expected: FAIL — `JWT_SECRET`/`AUTH_DEV_EXPOSE_OTP` undefined.

- [ ] **Step 4: Add the env keys** — in `api/src/core/config/env.schema.ts`, inside the `z.object({...})`, after the `ADMIN_API_TOKEN` line add:

```ts
  // Auth (web sessions). JWT_SECRET is a SECRET — empty disables token issuance
  // (fail-closed in TokenService), mirroring ADMIN_API_TOKEN. TTLs live in the
  // config JSON layer (configuration.ts auth.*), not here.
  JWT_SECRET: z.string().optional().default(''),
  AUTH_DEV_EXPOSE_OTP: z.enum(['true', 'false']).default('false'),
```

- [ ] **Step 5: Extend `AuthConfig`** — in `api/src/core/config/configuration.ts`, replace the `AuthConfig` interface and the `auth:` block of the default export.

Interface (replace the existing `export interface AuthConfig`):

```ts
export interface JwtConfig {
  /** Access-token validity (seconds). Short — refresh rotates. */
  accessTtlSeconds: number;
  /** Refresh-token validity (seconds) — also the Session row lifetime. */
  refreshTtlSeconds: number;
}

export interface OtpConfig {
  /** Login OTP validity (seconds). */
  ttlSeconds: number;
  /** Number of digits in a login OTP. */
  length: number;
  /** Max wrong-OTP attempts before the challenge is invalidated. */
  maxAttempts: number;
}

export interface EmailTokenConfig {
  /** Email-verification link validity (seconds). */
  ttlSeconds: number;
}

export interface AuthConfig {
  pin: PinConfig;
  stepUp: StepUpConfig;
  jwt: JwtConfig;
  otp: OtpConfig;
  emailToken: EmailTokenConfig;
}
```

In the default export's `auth:` object, after the `stepUp: { ttlSeconds: 900 }` entry add:

```ts
    jwt: {
      // 1-hour access token; 30-day refresh. Admin-tunable later (DB-admin layer, §7).
      accessTtlSeconds: 60 * 60,
      refreshTtlSeconds: 30 * 24 * 60 * 60,
    },
    otp: {
      // 5-minute OTP, 6 digits, 5 attempts. Admin-tunable later (§7).
      ttlSeconds: 5 * 60,
      length: 6,
      maxAttempts: 5,
    },
    emailToken: {
      // 24-hour email-verification link. Admin-tunable later (§7).
      ttlSeconds: 24 * 60 * 60,
    },
```

- [ ] **Step 6: Document env** — append to `api/.env.example`:

```
# Auth (web sessions)
JWT_SECRET=                  # SECRET — empty disables token issuance (fail-closed)
AUTH_DEV_EXPOSE_OTP=false    # non-prod only: echo OTP/email tokens in API responses
# WEB_APP_BASE_URL is already defined above — used to build the email-verification link.
```

- [ ] **Step 7: Enable CORS** — in `api/src/main.ts`, immediately before `app.use(helmet());` add:

```ts
// Web app (separate origin) calls the API with a Bearer token. Allow its
// origin + the Authorization/Idempotency-Key headers it sends.
app.enableCors({
  origin: process.env.WEB_APP_BASE_URL ?? "http://localhost:3000",
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization", "Idempotency-Key"],
});
```

- [ ] **Step 8: Run config tests + typecheck**

Run: `pnpm --filter @handshake-agent/api test -- env.schema` then `pnpm --filter @handshake-agent/api typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 9: Commit**

```bash
git add api/package.json api/src/core/config/env.schema.ts api/src/core/config/configuration.ts api/.env.example api/src/main.ts ../pnpm-lock.yaml
git commit -m "feat(api): add @nestjs/jwt, auth env/config TTLs, and web CORS"
```

---

### Task 3: Prisma migration — `User.email`, `User.emailVerifiedAt`, `AuthChallenge`

**Files:**

- Modify: `api/prisma/schema/02-identity.prisma` (add two `User` columns)
- Create: `api/prisma/schema/02a-auth.prisma` (`AuthChallenge` model + `AuthChallengeType` enum)
- Generates: `api/prisma/migrations/<ts>_add_web_auth/migration.sql`, regenerated client in `api/generated/prisma`

**Interfaces:**

- Produces: `users.email` (`String? @unique`), `users.emailVerifiedAt` (`DateTime?`), and the `auth_challenges` table with `(userId, type)` unique.

- [ ] **Step 1: Add the User columns** — in `api/prisma/schema/02-identity.prisma`, inside `model User`, after the `verifiedBackupPhone` line add:

```prisma
  /// Web account login email (set at signup, lowercased). Distinct from
  /// verifiedEmail (the KYC out-of-band backup). emailVerifiedAt gates login.
  email               String?    @unique
  emailVerifiedAt     DateTime?  @db.Timestamptz
```

- [ ] **Step 2: Create the auth schema file** — `api/prisma/schema/02a-auth.prisma`

```prisma
// =============================================================================
// Web-auth challenges (AUTH). Single-use, hashed OTP / email-verification codes
// with TTL + attempt limits. Codes are NEVER stored in plaintext (root §3.5).
// One active challenge per (userId, type); a re-issue overwrites the prior row.
// =============================================================================

/// A pending auth challenge (login OTP or email-verification token) for a user.
model AuthChallenge {
  id            String            @id @default(uuid(7)) @db.Uuid
  userId        String            @db.Uuid
  type          AuthChallengeType
  /// SHA-256 hash of the OTP/token — never plaintext.
  challengeHash String
  /// Incremented on each failed verify; at maxAttempts the challenge is dead.
  attemptCount  Int               @default(0)
  issuedAt      DateTime          @default(now()) @db.Timestamptz
  expiresAt     DateTime          @db.Timestamptz
  /// Set when successfully consumed; a consumed challenge cannot be reused.
  verifiedAt    DateTime?         @db.Timestamptz
  createdAt     DateTime          @default(now()) @db.Timestamptz
  updatedAt     DateTime          @updatedAt @db.Timestamptz

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([userId, type])
  @@index([expiresAt])
  @@map("auth_challenges")
}

enum AuthChallengeType {
  email_verification
  otp_email

  @@map("auth_challenge_type")
}
```

- [ ] **Step 3: Add the back-relation** — in `api/prisma/schema/02-identity.prisma`, inside `model User`, in the relations block (after `handoffTokens HandoffToken[]`) add:

```prisma
  authChallenges    AuthChallenge[]
```

- [ ] **Step 4: Create the migration + regenerate client**

Run:

```bash
pnpm --filter @handshake-agent/api exec prisma migrate dev --name add_web_auth
```

Expected: a new migration is created and applied to the dev DB; the Prisma client regenerates with `email`, `emailVerifiedAt`, and the `authChallenge` model. (Docker Postgres must be running.)

- [ ] **Step 5: Typecheck to confirm the client picked up the new fields**

Run: `pnpm --filter @handshake-agent/api typecheck`
Expected: PASS (no usages yet; this just confirms generation succeeded).

- [ ] **Step 6: Commit**

```bash
git add api/prisma/schema/02-identity.prisma api/prisma/schema/02a-auth.prisma api/prisma/migrations
git commit -m "feat(api): add User.email/emailVerifiedAt and AuthChallenge table"
```

---

### Task 4: Email provider port + dev mock

**Files:**

- Create: `api/src/modules/auth/application/ports/email-provider.port.ts`
- Create: `api/src/modules/auth/infrastructure/mock-email.provider.ts`
- Test: `api/src/modules/auth/infrastructure/mock-email.provider.spec.ts`

**Interfaces:**

- Produces: `EMAIL_PROVIDER` token + `IEmailProvider` (see canonical types); `MockEmailProvider` implements it (logs; builds the verification link from `WEB_APP_BASE_URL`).
- Consumes: `ConfigService` (for `WEB_APP_BASE_URL`).

- [ ] **Step 1: Write the failing test** — `api/src/modules/auth/infrastructure/mock-email.provider.spec.ts`

```ts
import { ConfigService } from "@nestjs/config";
import { MockEmailProvider } from "./mock-email.provider";

function make(webBase?: string) {
  const config = {
    get: (key: string) => (key === "WEB_APP_BASE_URL" ? webBase : undefined),
  } as unknown as ConfigService;
  return new MockEmailProvider(config);
}

describe("MockEmailProvider", () => {
  it("resolves for sendEmailVerification and includes the link in the log", async () => {
    const provider = make("https://app.test");
    const spy = jest.spyOn(provider["logger"], "log");
    await expect(
      provider.sendEmailVerification("a@b.com", "tok123"),
    ).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining("https://app.test/verify-email?token=tok123"),
    );
  });

  it("resolves for sendLoginOtp and logs the code", async () => {
    const provider = make("https://app.test");
    const spy = jest.spyOn(provider["logger"], "log");
    await expect(
      provider.sendLoginOtp("a@b.com", "123456"),
    ).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("123456"));
  });
});
```

- [ ] **Step 2: Run it to confirm failure**

Run: `pnpm --filter @handshake-agent/api test -- mock-email.provider`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the port** — `api/src/modules/auth/application/ports/email-provider.port.ts`

```ts
/**
 * Outbound email port. The dev mock logs; a real provider (Resend/SES) is a
 * later port swap — application code never imports the concrete adapter.
 */
export const EMAIL_PROVIDER = Symbol("EMAIL_PROVIDER");

export interface IEmailProvider {
  /** Sends the email-verification link carrying the single-use token. */
  sendEmailVerification(to: string, token: string): Promise<void>;
  /** Sends the one-time login code. */
  sendLoginOtp(to: string, otp: string): Promise<void>;
}
```

- [ ] **Step 4: Write the mock** — `api/src/modules/auth/infrastructure/mock-email.provider.ts`

```ts
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import type { IEmailProvider } from "../application/ports/email-provider.port";

/**
 * Dev/test email provider: logs the message instead of sending. Real delivery
 * is a later port swap. The verification link is built from WEB_APP_BASE_URL.
 */
@Injectable()
export class MockEmailProvider implements IEmailProvider {
  private readonly logger = new Logger(MockEmailProvider.name);

  constructor(private readonly config: ConfigService) {}

  async sendEmailVerification(to: string, token: string): Promise<void> {
    const base =
      this.config.get<string>("WEB_APP_BASE_URL") ?? "http://localhost:3000";
    const link = `${base}/verify-email?token=${token}`;
    this.logger.log(`[mock-email] verify ${to}: ${link}`);
    return Promise.resolve();
  }

  async sendLoginOtp(to: string, otp: string): Promise<void> {
    this.logger.log(`[mock-email] login OTP for ${to}: ${otp}`);
    return Promise.resolve();
  }
}
```

- [ ] **Step 5: Run tests to verify pass**

Run: `pnpm --filter @handshake-agent/api test -- mock-email.provider`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add api/src/modules/auth/application/ports/email-provider.port.ts api/src/modules/auth/infrastructure/mock-email.provider.ts api/src/modules/auth/infrastructure/mock-email.provider.spec.ts
git commit -m "feat(api): add email provider port + dev mock"
```

---

### Task 5: TokenService (JWT + hashing + OTP generation)

**Files:**

- Create: `api/src/modules/auth/application/token.service.ts`
- Test: `api/src/modules/auth/application/token.service.spec.ts`

**Interfaces:**

- Produces: `TokenService` (see canonical signatures). Fail-closed: `signAccessToken`/`verifyAccessToken` throw `TokenSigningDisabledError` when `JWT_SECRET` is empty.
- Consumes: `JwtService` (from `@nestjs/jwt`), `ConfigService`.
- Create alongside: `api/src/modules/auth/domain/auth-errors.ts` with the domain errors used across the module.

- [ ] **Step 1: Write the domain errors** — `api/src/modules/auth/domain/auth-errors.ts`

```ts
/** Base for all auth domain errors (mapped to HTTP in the controller). */
export abstract class AuthDomainError extends Error {}

/** JWT_SECRET is not configured — token operations are disabled (fail-closed). */
export class TokenSigningDisabledError extends AuthDomainError {
  constructor() {
    super("Token signing is disabled (JWT_SECRET not configured)");
    this.name = "TokenSigningDisabledError";
  }
}

/** The email-verification token is missing, expired, or already used. */
export class InvalidVerificationTokenError extends AuthDomainError {
  constructor() {
    super("Verification link is invalid or has expired");
    this.name = "InvalidVerificationTokenError";
  }
}

/** The login OTP is wrong, expired, or exhausted. Generic on purpose. */
export class InvalidOtpError extends AuthDomainError {
  constructor() {
    super("The code is invalid or has expired");
    this.name = "InvalidOtpError";
  }
}

/** The presented refresh token is unknown, expired, or revoked. */
export class InvalidRefreshTokenError extends AuthDomainError {
  constructor() {
    super("Session expired — please sign in again");
    this.name = "InvalidRefreshTokenError";
  }
}
```

- [ ] **Step 2: Write the failing test** — `api/src/modules/auth/application/token.service.spec.ts`

```ts
import { JwtService } from "@nestjs/jwt";
import { ConfigService } from "@nestjs/config";

import { TokenSigningDisabledError } from "../domain/auth-errors";
import { TokenService } from "./token.service";

function make(secret: string) {
  const config = {
    get: (key: string) => {
      if (key === "JWT_SECRET") return secret;
      if (key === "auth.jwt.accessTtlSeconds") return 3600;
      return undefined;
    },
  } as unknown as ConfigService;
  return new TokenService(new JwtService({}), config);
}

describe("TokenService", () => {
  it("signs and verifies an access token round-trip", () => {
    const svc = make("test-secret");
    const token = svc.signAccessToken("user-1");
    expect(svc.verifyAccessToken(token)).toEqual(
      expect.objectContaining({ sub: "user-1" }),
    );
  });

  it("throws TokenSigningDisabledError when JWT_SECRET is empty", () => {
    const svc = make("");
    expect(() => svc.signAccessToken("user-1")).toThrow(
      TokenSigningDisabledError,
    );
    expect(() => svc.verifyAccessToken("whatever")).toThrow(
      TokenSigningDisabledError,
    );
  });

  it("rejects a token signed with a different secret", () => {
    const a = make("secret-a");
    const b = make("secret-b");
    const token = a.signAccessToken("user-1");
    expect(() => b.verifyAccessToken(token)).toThrow();
  });

  it("hash is deterministic 64-hex; opaque token is 64-hex and unique", () => {
    const svc = make("s");
    expect(svc.hash("abc")).toBe(svc.hash("abc"));
    expect(svc.hash("abc")).toMatch(/^[0-9a-f]{64}$/);
    const t1 = svc.generateOpaqueToken();
    const t2 = svc.generateOpaqueToken();
    expect(t1).toMatch(/^[0-9a-f]{64}$/);
    expect(t1).not.toBe(t2);
  });

  it("generates a numeric OTP of the requested length", () => {
    const svc = make("s");
    const otp = svc.generateNumericOtp(6);
    expect(otp).toMatch(/^[0-9]{6}$/);
  });
});
```

- [ ] **Step 3: Run it to confirm failure**

Run: `pnpm --filter @handshake-agent/api test -- token.service`
Expected: FAIL — module not found.

- [ ] **Step 4: Write the service** — `api/src/modules/auth/application/token.service.ts`

```ts
import { createHash, randomBytes, randomInt } from "node:crypto";

import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";

import { TokenSigningDisabledError } from "../domain/auth-errors";

/**
 * All token crypto for the auth module: access-JWT sign/verify, opaque refresh
 * tokens, SHA-256 hashing (for storing token/OTP hashes), and numeric OTPs.
 *
 * Fail-closed: if JWT_SECRET is empty, signing/verifying throw — the app boots
 * but auth is disabled (mirrors the ADMIN_API_TOKEN pattern, root §7).
 */
@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  private secret(): string {
    const secret = this.config.get<string>("JWT_SECRET") ?? "";
    if (secret === "") throw new TokenSigningDisabledError();
    return secret;
  }

  signAccessToken(userId: string): string {
    const ttl = this.config.get<number>("auth.jwt.accessTtlSeconds") ?? 3600;
    return this.jwt.sign(
      { sub: userId },
      { secret: this.secret(), expiresIn: ttl },
    );
  }

  verifyAccessToken(token: string): { sub: string } {
    const payload = this.jwt.verify<{ sub: string }>(token, {
      secret: this.secret(),
    });
    return { sub: payload.sub };
  }

  generateOpaqueToken(): string {
    return randomBytes(32).toString("hex");
  }

  hash(value: string): string {
    return createHash("sha256").update(value).digest("hex");
  }

  generateNumericOtp(length: number): string {
    let otp = "";
    for (let i = 0; i < length; i += 1) otp += randomInt(0, 10).toString();
    return otp;
  }
}
```

- [ ] **Step 5: Run tests to verify pass**

Run: `pnpm --filter @handshake-agent/api test -- token.service`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add api/src/modules/auth/domain/auth-errors.ts api/src/modules/auth/application/token.service.ts api/src/modules/auth/application/token.service.spec.ts
git commit -m "feat(api): add auth TokenService + domain errors"
```

---

### Task 6: AuthChallenge repository (port + Prisma adapter)

**Files:**

- Create: `api/src/modules/auth/application/ports/auth-challenge.repository.port.ts`
- Create: `api/src/modules/auth/infrastructure/auth-challenge.prisma.repository.ts`
- Test: `api/src/modules/auth/infrastructure/auth-challenge.prisma.repository.spec.ts` (Testcontainers integration)

**Interfaces:**

- Produces: `AUTH_CHALLENGE_REPOSITORY` + `IAuthChallengeRepository` (canonical types); `AuthChallengePrismaRepository`.
- Consumes: `PrismaService`.

> **Testcontainers note:** integration repo tests in this repo spin up real Postgres. Follow the existing pattern in any `*.prisma.repository.spec.ts` under `api/src` (search for one with `@testcontainers/postgresql` + `PrismaService`). Reuse that harness verbatim (container start in `beforeAll`, `prisma.$executeRaw`/`migrate deploy` setup, truncate between tests). The steps below show the assertions, not the harness boilerplate — copy the harness from the nearest existing example.

- [ ] **Step 1: Write the port** — `api/src/modules/auth/application/ports/auth-challenge.repository.port.ts`

```ts
export const AUTH_CHALLENGE_REPOSITORY = Symbol("AUTH_CHALLENGE_REPOSITORY");

export type AuthChallengeType = "email_verification" | "otp_email";

export interface IAuthChallengeRepository {
  /** Upserts the single active challenge for (userId, type), resetting attempts. */
  upsert(input: {
    userId: string;
    type: AuthChallengeType;
    challengeHash: string;
    expiresAt: Date;
  }): Promise<void>;

  /** Finds an unconsumed, unexpired challenge by hash+type (email-verify path). */
  findActiveByHashAndType(
    challengeHash: string,
    type: AuthChallengeType,
    now: Date,
  ): Promise<{ id: string; userId: string } | null>;

  /** Finds an unconsumed, unexpired challenge by user+type (login-OTP path). */
  findActiveByUserAndType(
    userId: string,
    type: AuthChallengeType,
    now: Date,
  ): Promise<{
    id: string;
    challengeHash: string;
    attemptCount: number;
  } | null>;

  incrementAttempt(id: string): Promise<void>;

  /** Marks the challenge consumed (sets verifiedAt) — single-use. */
  consume(id: string, now: Date): Promise<void>;
}
```

- [ ] **Step 2: Write the failing integration test** — `api/src/modules/auth/infrastructure/auth-challenge.prisma.repository.spec.ts`

Using the copied Testcontainers harness, assert:

```ts
// (harness sets up `prisma: PrismaService` against a real container + a seeded user)
it("upsert then findActiveByHashAndType returns the row; consume makes it inactive", async () => {
  const repo = new AuthChallengePrismaRepository(prisma);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 60_000);
  await repo.upsert({
    userId,
    type: "email_verification",
    challengeHash: "h1",
    expiresAt,
  });

  const found = await repo.findActiveByHashAndType(
    "h1",
    "email_verification",
    now,
  );
  expect(found).toMatchObject({ userId });

  await repo.consume(found!.id, now);
  expect(
    await repo.findActiveByHashAndType("h1", "email_verification", now),
  ).toBeNull();
});

it("upsert replaces the prior active challenge for the same (user,type)", async () => {
  const repo = new AuthChallengePrismaRepository(prisma);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 60_000);
  await repo.upsert({
    userId,
    type: "otp_email",
    challengeHash: "old",
    expiresAt,
  });
  await repo.upsert({
    userId,
    type: "otp_email",
    challengeHash: "new",
    expiresAt,
  });
  const byUser = await repo.findActiveByUserAndType(userId, "otp_email", now);
  expect(byUser?.challengeHash).toBe("new");
  expect(byUser?.attemptCount).toBe(0);
});

it("expired challenges are not returned", async () => {
  const repo = new AuthChallengePrismaRepository(prisma);
  const past = new Date(Date.now() - 1000);
  await repo.upsert({
    userId,
    type: "otp_email",
    challengeHash: "h",
    expiresAt: past,
  });
  expect(
    await repo.findActiveByUserAndType(userId, "otp_email", new Date()),
  ).toBeNull();
});

it("incrementAttempt bumps the counter", async () => {
  const repo = new AuthChallengePrismaRepository(prisma);
  const now = new Date();
  await repo.upsert({
    userId,
    type: "otp_email",
    challengeHash: "h",
    expiresAt: new Date(now.getTime() + 60_000),
  });
  const c = await repo.findActiveByUserAndType(userId, "otp_email", now);
  await repo.incrementAttempt(c!.id);
  const after = await repo.findActiveByUserAndType(userId, "otp_email", now);
  expect(after?.attemptCount).toBe(1);
});
```

- [ ] **Step 3: Run it to confirm failure**

Run: `pnpm --filter @handshake-agent/api test -- auth-challenge.prisma.repository`
Expected: FAIL — adapter not found.

- [ ] **Step 4: Write the adapter** — `api/src/modules/auth/infrastructure/auth-challenge.prisma.repository.ts`

```ts
import { Injectable } from "@nestjs/common";

import { PrismaService } from "../../../core/prisma/prisma.service";
import type {
  AuthChallengeType,
  IAuthChallengeRepository,
} from "../application/ports/auth-challenge.repository.port";

@Injectable()
export class AuthChallengePrismaRepository implements IAuthChallengeRepository {
  constructor(private readonly prisma: PrismaService) {}

  async upsert(input: {
    userId: string;
    type: AuthChallengeType;
    challengeHash: string;
    expiresAt: Date;
  }): Promise<void> {
    const { userId, type, challengeHash, expiresAt } = input;
    await this.prisma.authChallenge.upsert({
      where: { userId_type: { userId, type } },
      create: { userId, type, challengeHash, expiresAt },
      update: {
        challengeHash,
        expiresAt,
        attemptCount: 0,
        verifiedAt: null,
        issuedAt: new Date(),
      },
    });
  }

  async findActiveByHashAndType(
    challengeHash: string,
    type: AuthChallengeType,
    now: Date,
  ): Promise<{ id: string; userId: string } | null> {
    const row = await this.prisma.authChallenge.findFirst({
      where: { challengeHash, type, verifiedAt: null, expiresAt: { gt: now } },
      select: { id: true, userId: true },
    });
    return row ?? null;
  }

  async findActiveByUserAndType(
    userId: string,
    type: AuthChallengeType,
    now: Date,
  ): Promise<{
    id: string;
    challengeHash: string;
    attemptCount: number;
  } | null> {
    const row = await this.prisma.authChallenge.findFirst({
      where: { userId, type, verifiedAt: null, expiresAt: { gt: now } },
      select: { id: true, challengeHash: true, attemptCount: true },
    });
    return row ?? null;
  }

  async incrementAttempt(id: string): Promise<void> {
    await this.prisma.authChallenge.update({
      where: { id },
      data: { attemptCount: { increment: 1 } },
    });
  }

  async consume(id: string, now: Date): Promise<void> {
    await this.prisma.authChallenge.update({
      where: { id },
      data: { verifiedAt: now },
    });
  }
}
```

- [ ] **Step 5: Run tests to verify pass**

Run: `pnpm --filter @handshake-agent/api test -- auth-challenge.prisma.repository`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add api/src/modules/auth/application/ports/auth-challenge.repository.port.ts api/src/modules/auth/infrastructure/auth-challenge.prisma.repository.ts api/src/modules/auth/infrastructure/auth-challenge.prisma.repository.spec.ts
git commit -m "feat(api): add AuthChallenge repository (port + prisma)"
```

---

### Task 7: Auth user repository (port + Prisma adapter)

**Files:**

- Create: `api/src/modules/auth/application/ports/auth-user.repository.port.ts`
- Create: `api/src/modules/auth/infrastructure/auth-user.prisma.repository.ts`
- Test: `api/src/modules/auth/infrastructure/auth-user.prisma.repository.spec.ts` (Testcontainers)

**Interfaces:**

- Produces: `AUTH_USER_REPOSITORY` + `IAuthUserRepository` + `AuthUserRecord` + `MeProjection` (canonical types); `AuthUserPrismaRepository`.
- Consumes: `PrismaService`.

- [ ] **Step 1: Write the port** — `api/src/modules/auth/application/ports/auth-user.repository.port.ts`

```ts
export const AUTH_USER_REPOSITORY = Symbol("AUTH_USER_REPOSITORY");

export interface AuthUserRecord {
  id: string;
  email: string;
  emailVerifiedAt: Date | null;
  kycStatus: string;
  kycTier: string;
  pinHash: string | null;
}

export interface MeProjection {
  userId: string;
  email: string;
  kycStatus: string;
  kycTier: string;
  hasPin: boolean;
}

export interface IAuthUserRepository {
  /**
   * Creates a provisional User with the (lowercased) email + a pending WhatsApp
   * ChannelIdentity for the phone (the later-link hook, §3.4). If the email
   * already exists, returns its userId with created:false (no duplicate). If the
   * phone already has an active WhatsApp ChannelIdentity, the CI is skipped.
   */
  createSignup(input: {
    email: string;
    phone: string;
  }): Promise<{ userId: string; created: boolean }>;

  findByEmail(email: string): Promise<AuthUserRecord | null>;

  markEmailVerified(userId: string, now: Date): Promise<void>;

  /**
   * Upserts the Device by fingerprint, marks it bound, and pins it on the User
   * if no device is pinned yet. Returns the device id.
   */
  bindDevice(input: {
    userId: string;
    fingerprint: string;
    userAgent?: string;
    ip?: string;
  }): Promise<{ deviceId: string }>;

  loadMe(userId: string): Promise<MeProjection | null>;
}
```

- [ ] **Step 2: Write the failing integration test** — assertions (with the copied harness):

```ts
it("createSignup creates a provisional user + pending whatsapp CI; idempotent on email", async () => {
  const repo = new AuthUserPrismaRepository(prisma);
  const a = await repo.createSignup({
    email: "New@Test.com",
    phone: "+2348011111111",
  });
  expect(a.created).toBe(true);

  const user = await prisma.user.findUnique({ where: { id: a.userId } });
  expect(user?.email).toBe("new@test.com"); // lowercased
  expect(user?.status).toBe("provisional");

  const ci = await prisma.channelIdentity.findFirst({
    where: { userId: a.userId, channel: "whatsapp" },
  });
  expect(ci?.verificationStatus).toBe("pending");

  const again = await repo.createSignup({
    email: "new@test.com",
    phone: "+2348011111111",
  });
  expect(again.created).toBe(false);
  expect(again.userId).toBe(a.userId);
});

it("findByEmail is case-insensitive on the stored lowercase; markEmailVerified sets it", async () => {
  const repo = new AuthUserPrismaRepository(prisma);
  const { userId } = await repo.createSignup({
    email: "v@test.com",
    phone: "+2348012222222",
  });
  expect((await repo.findByEmail("V@test.com"))?.emailVerifiedAt).toBeNull();
  await repo.markEmailVerified(userId, new Date());
  expect(
    (await repo.findByEmail("v@test.com"))?.emailVerifiedAt,
  ).not.toBeNull();
});

it("bindDevice upserts by fingerprint and pins on first bind", async () => {
  const repo = new AuthUserPrismaRepository(prisma);
  const { userId } = await repo.createSignup({
    email: "d@test.com",
    phone: "+2348013333333",
  });
  const first = await repo.bindDevice({ userId, fingerprint: "fp-xyz" });
  const second = await repo.bindDevice({ userId, fingerprint: "fp-xyz" });
  expect(second.deviceId).toBe(first.deviceId); // upsert, not duplicate
  const user = await prisma.user.findUnique({ where: { id: userId } });
  expect(user?.pinnedDeviceId).toBe(first.deviceId);
});

it("loadMe projects kyc + hasPin", async () => {
  const repo = new AuthUserPrismaRepository(prisma);
  const { userId } = await repo.createSignup({
    email: "m@test.com",
    phone: "+2348014444444",
  });
  const me = await repo.loadMe(userId);
  expect(me).toMatchObject({ userId, email: "m@test.com", hasPin: false });
});
```

- [ ] **Step 3: Run it to confirm failure**

Run: `pnpm --filter @handshake-agent/api test -- auth-user.prisma.repository`
Expected: FAIL — adapter not found.

- [ ] **Step 4: Write the adapter** — `api/src/modules/auth/infrastructure/auth-user.prisma.repository.ts`

```ts
import { Injectable } from "@nestjs/common";

import { PrismaService } from "../../../core/prisma/prisma.service";
import type {
  AuthUserRecord,
  IAuthUserRepository,
  MeProjection,
} from "../application/ports/auth-user.repository.port";

function normalizePhone(phone: string): string {
  return phone.startsWith("+") ? phone : `+${phone}`;
}

@Injectable()
export class AuthUserPrismaRepository implements IAuthUserRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createSignup(input: {
    email: string;
    phone: string;
  }): Promise<{ userId: string; created: boolean }> {
    const email = input.email.trim().toLowerCase();
    const phone = normalizePhone(input.phone.trim());

    const existing = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });
    if (existing) return { userId: existing.id, created: false };

    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { email, status: "provisional" },
        select: { id: true },
      });

      // Pending WhatsApp ChannelIdentity = the later-link hook (§3.4). Skip if
      // the phone already has an active WhatsApp CI (avoid hijack / unique clash).
      const existingCi = await tx.channelIdentity.findFirst({
        where: { channel: "whatsapp", channelAddress: phone, deletedAt: null },
        select: { id: true },
      });
      if (existingCi === null) {
        await tx.channelIdentity.create({
          data: {
            channel: "whatsapp",
            channelAddress: phone,
            normalizedPhone: phone,
            userId: user.id,
            verificationStatus: "pending",
          },
        });
      }

      return { userId: user.id, created: true };
    });
  }

  async findByEmail(email: string): Promise<AuthUserRecord | null> {
    const row = await this.prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
      select: {
        id: true,
        email: true,
        emailVerifiedAt: true,
        kycStatus: true,
        kycTier: true,
        pinHash: true,
      },
    });
    if (row === null || row.email === null) return null;
    return {
      id: row.id,
      email: row.email,
      emailVerifiedAt: row.emailVerifiedAt,
      kycStatus: row.kycStatus,
      kycTier: row.kycTier,
      pinHash: row.pinHash,
    };
  }

  async markEmailVerified(userId: string, now: Date): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { emailVerifiedAt: now },
    });
  }

  async bindDevice(input: {
    userId: string;
    fingerprint: string;
    userAgent?: string;
    ip?: string;
  }): Promise<{ deviceId: string }> {
    const now = new Date();
    const device = await this.prisma.device.upsert({
      where: { fingerprint: input.fingerprint },
      create: {
        userId: input.userId,
        fingerprint: input.fingerprint,
        trustState: "bound",
        userAgent: input.userAgent,
        ipAddressAtBinding: input.ip,
        boundAt: now,
        lastUsedAt: now,
      },
      update: { lastUsedAt: now, trustState: "bound" },
      select: { id: true },
    });

    // Pin on first bind (User.pinnedDeviceId is unique; only set when null).
    await this.prisma.user.updateMany({
      where: { id: input.userId, pinnedDeviceId: null },
      data: { pinnedDeviceId: device.id },
    });

    return { deviceId: device.id };
  }

  async loadMe(userId: string): Promise<MeProjection | null> {
    const row = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        kycStatus: true,
        kycTier: true,
        pinHash: true,
      },
    });
    if (row === null || row.email === null) return null;
    return {
      userId: row.id,
      email: row.email,
      kycStatus: row.kycStatus,
      kycTier: row.kycTier,
      hasPin: row.pinHash !== null,
    };
  }
}
```

- [ ] **Step 5: Run tests to verify pass**

Run: `pnpm --filter @handshake-agent/api test -- auth-user.prisma.repository`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add api/src/modules/auth/application/ports/auth-user.repository.port.ts api/src/modules/auth/infrastructure/auth-user.prisma.repository.ts api/src/modules/auth/infrastructure/auth-user.prisma.repository.spec.ts
git commit -m "feat(api): add auth user repository (port + prisma)"
```

---

### Task 8: Auth session repository (port + Prisma adapter)

**Files:**

- Create: `api/src/modules/auth/application/ports/auth-session.repository.port.ts`
- Create: `api/src/modules/auth/infrastructure/auth-session.prisma.repository.ts`
- Test: `api/src/modules/auth/infrastructure/auth-session.prisma.repository.spec.ts` (Testcontainers)

**Interfaces:**

- Produces: `AUTH_SESSION_REPOSITORY` + `IAuthSessionRepository` (canonical types); `AuthSessionPrismaRepository`. Writes `Session` rows with `channel: 'web'`. (Distinct concern from `core/auth` `ISessionRepository`, which is step-up only; both touch the `sessions` table.)
- Consumes: `PrismaService`.

- [ ] **Step 1: Write the port** — `api/src/modules/auth/application/ports/auth-session.repository.port.ts`

```ts
export const AUTH_SESSION_REPOSITORY = Symbol("AUTH_SESSION_REPOSITORY");

export interface IAuthSessionRepository {
  create(input: {
    userId: string;
    deviceId: string;
    accessTokenHash: string;
    refreshTokenHash: string;
    expiresAt: Date;
  }): Promise<{ sessionId: string }>;

  findActiveByAccessHash(
    accessTokenHash: string,
    now: Date,
  ): Promise<{ id: string; userId: string; deviceId: string | null } | null>;

  findActiveByRefreshHash(
    refreshTokenHash: string,
    now: Date,
  ): Promise<{ id: string; userId: string; deviceId: string | null } | null>;

  rotate(
    sessionId: string,
    input: { accessTokenHash: string; refreshTokenHash: string; now: Date },
  ): Promise<void>;

  revoke(sessionId: string, now: Date, reason?: string): Promise<void>;
}
```

- [ ] **Step 2: Write the failing integration test** — assertions (copied harness, seeded user + device):

```ts
it("create then findActiveByAccessHash / findActiveByRefreshHash return the session", async () => {
  const repo = new AuthSessionPrismaRepository(prisma);
  const now = new Date();
  const { sessionId } = await repo.create({
    userId,
    deviceId,
    accessTokenHash: "ah",
    refreshTokenHash: "rh",
    expiresAt: new Date(now.getTime() + 60_000),
  });
  expect((await repo.findActiveByAccessHash("ah", now))?.id).toBe(sessionId);
  expect((await repo.findActiveByRefreshHash("rh", now))?.userId).toBe(userId);
});

it("rotate swaps the hashes; old hashes no longer resolve", async () => {
  const repo = new AuthSessionPrismaRepository(prisma);
  const now = new Date();
  const { sessionId } = await repo.create({
    userId,
    deviceId,
    accessTokenHash: "a1",
    refreshTokenHash: "r1",
    expiresAt: new Date(now.getTime() + 60_000),
  });
  await repo.rotate(sessionId, {
    accessTokenHash: "a2",
    refreshTokenHash: "r2",
    now,
  });
  expect(await repo.findActiveByRefreshHash("r1", now)).toBeNull();
  expect((await repo.findActiveByRefreshHash("r2", now))?.id).toBe(sessionId);
});

it("revoke makes the session inactive", async () => {
  const repo = new AuthSessionPrismaRepository(prisma);
  const now = new Date();
  const { sessionId } = await repo.create({
    userId,
    deviceId,
    accessTokenHash: "a",
    refreshTokenHash: "r",
    expiresAt: new Date(now.getTime() + 60_000),
  });
  await repo.revoke(sessionId, now, "logout");
  expect(await repo.findActiveByAccessHash("a", now)).toBeNull();
});

it("expired sessions do not resolve", async () => {
  const repo = new AuthSessionPrismaRepository(prisma);
  const past = new Date(Date.now() - 1000);
  await repo.create({
    userId,
    deviceId,
    accessTokenHash: "x",
    refreshTokenHash: "y",
    expiresAt: past,
  });
  expect(await repo.findActiveByAccessHash("x", new Date())).toBeNull();
});
```

- [ ] **Step 3: Run it to confirm failure**

Run: `pnpm --filter @handshake-agent/api test -- auth-session.prisma.repository`
Expected: FAIL — adapter not found.

- [ ] **Step 4: Write the adapter** — `api/src/modules/auth/infrastructure/auth-session.prisma.repository.ts`

```ts
import { Injectable } from "@nestjs/common";

import { PrismaService } from "../../../core/prisma/prisma.service";
import type { IAuthSessionRepository } from "../application/ports/auth-session.repository.port";

@Injectable()
export class AuthSessionPrismaRepository implements IAuthSessionRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: {
    userId: string;
    deviceId: string;
    accessTokenHash: string;
    refreshTokenHash: string;
    expiresAt: Date;
  }): Promise<{ sessionId: string }> {
    const row = await this.prisma.session.create({
      data: {
        userId: input.userId,
        deviceId: input.deviceId,
        accessTokenHash: input.accessTokenHash,
        refreshTokenHash: input.refreshTokenHash,
        channel: "web",
        isActive: true,
        expiresAt: input.expiresAt,
        lastActivityAt: new Date(),
      },
      select: { id: true },
    });
    return { sessionId: row.id };
  }

  async findActiveByAccessHash(
    accessTokenHash: string,
    now: Date,
  ): Promise<{ id: string; userId: string; deviceId: string | null } | null> {
    const row = await this.prisma.session.findFirst({
      where: {
        accessTokenHash,
        isActive: true,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      select: { id: true, userId: true, deviceId: true },
    });
    return row ?? null;
  }

  async findActiveByRefreshHash(
    refreshTokenHash: string,
    now: Date,
  ): Promise<{ id: string; userId: string; deviceId: string | null } | null> {
    const row = await this.prisma.session.findFirst({
      where: {
        refreshTokenHash,
        isActive: true,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      select: { id: true, userId: true, deviceId: true },
    });
    return row ?? null;
  }

  async rotate(
    sessionId: string,
    input: { accessTokenHash: string; refreshTokenHash: string; now: Date },
  ): Promise<void> {
    await this.prisma.session.update({
      where: { id: sessionId },
      data: {
        accessTokenHash: input.accessTokenHash,
        refreshTokenHash: input.refreshTokenHash,
        lastActivityAt: input.now,
      },
    });
  }

  async revoke(sessionId: string, now: Date, reason?: string): Promise<void> {
    await this.prisma.session.update({
      where: { id: sessionId },
      data: { isActive: false, revokedAt: now, revokedReason: reason },
    });
  }
}
```

- [ ] **Step 5: Run tests to verify pass**

Run: `pnpm --filter @handshake-agent/api test -- auth-session.prisma.repository`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add api/src/modules/auth/application/ports/auth-session.repository.port.ts api/src/modules/auth/infrastructure/auth-session.prisma.repository.ts api/src/modules/auth/infrastructure/auth-session.prisma.repository.spec.ts
git commit -m "feat(api): add auth session repository (port + prisma)"
```

---

### Task 9: AuthService — signup + verifyEmail

**Files:**

- Create: `api/src/modules/auth/application/auth.service.ts` (signup + verifyEmail now; login/refresh/me added in Tasks 10–11)
- Test: `api/src/modules/auth/application/auth.service.spec.ts`

**Interfaces:**

- Consumes: `TokenService`, `IEmailProvider` (`EMAIL_PROVIDER`), `IAuthChallengeRepository` (`AUTH_CHALLENGE_REPOSITORY`), `IAuthUserRepository` (`AUTH_USER_REPOSITORY`), `ConfigService`.
- Produces: `AuthService.signup`, `AuthService.verifyEmail` (canonical signatures).

- [ ] **Step 1: Write the failing test** — `api/src/modules/auth/application/auth.service.spec.ts`

```ts
import { ConfigService } from "@nestjs/config";

import { InvalidVerificationTokenError } from "../domain/auth-errors";
import { AuthService } from "./auth.service";

function makeDeps(overrides: Partial<Record<string, unknown>> = {}) {
  const tokenService = {
    generateOpaqueToken: jest.fn(() => "opaque-token"),
    hash: jest.fn((v: string) => `hash(${v})`),
    generateNumericOtp: jest.fn(() => "123456"),
    signAccessToken: jest.fn(() => "access.jwt"),
  };
  const email = {
    sendEmailVerification: jest.fn(async () => undefined),
    sendLoginOtp: jest.fn(async () => undefined),
  };
  const challengeRepo = {
    upsert: jest.fn(async () => undefined),
    findActiveByHashAndType: jest.fn(async () => null),
    findActiveByUserAndType: jest.fn(async () => null),
    incrementAttempt: jest.fn(async () => undefined),
    consume: jest.fn(async () => undefined),
  };
  const userRepo = {
    createSignup: jest.fn(async () => ({ userId: "u1", created: true })),
    findByEmail: jest.fn(async () => null),
    markEmailVerified: jest.fn(async () => undefined),
    bindDevice: jest.fn(async () => ({ deviceId: "d1" })),
    loadMe: jest.fn(async () => ({
      userId: "u1",
      email: "a@b.com",
      kycStatus: "not_started",
      kycTier: "unverified",
      hasPin: false,
    })),
  };
  const sessionRepo = {
    create: jest.fn(async () => ({ sessionId: "s1" })),
    findActiveByAccessHash: jest.fn(async () => null),
    findActiveByRefreshHash: jest.fn(async () => null),
    rotate: jest.fn(async () => undefined),
    revoke: jest.fn(async () => undefined),
  };
  const config = {
    get: (key: string) => {
      const map: Record<string, unknown> = {
        AUTH_DEV_EXPOSE_OTP: "false",
        "auth.emailToken.ttlSeconds": 86400,
        "auth.otp.ttlSeconds": 300,
        "auth.otp.length": 6,
        "auth.otp.maxAttempts": 5,
        "auth.jwt.refreshTtlSeconds": 2592000,
        ...overrides,
      };
      return map[key];
    },
  } as unknown as ConfigService;

  const service = new AuthService(
    tokenService as never,
    email as never,
    challengeRepo as never,
    userRepo as never,
    sessionRepo as never,
    config,
  );
  return { service, tokenService, email, challengeRepo, userRepo, sessionRepo };
}

describe("AuthService.signup", () => {
  it("creates the user, stores a hashed email-verification challenge, sends the email", async () => {
    const { service, email, challengeRepo, userRepo } = makeDeps();
    const res = await service.signup({
      email: "a@b.com",
      phone: "+2348010000000",
    });
    expect(userRepo.createSignup).toHaveBeenCalledWith({
      email: "a@b.com",
      phone: "+2348010000000",
    });
    expect(challengeRepo.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "u1",
        type: "email_verification",
        challengeHash: "hash(opaque-token)",
      }),
    );
    expect(email.sendEmailVerification).toHaveBeenCalledWith(
      "a@b.com",
      "opaque-token",
    );
    expect(res).toEqual({ status: "pending_verification" });
  });

  it("echoes devToken when AUTH_DEV_EXPOSE_OTP=true", async () => {
    const { service } = makeDeps({ AUTH_DEV_EXPOSE_OTP: "true" });
    const res = await service.signup({
      email: "a@b.com",
      phone: "+2348010000000",
    });
    expect(res).toEqual({
      status: "pending_verification",
      devToken: "opaque-token",
    });
  });
});

describe("AuthService.verifyEmail", () => {
  it("consumes a valid token and marks the email verified", async () => {
    const { service, challengeRepo, userRepo } = makeDeps();
    challengeRepo.findActiveByHashAndType.mockResolvedValueOnce({
      id: "c1",
      userId: "u1",
    });
    const res = await service.verifyEmail({ token: "opaque-token" });
    expect(challengeRepo.findActiveByHashAndType).toHaveBeenCalledWith(
      "hash(opaque-token)",
      "email_verification",
      expect.any(Date),
    );
    expect(challengeRepo.consume).toHaveBeenCalledWith("c1", expect.any(Date));
    expect(userRepo.markEmailVerified).toHaveBeenCalledWith(
      "u1",
      expect.any(Date),
    );
    expect(res).toEqual({ verified: true });
  });

  it("throws InvalidVerificationTokenError when no active challenge matches", async () => {
    const { service } = makeDeps();
    await expect(service.verifyEmail({ token: "bad" })).rejects.toBeInstanceOf(
      InvalidVerificationTokenError,
    );
  });
});
```

- [ ] **Step 2: Run it to confirm failure**

Run: `pnpm --filter @handshake-agent/api test -- auth.service`
Expected: FAIL — `AuthService` not found.

- [ ] **Step 3: Write the service (signup + verifyEmail + ctor with all deps)** — `api/src/modules/auth/application/auth.service.ts`

```ts
import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import type {
  LoginRequest,
  LoginRequestResponse,
  SignupRequest,
  SignupResponse,
  VerifyEmailRequest,
  VerifyEmailResponse,
} from "@handshake-agent/contracts";

import { InvalidVerificationTokenError } from "../domain/auth-errors";
import {
  AUTH_CHALLENGE_REPOSITORY,
  type IAuthChallengeRepository,
} from "./ports/auth-challenge.repository.port";
import {
  AUTH_USER_REPOSITORY,
  type IAuthUserRepository,
} from "./ports/auth-user.repository.port";
import {
  AUTH_SESSION_REPOSITORY,
  type IAuthSessionRepository,
} from "./ports/auth-session.repository.port";
import {
  EMAIL_PROVIDER,
  type IEmailProvider,
} from "./ports/email-provider.port";
import { TokenService } from "./token.service";

@Injectable()
export class AuthService {
  constructor(
    private readonly tokens: TokenService,
    @Inject(EMAIL_PROVIDER) private readonly email: IEmailProvider,
    @Inject(AUTH_CHALLENGE_REPOSITORY)
    private readonly challenges: IAuthChallengeRepository,
    @Inject(AUTH_USER_REPOSITORY) private readonly users: IAuthUserRepository,
    @Inject(AUTH_SESSION_REPOSITORY)
    private readonly sessions: IAuthSessionRepository,
    private readonly config: ConfigService,
  ) {}

  private devExpose(): boolean {
    return this.config.get<string>("AUTH_DEV_EXPOSE_OTP") === "true";
  }

  async signup(input: SignupRequest): Promise<SignupResponse> {
    const { userId } = await this.users.createSignup({
      email: input.email,
      phone: input.phone,
    });

    const token = this.tokens.generateOpaqueToken();
    const ttl = this.config.get<number>("auth.emailToken.ttlSeconds") ?? 86400;
    await this.challenges.upsert({
      userId,
      type: "email_verification",
      challengeHash: this.tokens.hash(token),
      expiresAt: new Date(Date.now() + ttl * 1000),
    });

    await this.email.sendEmailVerification(input.email, token);

    return this.devExpose()
      ? { status: "pending_verification", devToken: token }
      : { status: "pending_verification" };
  }

  async verifyEmail(input: VerifyEmailRequest): Promise<VerifyEmailResponse> {
    const now = new Date();
    const challenge = await this.challenges.findActiveByHashAndType(
      this.tokens.hash(input.token),
      "email_verification",
      now,
    );
    if (challenge === null) throw new InvalidVerificationTokenError();

    await this.challenges.consume(challenge.id, now);
    await this.users.markEmailVerified(challenge.userId, now);
    return { verified: true };
  }
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm --filter @handshake-agent/api test -- auth.service`
Expected: PASS (signup + verifyEmail suites green).

- [ ] **Step 5: Commit**

```bash
git add api/src/modules/auth/application/auth.service.ts api/src/modules/auth/application/auth.service.spec.ts
git commit -m "feat(api): add AuthService signup + email verification"
```

---

### Task 10: AuthService — loginRequest + loginVerify

**Files:**

- Modify: `api/src/modules/auth/application/auth.service.ts` (add `loginRequest`, `loginVerify`)
- Modify: `api/src/modules/auth/application/auth.service.spec.ts` (add login suites)

**Interfaces:**

- Produces: `AuthService.loginRequest`, `AuthService.loginVerify` (canonical signatures).
- Consumes (already injected): `TokenService`, `IEmailProvider`, all repos, `ConfigService`.

- [ ] **Step 1: Add failing tests** to `auth.service.spec.ts`:

```ts
import { InvalidOtpError } from "../domain/auth-errors";

describe("AuthService.loginRequest", () => {
  it("sends an OTP for a verified user and stores its hash", async () => {
    const { service, email, challengeRepo, userRepo } = makeDeps();
    userRepo.findByEmail.mockResolvedValueOnce({
      id: "u1",
      email: "a@b.com",
      emailVerifiedAt: new Date(),
      kycStatus: "verified",
      kycTier: "tier_1",
      pinHash: "x",
    });
    const res = await service.loginRequest({ email: "a@b.com" });
    expect(challengeRepo.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "u1",
        type: "otp_email",
        challengeHash: "hash(123456)",
      }),
    );
    expect(email.sendLoginOtp).toHaveBeenCalledWith("a@b.com", "123456");
    expect(res).toEqual({ status: "otp_sent" });
  });

  it("does not send and still returns otp_sent for an unknown/unverified user (no enumeration)", async () => {
    const { service, email } = makeDeps();
    const res = await service.loginRequest({ email: "ghost@b.com" });
    expect(email.sendLoginOtp).not.toHaveBeenCalled();
    expect(res).toEqual({ status: "otp_sent" });
  });
});

describe("AuthService.loginVerify", () => {
  const verified = {
    id: "u1",
    email: "a@b.com",
    emailVerifiedAt: new Date(),
    kycStatus: "verified",
    kycTier: "tier_1",
    pinHash: "x",
  };

  it("verifies the OTP, binds the device, creates a session, returns tokens + me", async () => {
    const { service, userRepo, challengeRepo, sessionRepo, tokenService } =
      makeDeps();
    userRepo.findByEmail.mockResolvedValueOnce(verified);
    challengeRepo.findActiveByUserAndType.mockResolvedValueOnce({
      id: "c1",
      challengeHash: "hash(123456)",
      attemptCount: 0,
    });
    tokenService.generateOpaqueToken.mockReturnValueOnce("refresh-token");

    const res = await service.loginVerify({
      email: "a@b.com",
      otp: "123456",
      deviceFingerprint: "fp-1",
    });

    expect(challengeRepo.consume).toHaveBeenCalledWith("c1", expect.any(Date));
    expect(userRepo.bindDevice).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "u1", fingerprint: "fp-1" }),
    );
    expect(sessionRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "u1",
        deviceId: "d1",
        accessTokenHash: "hash(access.jwt)",
        refreshTokenHash: "hash(refresh-token)",
      }),
    );
    expect(res).toEqual({
      accessToken: "access.jwt",
      refreshToken: "refresh-token",
      user: {
        userId: "u1",
        email: "a@b.com",
        kycStatus: "not_started",
        kycTier: "unverified",
        hasPin: false,
      },
    });
  });

  it("throws InvalidOtpError and increments attempt on a wrong code", async () => {
    const { service, userRepo, challengeRepo } = makeDeps();
    userRepo.findByEmail.mockResolvedValueOnce(verified);
    challengeRepo.findActiveByUserAndType.mockResolvedValueOnce({
      id: "c1",
      challengeHash: "hash(999999)",
      attemptCount: 0,
    });
    await expect(
      service.loginVerify({
        email: "a@b.com",
        otp: "123456",
        deviceFingerprint: "fp-1",
      }),
    ).rejects.toBeInstanceOf(InvalidOtpError);
    expect(challengeRepo.incrementAttempt).toHaveBeenCalledWith("c1");
  });

  it("throws InvalidOtpError when attempts are exhausted", async () => {
    const { service, userRepo, challengeRepo } = makeDeps();
    userRepo.findByEmail.mockResolvedValueOnce(verified);
    challengeRepo.findActiveByUserAndType.mockResolvedValueOnce({
      id: "c1",
      challengeHash: "hash(123456)",
      attemptCount: 5,
    });
    await expect(
      service.loginVerify({
        email: "a@b.com",
        otp: "123456",
        deviceFingerprint: "fp-1",
      }),
    ).rejects.toBeInstanceOf(InvalidOtpError);
  });

  it("throws InvalidOtpError when no challenge or user is unverified", async () => {
    const { service, userRepo } = makeDeps();
    userRepo.findByEmail.mockResolvedValueOnce(null);
    await expect(
      service.loginVerify({
        email: "x@b.com",
        otp: "1",
        deviceFingerprint: "fp",
      }),
    ).rejects.toBeInstanceOf(InvalidOtpError);
  });
});
```

> Note: `loadMe` mock returns `hasPin:false`/`not_started` regardless of the `verified` record — the `me` projection comes from `loadMe`, so the asserted `user` uses the `loadMe` mock's values. That's intentional and consistent.

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm --filter @handshake-agent/api test -- auth.service`
Expected: FAIL — `loginRequest`/`loginVerify` undefined.

- [ ] **Step 3: Implement** — add to `AuthService` (import `InvalidOtpError`, `timingSafeEqual` from `node:crypto`, and the contracts login types):

At the top, extend imports:

```ts
import { timingSafeEqual } from "node:crypto";
// add to the contracts type import list: LoginVerifyRequest, LoginVerifyResponse, MeResponse
import {
  InvalidOtpError,
  InvalidVerificationTokenError,
} from "../domain/auth-errors";
```

Add methods:

```ts
  async loginRequest(input: LoginRequest): Promise<LoginRequestResponse> {
    const user = await this.users.findByEmail(input.email);
    // No enumeration: always return otp_sent; only actually send to verified users.
    if (user !== null && user.emailVerifiedAt !== null) {
      const length = this.config.get<number>('auth.otp.length') ?? 6;
      const ttl = this.config.get<number>('auth.otp.ttlSeconds') ?? 300;
      const otp = this.tokens.generateNumericOtp(length);
      await this.challenges.upsert({
        userId: user.id,
        type: 'otp_email',
        challengeHash: this.tokens.hash(otp),
        expiresAt: new Date(Date.now() + ttl * 1000),
      });
      await this.email.sendLoginOtp(user.email, otp);
      if (this.devExpose()) return { status: 'otp_sent', devOtp: otp };
    }
    return { status: 'otp_sent' };
  }

  async loginVerify(
    input: LoginVerifyRequest & { userAgent?: string; ip?: string },
  ): Promise<LoginVerifyResponse> {
    const now = new Date();
    const user = await this.users.findByEmail(input.email);
    if (user === null || user.emailVerifiedAt === null) throw new InvalidOtpError();

    const challenge = await this.challenges.findActiveByUserAndType(user.id, 'otp_email', now);
    const maxAttempts = this.config.get<number>('auth.otp.maxAttempts') ?? 5;
    if (challenge === null || challenge.attemptCount >= maxAttempts) {
      throw new InvalidOtpError();
    }

    if (!this.constantTimeEquals(this.tokens.hash(input.otp), challenge.challengeHash)) {
      await this.challenges.incrementAttempt(challenge.id);
      throw new InvalidOtpError();
    }

    await this.challenges.consume(challenge.id, now);
    const { deviceId } = await this.users.bindDevice({
      userId: user.id,
      fingerprint: input.deviceFingerprint,
      userAgent: input.userAgent,
      ip: input.ip,
    });

    const accessToken = this.tokens.signAccessToken(user.id);
    const refreshToken = this.tokens.generateOpaqueToken();
    const refreshTtl = this.config.get<number>('auth.jwt.refreshTtlSeconds') ?? 2592000;
    await this.sessions.create({
      userId: user.id,
      deviceId,
      accessTokenHash: this.tokens.hash(accessToken),
      refreshTokenHash: this.tokens.hash(refreshToken),
      expiresAt: new Date(Date.now() + refreshTtl * 1000),
    });

    const me = await this.users.loadMe(user.id);
    return {
      accessToken,
      refreshToken,
      user: me as MeResponse,
    };
  }

  private constantTimeEquals(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
  }
```

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm --filter @handshake-agent/api test -- auth.service`
Expected: PASS (login suites green; earlier suites still green).

- [ ] **Step 5: Commit**

```bash
git add api/src/modules/auth/application/auth.service.ts api/src/modules/auth/application/auth.service.spec.ts
git commit -m "feat(api): add AuthService email-OTP login (request + verify)"
```

---

### Task 11: AuthService — refresh + logout + me

**Files:**

- Modify: `api/src/modules/auth/application/auth.service.ts` (add `refresh`, `logout`, `me`)
- Modify: `api/src/modules/auth/application/auth.service.spec.ts` (add suites)

**Interfaces:**

- Produces: `AuthService.refresh`, `AuthService.logout`, `AuthService.me` (canonical signatures).

- [ ] **Step 1: Add failing tests:**

```ts
import { InvalidRefreshTokenError } from "../domain/auth-errors";

describe("AuthService.refresh", () => {
  it("rotates a valid refresh token and returns a new pair", async () => {
    const { service, sessionRepo, tokenService } = makeDeps();
    sessionRepo.findActiveByRefreshHash.mockResolvedValueOnce({
      id: "s1",
      userId: "u1",
      deviceId: "d1",
    });
    tokenService.signAccessToken.mockReturnValueOnce("new.access");
    tokenService.generateOpaqueToken.mockReturnValueOnce("new.refresh");
    const res = await service.refresh({ refreshToken: "old.refresh" });
    expect(sessionRepo.findActiveByRefreshHash).toHaveBeenCalledWith(
      "hash(old.refresh)",
      expect.any(Date),
    );
    expect(sessionRepo.rotate).toHaveBeenCalledWith(
      "s1",
      expect.objectContaining({
        accessTokenHash: "hash(new.access)",
        refreshTokenHash: "hash(new.refresh)",
      }),
    );
    expect(res).toEqual({
      accessToken: "new.access",
      refreshToken: "new.refresh",
    });
  });

  it("throws InvalidRefreshTokenError when the token is unknown", async () => {
    const { service } = makeDeps();
    await expect(
      service.refresh({ refreshToken: "nope" }),
    ).rejects.toBeInstanceOf(InvalidRefreshTokenError);
  });
});

describe("AuthService.logout + me", () => {
  it("logout revokes the session", async () => {
    const { service, sessionRepo } = makeDeps();
    await service.logout("s1");
    expect(sessionRepo.revoke).toHaveBeenCalledWith("s1", expect.any(Date));
  });

  it("me returns the projection", async () => {
    const { service } = makeDeps();
    expect(await service.me("u1")).toEqual({
      userId: "u1",
      email: "a@b.com",
      kycStatus: "not_started",
      kycTier: "unverified",
      hasPin: false,
    });
  });

  it("me throws when the user is missing", async () => {
    const { service, userRepo } = makeDeps();
    userRepo.loadMe.mockResolvedValueOnce(null);
    await expect(service.me("ghost")).rejects.toBeInstanceOf(
      InvalidRefreshTokenError,
    );
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm --filter @handshake-agent/api test -- auth.service`
Expected: FAIL — `refresh`/`logout`/`me` undefined.

- [ ] **Step 3: Implement** — add to `AuthService` (extend imports with `RefreshRequest`, `RefreshResponse`, `MeResponse`, and `InvalidRefreshTokenError`):

```ts
  async refresh(input: RefreshRequest): Promise<RefreshResponse> {
    const now = new Date();
    const session = await this.sessions.findActiveByRefreshHash(
      this.tokens.hash(input.refreshToken),
      now,
    );
    if (session === null) throw new InvalidRefreshTokenError();

    const accessToken = this.tokens.signAccessToken(session.userId);
    const refreshToken = this.tokens.generateOpaqueToken();
    await this.sessions.rotate(session.id, {
      accessTokenHash: this.tokens.hash(accessToken),
      refreshTokenHash: this.tokens.hash(refreshToken),
      now,
    });
    return { accessToken, refreshToken };
  }

  async logout(sessionId: string): Promise<void> {
    await this.sessions.revoke(sessionId, new Date());
  }

  async me(userId: string): Promise<MeResponse> {
    const me = await this.users.loadMe(userId);
    if (me === null) throw new InvalidRefreshTokenError();
    return me;
  }
```

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm --filter @handshake-agent/api test -- auth.service`
Expected: PASS (all AuthService suites green).

- [ ] **Step 5: Commit**

```bash
git add api/src/modules/auth/application/auth.service.ts api/src/modules/auth/application/auth.service.spec.ts
git commit -m "feat(api): add AuthService refresh + logout + me"
```

---

### Task 12: JwtAuthGuard + @CurrentUser decorator

**Files:**

- Create: `api/src/modules/auth/presentation/jwt-auth.guard.ts`
- Create: `api/src/modules/auth/presentation/current-user.decorator.ts`
- Test: `api/src/modules/auth/presentation/jwt-auth.guard.spec.ts`

**Interfaces:**

- Produces: `JwtAuthGuard` (attaches `req.user = { userId, sessionId, deviceId }`); `@CurrentUser()` returns that object; `AuthenticatedUser` type.
- Consumes: `TokenService`, `IAuthSessionRepository` (`AUTH_SESSION_REPOSITORY`).

- [ ] **Step 1: Write the failing test** — `api/src/modules/auth/presentation/jwt-auth.guard.spec.ts`

```ts
import { ExecutionContext, UnauthorizedException } from "@nestjs/common";

import { JwtAuthGuard } from "./jwt-auth.guard";

function ctx(authHeader?: string): {
  context: ExecutionContext;
  req: Record<string, unknown>;
} {
  const req: Record<string, unknown> = {
    headers: authHeader ? { authorization: authHeader } : {},
  };
  const context = {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
  return { context, req };
}

function make(
  overrides: { verify?: () => { sub: string }; session?: unknown } = {},
) {
  const tokens = {
    verifyAccessToken: overrides.verify ?? (() => ({ sub: "u1" })),
    hash: (v: string) => `hash(${v})`,
  };
  const sessions = {
    findActiveByAccessHash: jest.fn(
      async () =>
        overrides.session ?? { id: "s1", userId: "u1", deviceId: "d1" },
    ),
  };
  return {
    guard: new JwtAuthGuard(tokens as never, sessions as never),
    sessions,
  };
}

describe("JwtAuthGuard", () => {
  it("attaches req.user for a valid token with an active session", async () => {
    const { guard, sessions } = make();
    const { context, req } = ctx("Bearer good.token");
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(sessions.findActiveByAccessHash).toHaveBeenCalledWith(
      "hash(good.token)",
      expect.any(Date),
    );
    expect(req.user).toEqual({ userId: "u1", sessionId: "s1", deviceId: "d1" });
  });

  it("rejects a missing Authorization header", async () => {
    const { guard } = make();
    await expect(guard.canActivate(ctx().context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it("rejects when JWT verification throws", async () => {
    const { guard } = make({
      verify: () => {
        throw new Error("bad");
      },
    });
    await expect(
      guard.canActivate(ctx("Bearer x").context),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("rejects when no active session matches (revoked/expired)", async () => {
    const { guard } = make({ session: null });
    await expect(
      guard.canActivate(ctx("Bearer x").context),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("rejects when the session userId does not match the token sub", async () => {
    const { guard } = make({
      session: { id: "s1", userId: "OTHER", deviceId: "d1" },
    });
    await expect(
      guard.canActivate(ctx("Bearer x").context),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm --filter @handshake-agent/api test -- jwt-auth.guard`
Expected: FAIL — guard not found.

- [ ] **Step 3: Write the guard** — `api/src/modules/auth/presentation/jwt-auth.guard.ts`

```ts
import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";

import {
  AUTH_SESSION_REPOSITORY,
  type IAuthSessionRepository,
} from "../application/ports/auth-session.repository.port";
import { TokenService } from "../application/token.service";

export interface AuthenticatedUser {
  userId: string;
  sessionId: string;
  deviceId: string | null;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly tokens: TokenService,
    @Inject(AUTH_SESSION_REPOSITORY)
    private readonly sessions: IAuthSessionRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<{
      headers: Record<string, string | undefined>;
      user?: AuthenticatedUser;
    }>();

    const header = req.headers.authorization;
    if (!header || !header.startsWith("Bearer ")) {
      throw new UnauthorizedException("Missing bearer token");
    }
    const token = header.slice("Bearer ".length).trim();

    let sub: string;
    try {
      ({ sub } = this.tokens.verifyAccessToken(token));
    } catch {
      throw new UnauthorizedException("Invalid or expired token");
    }

    const session = await this.sessions.findActiveByAccessHash(
      this.tokens.hash(token),
      new Date(),
    );
    if (session === null || session.userId !== sub) {
      throw new UnauthorizedException("Session is not active");
    }

    req.user = {
      userId: session.userId,
      sessionId: session.id,
      deviceId: session.deviceId,
    };
    return true;
  }
}
```

- [ ] **Step 4: Write the decorator** — `api/src/modules/auth/presentation/current-user.decorator.ts`

```ts
import { createParamDecorator, ExecutionContext } from "@nestjs/common";

import type { AuthenticatedUser } from "./jwt-auth.guard";

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
    const req = ctx.switchToHttp().getRequest<{ user: AuthenticatedUser }>();
    return req.user;
  },
);
```

- [ ] **Step 5: Run tests to verify pass**

Run: `pnpm --filter @handshake-agent/api test -- jwt-auth.guard`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add api/src/modules/auth/presentation/jwt-auth.guard.ts api/src/modules/auth/presentation/current-user.decorator.ts api/src/modules/auth/presentation/jwt-auth.guard.spec.ts
git commit -m "feat(api): add JwtAuthGuard + CurrentUser decorator"
```

---

### Task 13: DTOs, controller, module wiring + e2e

**Files:**

- Create: `api/src/modules/auth/presentation/dto/auth.dto.ts`
- Create: `api/src/modules/auth/presentation/auth.controller.ts`
- Create: `api/src/modules/auth/auth.module.ts`
- Modify: `api/src/app.module.ts` (import `WebAuthModule`)
- Test: `api/test/auth.e2e-spec.ts`

**Interfaces:**

- Consumes: everything above. The controller maps domain errors → HTTP and uses `JwtAuthGuard` on `/auth/me` and `/auth/logout`.

> **Naming:** the new module is `WebAuthModule` (class) to avoid confusion with the existing `core/auth/auth.module.ts` `AuthModule` (PIN/step-up). File: `api/src/modules/auth/auth.module.ts`.

- [ ] **Step 1: Write the DTOs** — `api/src/modules/auth/presentation/dto/auth.dto.ts`

```ts
import { createZodDto } from "nestjs-zod";
import {
  LoginRequestSchema,
  LoginVerifyRequestSchema,
  RefreshRequestSchema,
  SignupRequestSchema,
  VerifyEmailRequestSchema,
} from "@handshake-agent/contracts";

export class SignupDto extends createZodDto(SignupRequestSchema) {}
export class VerifyEmailDto extends createZodDto(VerifyEmailRequestSchema) {}
export class LoginDto extends createZodDto(LoginRequestSchema) {}
export class LoginVerifyDto extends createZodDto(LoginVerifyRequestSchema) {}
export class RefreshDto extends createZodDto(RefreshRequestSchema) {}
```

- [ ] **Step 2: Write the controller** — `api/src/modules/auth/presentation/auth.controller.ts`

```ts
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import { ThrottlerGuard } from "@nestjs/throttler";

import type {
  LoginRequestResponse,
  LoginVerifyResponse,
  MeResponse,
  RefreshResponse,
  SignupResponse,
  VerifyEmailResponse,
} from "@handshake-agent/contracts";

import { AuthService } from "../application/auth.service";
import {
  InvalidOtpError,
  InvalidRefreshTokenError,
  InvalidVerificationTokenError,
  TokenSigningDisabledError,
} from "../domain/auth-errors";
import { CurrentUser } from "./current-user.decorator";
import { JwtAuthGuard, type AuthenticatedUser } from "./jwt-auth.guard";
import {
  LoginDto,
  LoginVerifyDto,
  RefreshDto,
  SignupDto,
  VerifyEmailDto,
} from "./dto/auth.dto";

@Controller("auth")
@UseGuards(ThrottlerGuard)
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post("signup")
  @HttpCode(HttpStatus.ACCEPTED)
  async signup(@Body() dto: SignupDto): Promise<SignupResponse> {
    return this.guard(() => this.auth.signup(dto));
  }

  @Post("verify-email")
  @HttpCode(HttpStatus.OK)
  async verifyEmail(@Body() dto: VerifyEmailDto): Promise<VerifyEmailResponse> {
    return this.guard(() => this.auth.verifyEmail(dto));
  }

  @Post("login/request")
  @HttpCode(HttpStatus.ACCEPTED)
  async loginRequest(@Body() dto: LoginDto): Promise<LoginRequestResponse> {
    return this.guard(() => this.auth.loginRequest(dto));
  }

  @Post("login/verify")
  @HttpCode(HttpStatus.OK)
  async loginVerify(@Body() dto: LoginVerifyDto): Promise<LoginVerifyResponse> {
    return this.guard(() => this.auth.loginVerify(dto));
  }

  @Post("refresh")
  @HttpCode(HttpStatus.OK)
  async refresh(@Body() dto: RefreshDto): Promise<RefreshResponse> {
    return this.guard(() => this.auth.refresh(dto));
  }

  @Post("logout")
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  async logout(@CurrentUser() user: AuthenticatedUser): Promise<void> {
    await this.auth.logout(user.sessionId);
  }

  @Get("me")
  @UseGuards(JwtAuthGuard)
  async me(@CurrentUser() user: AuthenticatedUser): Promise<MeResponse> {
    return this.guard(() => this.auth.me(user.userId));
  }

  /** Maps auth domain errors to HTTP; rethrows the rest. */
  private async guard<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (
        err instanceof InvalidVerificationTokenError ||
        err instanceof InvalidOtpError ||
        err instanceof InvalidRefreshTokenError
      ) {
        // Generic: never reveal which factor failed.
        throw new UnauthorizedException(err.message);
      }
      if (err instanceof TokenSigningDisabledError) {
        throw new BadRequestException("Auth is not configured");
      }
      throw err;
    }
  }
}
```

- [ ] **Step 3: Write the module** — `api/src/modules/auth/auth.module.ts`

```ts
import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";

import { PrismaModule } from "../../core/prisma/prisma.module";
import { AuthService } from "./application/auth.service";
import { TokenService } from "./application/token.service";
import { AUTH_CHALLENGE_REPOSITORY } from "./application/ports/auth-challenge.repository.port";
import { AUTH_SESSION_REPOSITORY } from "./application/ports/auth-session.repository.port";
import { AUTH_USER_REPOSITORY } from "./application/ports/auth-user.repository.port";
import { EMAIL_PROVIDER } from "./application/ports/email-provider.port";
import { AuthChallengePrismaRepository } from "./infrastructure/auth-challenge.prisma.repository";
import { AuthSessionPrismaRepository } from "./infrastructure/auth-session.prisma.repository";
import { AuthUserPrismaRepository } from "./infrastructure/auth-user.prisma.repository";
import { MockEmailProvider } from "./infrastructure/mock-email.provider";
import { AuthController } from "./presentation/auth.controller";
import { JwtAuthGuard } from "./presentation/jwt-auth.guard";

@Module({
  imports: [PrismaModule, JwtModule.register({})],
  controllers: [AuthController],
  providers: [
    AuthService,
    TokenService,
    JwtAuthGuard,
    { provide: EMAIL_PROVIDER, useClass: MockEmailProvider },
    {
      provide: AUTH_CHALLENGE_REPOSITORY,
      useClass: AuthChallengePrismaRepository,
    },
    { provide: AUTH_USER_REPOSITORY, useClass: AuthUserPrismaRepository },
    { provide: AUTH_SESSION_REPOSITORY, useClass: AuthSessionPrismaRepository },
  ],
  // Exported so later modules (web chat/exec) can apply JwtAuthGuard + resolve sessions.
  exports: [JwtAuthGuard, TokenService, AUTH_SESSION_REPOSITORY],
})
export class WebAuthModule {}
```

- [ ] **Step 4: Register in the composition root** — in `api/src/app.module.ts`, add the import and place `WebAuthModule` in the `imports` array (after `IdentityModule`):

```ts
import { WebAuthModule } from './modules/auth/auth.module';
// ...
    IdentityModule,
    WebAuthModule,
```

- [ ] **Step 5: Write the e2e** — `api/test/auth.e2e-spec.ts`

Follow the existing e2e harness pattern (`api/test/jest-e2e.json`, supertest, Testcontainers Postgres bootstrapped in the e2e setup; copy the bootstrap from an existing `*.e2e-spec.ts`). Set `AUTH_DEV_EXPOSE_OTP=true` and a non-empty `JWT_SECRET` in the test env so the codes are returned. Assert the full flow:

```ts
it("signup → verify-email → login request → login verify → me → refresh → logout", async () => {
  const email = `e2e_${Date.now()}@test.com`;

  // 1. signup returns devToken (dev-expose on)
  const signup = await request(app.getHttpServer())
    .post("/auth/signup")
    .send({ email, phone: "+2348019999999" })
    .expect(202);
  expect(signup.body.status).toBe("pending_verification");
  const token = signup.body.devToken as string;
  expect(token).toBeDefined();

  // 2. verify email
  await request(app.getHttpServer())
    .post("/auth/verify-email")
    .send({ token })
    .expect(200)
    .expect((r) => expect(r.body).toEqual({ verified: true }));

  // 3. login request returns devOtp
  const lr = await request(app.getHttpServer())
    .post("/auth/login/request")
    .send({ email })
    .expect(202);
  const otp = lr.body.devOtp as string;
  expect(otp).toMatch(/^[0-9]{6}$/);

  // 4. login verify returns tokens
  const lv = await request(app.getHttpServer())
    .post("/auth/login/verify")
    .send({ email, otp, deviceFingerprint: "e2e-fingerprint-123" })
    .expect(200);
  expect(lv.body.accessToken).toBeDefined();
  expect(lv.body.refreshToken).toBeDefined();
  expect(lv.body.user.email).toBe(email);
  const { accessToken, refreshToken } = lv.body;

  // 5. /auth/me with the access token
  await request(app.getHttpServer())
    .get("/auth/me")
    .set("Authorization", `Bearer ${accessToken}`)
    .expect(200)
    .expect((r) => expect(r.body.email).toBe(email));

  // 6. /auth/me without a token → 401
  await request(app.getHttpServer()).get("/auth/me").expect(401);

  // 7. refresh rotates the pair
  const rf = await request(app.getHttpServer())
    .post("/auth/refresh")
    .send({ refreshToken })
    .expect(200);
  expect(rf.body.accessToken).toBeDefined();
  expect(rf.body.refreshToken).not.toBe(refreshToken);

  // 8. old refresh token no longer works
  await request(app.getHttpServer())
    .post("/auth/refresh")
    .send({ refreshToken })
    .expect(401);

  // 9. logout revokes; the (new) access token then fails /me
  await request(app.getHttpServer())
    .post("/auth/logout")
    .set("Authorization", `Bearer ${rf.body.accessToken}`)
    .expect(204);
  await request(app.getHttpServer())
    .get("/auth/me")
    .set("Authorization", `Bearer ${rf.body.accessToken}`)
    .expect(401);
});

it("wrong OTP is rejected with 401", async () => {
  const email = `e2e_bad_${Date.now()}@test.com`;
  const s = await request(app.getHttpServer())
    .post("/auth/signup")
    .send({ email, phone: "+2348018888888" })
    .expect(202);
  await request(app.getHttpServer())
    .post("/auth/verify-email")
    .send({ token: s.body.devToken })
    .expect(200);
  await request(app.getHttpServer())
    .post("/auth/login/request")
    .send({ email })
    .expect(202);
  await request(app.getHttpServer())
    .post("/auth/login/verify")
    .send({ email, otp: "000000", deviceFingerprint: "fp-e2e-xyz" })
    .expect(401);
});
```

- [ ] **Step 6: Run the e2e**

Run: `pnpm --filter @handshake-agent/api test:e2e -- auth`
Expected: PASS (full flow + wrong-OTP).

- [ ] **Step 7: Full milestone gate (per the SDD-gate memory — run the WHOLE suite, not just auth)**

Run:

```bash
pnpm --filter @handshake-agent/api typecheck
pnpm --filter @handshake-agent/api test
pnpm --filter @handshake-agent/api test:e2e
pnpm depcruise
```

Expected: typecheck clean; **all** unit + e2e suites green (a new injectable/module must not break `AppModule` boot); depcruise reports no boundary violations (auth `application` must not import `infrastructure`/prisma client; only `infrastructure` imports `PrismaService`).

- [ ] **Step 8: Commit**

```bash
git add api/src/modules/auth/presentation api/src/modules/auth/auth.module.ts api/src/app.module.ts api/test/auth.e2e-spec.ts
git commit -m "feat(api): wire web auth controller + module + e2e"
```

---

## Self-review (completed against the spec §4)

- **Spec coverage:** signup (Task 9), verify-email (9), login request+verify (10), refresh+logout+me (11), JWT guard + CurrentUser (12), `@nestjs/jwt`/env/config/CORS (2), `User.email`/`emailVerifiedAt`/`AuthChallenge` migration (3), email/OTP mock (4), session lifecycle on the existing `Session` table (8), pending-WhatsApp-CI link hook (7, `createSignup`), contracts (1), controller+module+e2e (13). All §4.1/§4.2 endpoints present. KYC `POST /kyc/submit` is **Phase 2** (not this plan). Frontend wiring is the **web-auth-frontend** plan.
- **Type consistency:** `TokenService.hash`/`signAccessToken`/`generateOpaqueToken`/`generateNumericOtp`/`verifyAccessToken` used identically across Tasks 5/9/10/11/12. Repo port method names (`upsert`, `findActiveByHashAndType`, `findActiveByUserAndType`, `incrementAttempt`, `consume`; `createSignup`, `findByEmail`, `markEmailVerified`, `bindDevice`, `loadMe`; `create`, `findActiveByAccessHash`, `findActiveByRefreshHash`, `rotate`, `revoke`) match between port (6/7/8), service (9/10/11), guard (12), and mocks. DI tokens (`EMAIL_PROVIDER`, `AUTH_CHALLENGE_REPOSITORY`, `AUTH_USER_REPOSITORY`, `AUTH_SESSION_REPOSITORY`) match between ports, service `@Inject`, and module bindings (13).
- **No placeholders:** every code step shows complete code; the only "copy the harness" notes (Testcontainers setup in Tasks 6/7/8 and the e2e in 13) point at concrete existing files to mirror, with the full assertion bodies provided.
- **Invariants:** agent/engine untouched; secrets hashed; phone is a pending routing CI; fail-closed JWT; `application` never imports prisma (repos are `infrastructure`).
