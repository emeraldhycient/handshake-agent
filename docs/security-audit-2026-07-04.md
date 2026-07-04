# Security Audit — Pre-Launch Hardening Pass

- **Date:** 2026-07-04
- **Scope:** `handshake-agent` monorepo — `api/` (NestJS), `web/` + `web-admin/` (Next.js), `packages/contracts/`
- **Type:** Authorized, **defensive** static review of our own code (hardening before launch). Static analysis + code-level fixes only — **no** attacks on live infrastructure, **no** destructive tooling, **no** detection-evasion.
- **Branch:** `security/hardening-pass` (off `origin/main` @ `582c1f0`)
- **Method:** dimensions → find → **adversarially verify each finding (kill false positives)** → fix with TDD → re-verify. A multi-agent find/verify workflow (8 code dimensions, 17 agents) was reconciled against an independent manual read of every crown-jewel path (auth guards, JWT/token services, provider webhooks, PIN/step-up, the execution engine, env schema, IDOR surface, injection sinks, client token storage).

> Note: the task referenced `docs/go-readiness-program.md` (track "B. Cybersecurity"); that file does not exist in the repo at this commit. This audit proceeds against the nine dimensions specified directly in the engagement brief.

---

## 1. Executive summary

The codebase already demonstrates **strong, security-aware engineering**: provider webhooks verify HMAC signatures with `timingSafeEqual` and are **fail-closed** on an empty/missing secret; the admin RBAC `PermissionGuard` is **default-deny**; the user `JwtAuthGuard` is **session-bound** (token hash must match an active DB session); env validation **fails boot** on missing critical secrets; NIN/BVN are encrypted at rest; IDOR surfaces are consistently `userId`-scoped; there is **no** raw-SQL/`eval`/command-injection sink (the one `$executeRawUnsafe` interpolates a computed `bigint`, not user input).

Against that baseline, this pass found and fixed **6 code findings** (2 High, 3 Medium, 1 Low) plus **1 dependency** bump. The two High findings are the highest-leverage: a request-logger that recorded bearer tokens, and a PIN-lockout race that weakened the money-movement brute-force gate.

| #      | Severity | Dimension          | Finding                                                                                                      | Status    |
| ------ | -------- | ------------------ | ------------------------------------------------------------------------------------------------------------ | --------- |
| **H1** | High     | Secrets / logging  | Request logger recorded `Authorization` bearer tokens (user **and** admin JWTs) on every request             | ✅ Fixed  |
| **H2** | High     | PIN / step-up      | PIN-lockout counter was a non-atomic read-modify-write (TOCTOU) → concurrent guesses bypass the lockout      | ✅ Fixed  |
| **M1** | Medium   | Rate-limiting      | No global `ThrottlerGuard` — most endpoints (incl. money-path `execute`) were unthrottled                    | ✅ Fixed  |
| **M2** | Medium   | AuthN              | Admin console login had no account lockout, only a loose IP-keyed 30/min throttle                            | ✅ Fixed  |
| **M3** | Medium   | Web / clickjacking | Admin console (and web) shipped no HTTP security headers (CSP, `X-Frame-Options`, `nosniff`)                 | ✅ Fixed  |
| **L1** | Low      | AuthZ / config     | `DIRECTIVE_SIGNING_KEY` had no production boot guard → forgeable WhatsApp flow-token → beneficiary injection | ✅ Fixed  |
| **D1** | (dep)    | Dependencies       | `multer` HIGH advisory on the file-upload path                                                               | ✅ Bumped |

No existing funds-safety guard was weakened to land any fix (§3.1 model-proposes/engine-disposes and §3.3 server-side gating are preserved throughout).

---

## 2. Findings

### H1 — Request logger logged `Authorization` bearer tokens (no redaction)

- **Severity:** High · **Category:** `secrets_pii` · **Location:** `api/src/app.module.ts` (pino logger config)
- **Description:** The global logger was configured via `LoggerModule.forRoot({ pinoHttp: { transport … } })` with **no `redact` option and no custom request serializer**. `nestjs-pino` wraps `pino-http`, whose `autoLogging` defaults to **on** and whose default request serializer copies the **entire header set** into every request log line. Authentication is bearer-token based — `JwtAuthGuard` reads `req.headers.authorization` for user sessions and the admin console sends its session JWT the same way — so **every request logged a live, replayable token** (user and admin). Sessions are looked up by `sha256(token)`, so a logged raw bearer token is sufficient to impersonate the user/operator until expiry.
- **Exploit scenario:** Anyone with read access to application logs (log aggregation, a leaked log file, an over-broad support role) harvests `Authorization: Bearer <jwt>` values and replays them against the API to act as the victim user — or, for admin JWTs, as an operator with money/compliance authority.
- **Remediation (this PR):** Redaction added to the pino config (extracted to a unit-tested factory) censoring `req.headers.authorization`, `req.headers.cookie`, `req.headers["x-api-key"]`, `req.headers["x-hub-signature-256"]`, `req.headers["x-blockradar-signature"]`, `req.headers["verif-hash"]`, and `res.headers["set-cookie"]` → `[REDACTED]`.

### H2 — PIN-lockout counter is a non-atomic read-modify-write (TOCTOU)

- **Severity:** High (funds-safety) · **Category:** `pin_stepup` · **Location:** `api/src/core/auth/pin.service.ts`, `api/src/core/auth/infrastructure/pin.prisma.repository.ts`
- **Description:** `PinService.verifyPin` read `pinFailureCount`, ran the scrypt comparison, then wrote a **service-computed absolute count** via `recordFailure(userId, count, lockedUntil)` → `prisma.user.update({ data: { pinFailureCount: count } })`. Because the write **sets** rather than atomically increments, `N` concurrent wrong-PIN attempts all read `count = 0`, all write `1`, and the 5-attempt lockout **never advances**. This is the only durable brute-force gate on the money path: the execution engine verifies the PIN **before** consuming the single-use directive (intentional, so a mistyped PIN doesn't burn the directive — `execution.service.ts` `executeBuy/Sell/Send/Swap`), so **one** valid directive+nonce authorizes **unlimited** PIN guesses. The endpoint that drives this (`POST /chat/proposals/:id/execute`) was also unthrottled (see M1).
- **Exploit scenario:** An attacker holding a victim's session token (but not their PIN — exactly the case step-up PIN defends, §3.4) fires a burst of concurrent `execute` requests, each with a different 4–6 digit PIN guess. The non-atomic counter keeps the lockout from tripping, so the full keyspace is guessable, and a correct guess moves the victim's funds.
- **Remediation (this PR):** The failure counter is now advanced by a **single atomic SQL statement** (`registerFailedAttempt`) that runs **before** the scrypt compare: in one `UPDATE … CASE … RETURNING` it either starts a fresh window (when the prior lock has expired → count = 1, lock cleared), increments (normal), or leaves the count untouched (still actively locked). `verifyPin` then rejects a concurrently-set lock, and **skips the comparison and returns locked** once the returned count exceeds `maxAttempts`. Postgres serialises the row update, so a simultaneous burst gets strictly increasing counts and at most `maxAttempts` reach the compare. Constant-time compare, scrypt parameters, error types, and legitimate re-entry after the window are preserved. (An earlier iteration reset the counter in a _separate_ statement before the increment — the adversarial fix-review (§6.1) caught that this reintroduced the bypass on the just-expired-window path; folding the reset into the one statement closes it, and a concurrency test starting from the expired-window state guards against regression.)

### M1 — No global `ThrottlerGuard` (rate-limiting was opt-in per controller)

- **Severity:** Medium · **Category:** `ratelimit` · **Location:** `api/src/app.module.ts`, `api/src/modules/chat/presentation/proposal.controller.ts`
- **Description:** `ThrottlerModule` was registered but `ThrottlerGuard` was **not** an `APP_GUARD`. Only three controllers opted in (`auth`, `admin-auth`, `kyc`). Every other route — including the money-movement `execute` endpoint, wallet, beneficiary, profile, quotes, and chat — had **no** rate limit. This is both a standalone abuse/DoS surface and part of the H2 brute-force chain.
- **Remediation (this PR):** `ThrottlerGuard` registered globally via `APP_GUARD` (an `EnvAwareThrottlerGuard` that is a no-op only under `NODE_ENV=test`, matching the app's existing test-env special-casing, so production limits are strict while suites stay deterministic); a **strict** `@Throttle` added to the money-movement `execute` endpoint. The three controllers that previously opted in with a class-level `@UseGuards(ThrottlerGuard)` (auth, kyc, admin-auth) had it **removed** — with both the global and the per-controller guard active they double-counted each request against the same throttle key, silently halving those limits (caught by the adversarial fix-review (§6.1)). Their `@Throttle` limits are now enforced exactly once by the global guard.

### M2 — Admin console login had no account lockout

- **Severity:** Medium · **Category:** `authz` / brute-force · **Location:** `api/src/modules/admin/application/admin-auth.service.ts`, `api/src/modules/admin/presentation/admin-auth.controller.ts`
- **Description:** `POST /admin/auth/login` (password + TOTP for the RBAC console over funds/config/compliance) was protected only by the shared IP-keyed `auth` throttle (30/min) with **no per-account failure lockout**. That is ~43k guesses/day/IP and trivially multiplied across a proxy pool, with no account ever locking — a weak control for an unauthenticated credential-stuffing / password-spray target on the most privileged surface.
- **Remediation (this PR):** A per-account failure lockout was added to `AdminAuthService.login` using the **same single-atomic-statement** counter as H2 (`registerFailedLogin`, increment-before-verify with the expired-window reset folded in — see §6.1 for why this matters), plus a tightened login throttle and config-driven limits (`admin.login.maxAttempts` / `lockoutMinutes`). Passwords remain argon2id-hashed; MFA and the timing-safe dummy-verify for unknown emails are unchanged.

### M3 — No HTTP security headers (clickjacking / missing defense-in-depth)

- **Severity:** Medium · **Category:** `web` · **Location:** `web-admin/next.config.ts`, `web/next.config.ts`
- **Description:** Neither Next app set security headers. The **admin console** (privileged operator surface) had no CSP, no `X-Frame-Options`/`frame-ancestors` (clickjacking), and no `X-Content-Type-Options`.
- **Remediation (this PR):** An async `headers()` was added to both configs. **web-admin** gets a strict posture: a restrictive CSP with `frame-ancestors 'none'`, plus `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Strict-Transport-Security`, and a minimal `Permissions-Policy`. **web** gets the same clickjacking/nosniff/referrer/HSTS baseline (a strict CSP was deliberately **not** forced on the user app to avoid breaking richer content — its CSP finding was a verified false positive; see §4).

### L1 — `DIRECTIVE_SIGNING_KEY` had no production boot guard (forgeable flow-token)

- **Severity:** Low (misconfiguration-gated; defense-in-depth) · **Category:** `authz` · **Location:** `api/src/core/config/env.schema.ts`, `api/src/modules/whatsapp/application/flow-token.ts`
- **Description:** `DIRECTIVE_SIGNING_KEY` defaulted to `''` and — unlike its peers `RECEIPT_SIGNING_KEY`, `STATEMENT_SIGNING_KEY`, `KYC_ENCRYPTION_KEY` — was **not** covered by any `superRefine` boot guard, so production could boot with an empty key. That key is the sole authenticator of the **stateless** WhatsApp `flow_token`; with an empty key `verifyFlowToken` accepts a forged token binding an **arbitrary victim `userId`**, and `handleDataExchange`'s `beneficiary_add` path persists an attacker-controlled bank/crypto beneficiary for that user (a withdrawal-destination seed) with no directive/nonce/PIN. Reachability is gated by the Flow's RSA/AES E2E envelope and the misconfiguration itself; the proposal-execute path is independently protected by the DB-backed directive+nonce — hence Low, but a clear fail-open inconsistency worth closing.
- **Remediation (this PR):** A `superRefine` guard now rejects boot when `NODE_ENV=production` and `DIRECTIVE_SIGNING_KEY` is empty (mirroring `STATEMENT_SIGNING_KEY`), and `signFlowToken`/`verifyFlowToken` now **throw** on an empty key (fail-closed at use-site, matching `TokenService`/`DirectiveService`), so the guarantee no longer depends solely on env validation.

---

## 3. Dependency audit (`pnpm audit`)

7 advisories (1 high, 6 moderate). Most are **dev/build-time transitive** (see table); the one **runtime** dependency worth bumping is `multer`.

| Package             | Sev        | Path                                      | Runtime?                     | Action                                                                    |
| ------------------- | ---------- | ----------------------------------------- | ---------------------------- | ------------------------------------------------------------------------- |
| `multer`            | High + Mod | `api > @nestjs/platform-express > multer` | **Yes** (file upload)        | **Bumped to ≥2.2.0** via pnpm override                                    |
| `postcss`           | Mod        | `web > next > postcss`                    | Build-time                   | Override where safe (XSS in CSS stringify; not user-reachable at runtime) |
| `file-type`         | Mod (×2)   | `api > @swc/cli > … > file-type`          | Dev-only (`@swc/cli`)        | Low priority; dev toolchain                                               |
| `@hono/node-server` | Mod        | `api > prisma > @prisma/dev > …`          | Dev-only (prisma dev server) | Low priority                                                              |
| `js-yaml`           | Mod        | `api > jest > … > js-yaml`                | Test-only                    | Low priority                                                              |

The `multer` advisories are DoS-class (deeply-nested field names / incomplete cleanup of aborted uploads) but sit on a **production** request path (voice/media upload), so bumping is worthwhile.

---

## 4. Considered and rejected (false positives killed during verification)

Rigor note — these were raised (by finders or the manual pass) and **refuted** against the actual code:

- **Blockradar webhook HMAC forgeable with empty key** — `BLOCKRADAR_API_KEY` is `z.string().min(1)` (required); boot fails before this is reachable. The `?? ''` fallback is unreachable in a booted app.
- **Flutterwave / WhatsApp webhook forgery on empty secret** — both are **fail-closed**: `FlutterwaveProvider.verifyWebhookSignature` returns `false` when the secret is empty; `WhatsAppSignatureGuard` rejects in production when `WHATSAPP_APP_SECRET` is unset.
- **SQL injection via `$executeRawUnsafe`** (`advisory-lock.ts`) — the interpolated `key` is a computed FNV-1a **`bigint`** (pure digits), never user input. Safe.
- **Stored XSS via `dangerouslySetInnerHTML={{ __html: qrSvg }}`** (admin MFA dialog) — `qrSvg` is generated server-side by the `qrcode` library (`QRCode.toString(uri, { type: 'svg' })`); the QR matrix renders as `<path>` elements, not attacker text. Safe.
- **Beneficiary IDOR** — every user-facing beneficiary query is `userId`-scoped; the unscoped `findById` is only called by admin-gated services.
- **JWT algorithm confusion** — tokens are signed/verified with a **symmetric** secret (HS256); RS→HS confusion is not possible and `alg:none` is rejected when a secret is supplied. (Pinning `algorithms: ['HS256']` explicitly is noted as optional hardening in §5.)
- **"execute endpoint unthrottled" as its own High** — real, but subsumed by M1 (the fix is the same global guard); not double-counted.
- **CSP on the user `web/` app (for the localStorage refresh token)** — CSP is not the correct/whole mitigation and risks breaking the app; folded into M3's baseline headers instead. See residual R1.

---

## 5. Residual risks & recommended follow-ups (not fixed in this PR)

- **R1 — Refresh token in `localStorage` (web) / admin token in `sessionStorage` (web-admin).** Access tokens are kept in memory (good), but the refresh token is XSS-exfiltratable. No XSS sink was found, and this is a common tradeoff, but the stronger posture is an **HttpOnly, Secure, SameSite** refresh cookie. Track as hardening.
- **R2 — Beneficiary add has no step-up/PIN.** `beneficiary_add` (and the web add flow) attach a withdrawal destination on session/flow-token identity alone. The code notes "step-up-on-add is a hardening follow-up (Flow E2E + cooling-off provide interim protection)." Recommend PIN/step-up on new-destination add, or a mandatory cooling-off before first send to a new destination.
- **R3 — Pin `algorithms: ['HS256']`** explicitly in `TokenService`/`AdminTokenService` `verify()` (defense-in-depth; currently safe due to the symmetric secret).
- **R4 — Argon2id for the transaction PIN.** `PinService` uses scrypt (documented interim KDF, `TODO(SEC)`); migrate to argon2id to match the admin password hashing.
- **R5 — Mock email provider logs the OTP.** Only active when `RESEND_API_KEY` is unset; ensure production sets a real key so OTPs are never logged (the separate `AUTH_DEV_EXPOSE_OTP` oracle is already prod-guarded).
- **R6 — Remaining dev/build-time dependency advisories** (`file-type`, `@hono/node-server`, `js-yaml`, `postcss`) — schedule routine bumps; none is runtime-reachable.

---

## 6. Verification

All fixes were applied via TDD (a failing test first — several with an explicit RED proof that the concurrency bypass reproduces against the old code), then re-verified independently. Gate results on the merged branch:

| Gate                                           | Result                                                                            |
| ---------------------------------------------- | --------------------------------------------------------------------------------- |
| `api` typecheck (`tsc --noEmit`)               | ✅ clean                                                                          |
| `api` unit tests (jest)                        | ✅ **174 suites / 2270 tests pass**                                               |
| `web` typecheck · tests                        | ✅ clean · **776 pass**                                                           |
| `web-admin` typecheck · tests                  | ✅ clean · **398 pass**                                                           |
| `contracts` typecheck                          | ✅ clean                                                                          |
| `depcruise` (architecture boundaries)          | ✅ **no violations (1549 modules)** — the agent still has **no DB access** (§3.2) |
| ESLint (bare, no `--fix`) on all changed files | ✅ clean                                                                          |
| `pnpm audit` (high)                            | ✅ `multer` HIGH resolved; 5 dev/build/test-only moderates remain (documented §3) |

### 6.1 Adversarial fix-review

Every fix was re-checked by an independent adversarial review pass (one reviewer per fix, reading the actual diff) asking specifically: does it truly close the finding, does it weaken any funds-safety guard, and does it introduce a regression? **None weakens a funds-safety guard.** Four fixes (H1, M2, M3, L1) were confirmed SOLID with only non-blocking minor notes. The review surfaced — and this PR then fixed — two regressions in the first-pass fixes:

- **H2 (critical):** the first PIN fix reset the counter in a _separate_ statement before the atomic increment, leaving a TOCTOU on the just-expired-lockout-window path (an attacker-inducible state). Folded into a single atomic statement + added an expired-window concurrency regression test.
- **M1 (medium):** registering the global throttler while three controllers kept their own `@UseGuards(ThrottlerGuard)` double-counted requests and halved those limits. Removed the redundant per-controller guard.

A second review round (of the H2 and M1 fixes) then caught two more issues, both now fixed:

- **M2 mirror bug (high):** the admin-login lockout — added in the same PR — carried the **identical** separate-reset-then-increment TOCTOU on its expired-window path. Applied the same single-atomic-statement fix (`registerFailedLogin`) plus an expired-window concurrency regression test.
- **Webhook throttling (funds-safety):** making `ThrottlerGuard` global newly IP-throttled the signed provider callbacks. Deposit/settlement webhooks arrive from a provider's egress IP (and Meta webhooks from Meta's shared IPs), so an IP-keyed limit could 429 a legitimate settlement burst. Added `@SkipThrottle()` to the Blockradar, Flutterwave, and WhatsApp webhook/flow controllers — they are authenticated by signature/crypto, not IP, and forged calls are still rejected fast before any work.

All fixes were re-verified against the full gate suite above.

**Pre-existing, out-of-scope note:** `api/test/auth.e2e-spec.ts` fails at container boot because its env setup omits `ADMIN_MFA_ENC_KEY` (which 11 sibling admin/buy e2e specs set) — verified to reproduce on the branch base with the security changes reverted, i.e. **unrelated to this PR**. The `pnpm test` gate runs unit tests; e2e is a separate Docker/Testcontainers lane. Recommend a one-line fix to that spec's env in a follow-up.
