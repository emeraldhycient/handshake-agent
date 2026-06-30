# Web Agent Vertical — Design

> Status: **approved** (2026-06-28) · Branch: `feat/web-agent-vertical`
> Read order: root [`CLAUDE.md`](../../../CLAUDE.md) → [`api/CLAUDE.md`](../../../api/CLAUDE.md) → [`web/CLAUDE.md`](../../../web/CLAUDE.md) → this spec.

## 1. Goal

Make the **web app a full agent surface** at parity with the shipped WhatsApp vertical: a logged-in
user can **buy, receive, sell, and send** crypto by chatting with the agent in the browser, with the
**same server-side deterministic engine** settling every transaction. WhatsApp and web share one brain;
only the transport and the confirmation/PIN surface differ.

This vertical adds three things the repo does not yet have:

1. **Email-first web authentication** (signup → email-verify → email-OTP login → JWT session).
2. **Channel-agnostic conversation orchestration** + an HTTP chat/confirm/execute surface for the browser.
3. **Frontend wiring** that replaces the current mock chat with the live agent + engine.

Non-goals (explicitly deferred): swap/ticket flows (agent still returns `not_supported`); real email
provider (mock now); full WhatsApp↔web account-link verification hardening (the _hook_ is built — a pending
WhatsApp `ChannelIdentity` at signup — but first-inbound verification/step-up reconciliation is a follow-up);
realtime/streaming chat (single-turn request/response is sufficient).

## 2. Baseline (what already exists)

- **Agent** is abstracted behind `IAgentPort.run(userText) → Intent` (LangGraph, single-turn intent
  extraction; emits `buy_crypto | sell_crypto | send_crypto | receive_crypto | none`, with
  `swap | buy_ticket | check_balance` stubbed). No DB access (§3.2). Reused as-is.
- **Engine** is channel-agnostic and complete: `ProposalService.createBuy/Sell/SendProposal` →
  `DirectiveService.issue/consume` (HMAC one-shot nonce grants) → `ExecutionService.executeBuy/Sell/Send`
  → settlement (`settleBuyPayment` via Flutterwave webhook, `settleSellPayout` via Flutterwave webhook,
  `settleSendOnChain` via Blockradar webhook). Reused as-is.
- **`ConversationService.handleInbound(InboundMessage)`** orchestrates resolve-identity → agent →
  route-intent → guard → proposal → dispatch, but its dispatch is **WhatsApp-coupled** (issues the
  directive inside `sendConfirmationFlow`, pushes Flows/CTA-URLs/text via `IWhatsAppSender`, returns a
  `replyText` string).
- **Schema is web-ready**: `User.verifiedEmail` (unique), `User.verifiedBackupPhone`, `Device`
  (fingerprint/trustState/boundAt), `Session` (accessTokenHash/refreshTokenHash/deviceId/`channel
@default(web)`/stepUpCompletedAt/revocation), `Channel.web`. `PinService` (hashPin/setPin/verifyPin)
  and `SessionService` (device step-up) exist. **Missing**: JWT session lifecycle methods on the session
  repo, an email/OTP provider, the HTTP auth surface, a session-auth KYC path, the web chat/exec endpoints.
- **Frontend** is a fully-built prototype (chat thread/composer, quote/balance/receive/receipt cards,
  confirm sheet, PIN pad, success overlay) wired entirely to **mock fixtures** (`lib/chat/flow.ts`,
  `lib/chat/intent.ts`). No auth pages, no session, no real chat call. `useConfig()` already fetches `/config`.
- **No deps**: `@nestjs/jwt`, passport, nodemailer not installed.

## 3. Architecture decision — extract a channel-agnostic orchestrator (Approach A)

Pull the intent→action policy out of `ConversationService` into a **`ConversationOrchestrator`**:

```
orchestrateTurn(input: {
  userId: string;            // already-resolved acting user (web: from JWT; whatsapp: from resolveByChannel)
  text: string;
  channel: 'web' | 'whatsapp';
  beneficiaryId?: string;    // optional explicit pick for sell/send; falls back to default
  requiresReverification?: boolean;
}): Promise<AgentTurnOutcome>
```

`AgentTurnOutcome` is a discriminated union (defined in contracts):

```
| { kind: 'clarification'; text }
| { kind: 'needs_kyc' }                              // web: route to in-app KYC; whatsapp: CTA-URL handoff
| { kind: 'needs_reverification' }
| { kind: 'needs_beneficiary'; beneficiaryType: 'bank_account' | 'crypto_address' }
| { kind: 'receive'; deposit: { asset, network, address, … } }
| { kind: 'balance'; balances: [...] }               // when check_balance is enabled; else not_supported
| { kind: 'proposal'; txType: 'buy'|'sell'|'send'; proposalId; confirmation: Buy/Sell/SendProposalConfirmation }
| { kind: 'not_supported'; action }
```

- **Directive issuance leaves the WhatsApp path** and becomes an explicit step both channels call
  (web: the `authorize` endpoint; WhatsApp: when it sends the confirmation Flow). The orchestrator
  returns the proposal+confirmation only; it does **not** mint the nonce.
- **WhatsApp adapter** (`ConversationService`, refactored) calls `orchestrateTurn`, then renders the
  outcome to Flows/CTA/text via `IWhatsAppSender` — external behavior unchanged, guarded by the existing
  118 e2e / 794 unit tests, which are re-run independently after every change (per the SDD-gate memory).
- **Web controller** calls `orchestrateTurn`, then serializes the outcome to JSON.

Rejected alternative (B): a parallel `WebConversationService` re-implementing the route/guard switch —
duplicates the money-routing policy and invites drift (§13). DRY wins; tests de-risk the refactor.

## 4. Backend — Auth module (`api/src/modules/auth/`, new)

Clean-arch layered (domain/application/infrastructure/presentation). Builds on the existing
`Session`/`Device`/`User.verifiedEmail` schema, `PinService`, and `SessionService`.

### 4.1 Endpoints

| Method/Path                | Guard                     | Request                             | Response                                              | Behavior                                                                                                                                                                                                                                                                                                             |
| -------------------------- | ------------------------- | ----------------------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /auth/signup`        | Throttler                 | `{ email, phone }`                  | `202 {}`                                              | Create provisional `User` (verifiedEmail null) + pending WhatsApp `ChannelIdentity` for `phone` (`verificationStatus: pending`, `userId` = new user). Mint email-verify token (hashed, TTL) → `EmailProvider.send`. Idempotent on existing unverified email (re-send). Never reveals whether email already verified. |
| `POST /auth/verify-email`  | Throttler                 | `{ token }`                         | `200 { verified: true }`                              | Consume token (single-use) → set `User.verifiedEmail`, `User.status` stays provisional until KYC.                                                                                                                                                                                                                    |
| `POST /auth/login/request` | Throttler                 | `{ email }`                         | `202 {}`                                              | If a verified user exists, mint OTP (hashed, short TTL, attempt-limited) → email it. Always 202 (no enumeration).                                                                                                                                                                                                    |
| `POST /auth/login/verify`  | Throttler                 | `{ email, otp, deviceFingerprint }` | `200 { accessToken, refreshToken, user: MeResponse }` | Verify OTP → upsert+bind `Device` from fingerprint → create `Session` (store SHA-256 hashes of both tokens, `channel: web`, `deviceId`) → issue JWT access (short TTL) + opaque refresh.                                                                                                                             |
| `POST /auth/refresh`       | — (refresh token in body) | `{ refreshToken }`                  | `200 { accessToken, refreshToken }`                   | Validate refresh against active session hash → rotate (revoke old row, issue new pair). Reuse-detection: a presented-but-revoked refresh revokes the chain.                                                                                                                                                          |
| `POST /auth/logout`        | JwtAuth                   | —                                   | `204`                                                 | Revoke the current session.                                                                                                                                                                                                                                                                                          |
| `GET /auth/me`             | JwtAuth                   | —                                   | `MeResponse`                                          | `{ userId, email, kycStatus, kycTier, hasPin, capabilities }` — FE gating + onboarding state.                                                                                                                                                                                                                        |

### 4.2 Components

- **`@nestjs/jwt`** added. `JwtAuthGuard` validates the access token signature/exp **and** confirms the
  `Session` row is active (access-token-hash match, not revoked, not expired). `@CurrentUser()` param
  decorator exposes `{ userId, sessionId, deviceId }`.
- **`EmailProvider` port** + **`MockEmailProvider`** adapter: logs the token/OTP; when
  `AUTH_DEV_EXPOSE_OTP=true` (non-prod only, env-validated, fail-closed in prod) the mint endpoints echo
  the code in the response for test automation. Real provider is a later port swap. Mirrors `MockKycProvider`.
- **OTP / email-token store**: hashed values with `expiresAt` + attempt counter. Reuse the `HandoffToken`
  table pattern or a dedicated `AuthChallenge` table (decision deferred to plan; favor a dedicated table
  to keep purposes separable). Tokens/OTPs never stored or logged in plaintext.
- **Session lifecycle**: extend `ISessionRepository` + `SessionService` with `createSession`,
  `findActiveByAccessTokenHash`, `findActiveByRefreshTokenHash`, `rotateRefresh`, `revoke`,
  `revokeAllForUser`. `Session` columns already exist; step-up methods stay as-is.
- **Config/env** (root §7): `JWT_SECRET`, `JWT_ACCESS_TTL`, `JWT_REFRESH_TTL`, `AUTH_OTP_TTL`,
  `AUTH_OTP_LENGTH`, `AUTH_EMAIL_TOKEN_TTL`, `AUTH_DEV_EXPOSE_OTP` — all zod-validated at boot.

### 4.3 WhatsApp-link hook (§3.4)

Signup stores the phone as a **pending** WhatsApp `ChannelIdentity` (`verificationStatus: pending`,
`userId` = web user). When that number later messages WhatsApp, the existing `resolveByChannel` finds the
linked user; first inbound is treated as `requiresReverification` until a verification/step-up completes
(reconciliation hardening is a documented follow-up, not in this vertical's critical path). The phone is a
routing key only — never an auth anchor.

## 5. Backend — Web KYC (session-authenticated)

Web-native users are Users from signup, so today's Contact-upgrade path doesn't fit. Add
`KycService.completeVerificationForUser({ userId, nin?, bvn?, firstName, lastName, dateOfBirth?, pin })`:
runs the same mock `IKycProvider`, hashes the PIN via `PinService.setPin`, flips `User`/`KycProfile` to
`verified`/`tier_1` atomically, eagerly provisions wallets (`provisionAllEnabledNetworks`, best-effort).
New endpoint **`POST /kyc/submit`** (JwtAuth) consuming `KycSubmitRequest`. The handoff-token
`POST /kyc/complete` stays for WhatsApp. Server-side KYC gate (§3.3) is unchanged in the engine.

## 6. Backend — Chat + execution endpoints (`api/src/modules/conversations/presentation/` + chat)

All `JwtAuth`. Messages persisted via existing `Conversation`/`ConversationMessage`/`MessageIntent`/
`ConversationReply` repos with `channel: web` (user has a 1:1 `Conversation`).

| Method/Path                          | Request                                                                                 | Response                                                                                 |
| ------------------------------------ | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `POST /chat/messages`                | `{ text, beneficiaryId? }`                                                              | `WebChatResponse { reply:{text}, outcome: AgentTurnOutcome, conversationId, messageId }` |
| `POST /chat/proposals/:id/authorize` | —                                                                                       | `AuthorizeProposalResponse { directiveId, nonce, expiresAt }`                            |
| `POST /chat/proposals/:id/execute`   | `ExecuteProposalRequest { directiveId, nonce, pin, deviceFingerprint, idempotencyKey }` | `ExecuteProposalResponse { transactionId, status, payment? \| payout? \| onChain? }`     |
| `GET /transactions/:id`              | —                                                                                       | `TransactionStatusResponse { id, type, status, receiptNumber?, payment?, … }`            |

- **Authorize** issues the directive (`request_pin` for buy/sell, `request_step_up` for send) **only when
  the user taps Confirm**, minimizing the nonce window. The nonce is returned over TLS (the web equivalent
  of the Flow E2E channel, §3.5), held in FE memory, never displayed or logged.
- **Execute** dispatches by proposal type (`IProposalRepository.getType`) → `ExecutionService.executeX`
  with `idempotencyKey = proposalId` semantics preserved. For **send**, `deviceFingerprint` resolves to the
  bound device for step-up (`SessionService.recordStepUp`), fail-closed if no device (§3.4).
- **Settlement-aware UX**:
  - **buy** → execute returns `payment { accountNumber, bankName, providerRef, amount, currency }`;
    FE shows a **pay-into-this-account card (pending)**; Flutterwave webhook → `settleBuyPayment` credits
    wallet; FE polls `GET /transactions/:id` → completed receipt.
  - **sell** → `settling`; Flutterwave payout webhook → `settleSellPayout`; poll to completed/failed.
  - **send** → `settling`; Blockradar webhook → `settleSendOnChain`; poll to completed/failed.
  - **receive** → read-only; address shown immediately, no execute.
- No realtime: the agent is single-turn; polling via TanStack Query covers settlement.

## 7. Backend — Beneficiary endpoints (`api/src/modules/beneficiaries/presentation/`)

All `JwtAuth`, reusing `BeneficiaryService`:

- `GET /beneficiaries?type=bank_account|crypto_address` → list.
- `POST /beneficiaries/bank-account` `{ accountNumber, bankCode, label }` → bank name-enquiry port + add.
- `POST /beneficiaries/crypto-address` `{ address, network, asset, label }` → address-pattern validation +
  first-use cooling-off + add.
- (Optional) `GET /banks` for the bank picker if a list port exists; else FE supplies bank codes.

Sell/send use the default beneficiary unless `beneficiaryId` is passed on the message.

## 8. Contracts (`packages/contracts/src/`) — new, all tested by valid/invalid fixtures

- **auth/**: `SignupRequest`, `VerifyEmailRequest`, `LoginRequest`, `LoginVerifyRequest`,
  `LoginVerifyResponse`, `RefreshRequest`, `RefreshResponse`, `MeResponse`.
- **chat/**: `ChatMessageRequest`, `AgentTurnOutcome` (union), `WebChatResponse`,
  `AuthorizeProposalResponse`, `ExecuteProposalRequest`, `ExecuteProposalResponse`,
  `TransactionStatusResponse`.
- **beneficiaries/**: `AddBankAccountRequest`, `AddCryptoAddressRequest`, `BeneficiaryResponse`.
- **kyc/**: `KycSubmitRequest` (session variant — existing fields minus `token`).

Reuse existing `Buy/Sell/SendProposalConfirmation`, intent, and `PublicConfigResponse` schemas — never
redefine. `zod` stays pinned `^3.25.32`.

## 9. Frontend (`web/`)

- **Auth**: routes `/signup`, `/verify-email`, `/login`; `authStore` (Zustand: access token in memory +
  refresh token); axios **Authorization interceptor + 401→refresh→retry** extending the existing
  interceptor that sets `Idempotency-Key`; `deviceFingerprint` generated + persisted in `localStorage`;
  a route guard redirecting unauthenticated users to `/login`; `useMe()` query.
- **Chat**: delete `lib/chat/intent.ts` (local NLU) and `lib/chat/flow.ts` (fixtures). `chat-store.send()`
  calls `POST /chat/messages`, maps `outcome` → existing `ChatMessage` kinds + `ConfirmPayload`.
  `confirmToPin()` → `POST …/authorize` (nonce into memory). `pinComplete()` → `POST …/execute`, then a
  **settlement-aware receipt** that polls `GET /transactions/:id`; the "`pinComplete` is the only path that
  appends a receipt" invariant is preserved. PIN/nonce never logged.
- **KYC/onboarding**: `/kyc` + `/onboarding` call session-auth `POST /kyc/submit` (PIN set here) instead of
  the handoff token.
- **Beneficiaries**: add bank-account / crypto-address add+select UI; `needs_beneficiary` outcome opens it.
- **Config gating**: `useConfig()` drives which actions are offered/enabled.
- Real `useBalances`/`useActivity`/`useDepositAddress` replace fixtures; four async branches each (§5 FE).

## 10. Invariants preserved (verify at completion)

- **§3.1** model proposes / engine disposes — agent only emits intent; the same `ExecutionService` settles.
- **§3.2** agent has no DB — untouched; `dependency-cruiser` clean.
- **§3.3** server-side KYC/limit/sanctions gate on every money endpoint — engine re-checks, unchanged;
  web endpoints add `JwtAuth` but never replace the engine gate.
- **§3.4** identity = verified email + KYC + bound device + PIN; phone is a routing key only.
- **§3.5** PIN/nonce never plaintext-at-rest; TLS-only; engine-brokered settlement; no secret in logs.

## 11. Phasing — each phase independently testable in the running app

0. **Contracts + deps** — add contracts schemas (+ tests), `@nestjs/jwt`, `EmailProvider` mock scaffolding.
1. **Web auth** — signup → verify-email → login OTP → JWT session → `/me`; FE auth pages + token store +
   interceptor + guard. _Milestone: sign up, verify, log in, see `/me` live._ Bring up API + web dev servers.
2. **Session-auth KYC + PIN** — `POST /kyc/submit`; FE onboarding sets PIN. _Milestone: become a
   transactable user._
3. **Orchestrator refactor + read-only chat** — extract `ConversationOrchestrator`; `POST /chat/messages`
   for receive/balance/clarification/not_supported; FE chat calls live agent. _Milestone: chat works;
   WhatsApp e2e stays green (run full e2e)._
4. **Buy** — proposal → authorize → execute → pay-in card → settle (webhook) → polled receipt.
   _Milestone: full buy in the browser._
5. **Sell + Send + beneficiaries** — beneficiary endpoints + UI; sell + send proposals/execute/step-up/
   settlement. _Milestone: all four flows._
6. **Polish** — config-driven capability gating in UI, activity/wallet wired to real reads, accessibility
   pass, full unit + e2e + FE sweep.

## 12. Testing & gates

Strict TDD (red→green→refactor); ~100% on domain/application/engine and all new auth/orchestration logic.
Backend: Jest unit + supertest e2e against real Postgres (Testcontainers). Frontend: Vitest + RTL;
Playwright E2E for the auth + buy happy paths. Contracts: fixture parsing. **Per the SDD-gate memory**:
independently re-run `pnpm --filter @handshake-agent/api typecheck` + targeted e2e after every subagent
task, and the **full** root `pnpm turbo run typecheck test` + e2e + `pnpm depcruise` at each phase milestone
(a new injectable can break `AppModule` boot without failing its own narrow test). Conventional Commits,
one coherent change per commit.

## 13. New dependencies

- `api`: `@nestjs/jwt`. (Email provider stays a mock port — no new runtime email dep yet.)
- `web`: none required beyond installed (`@tanstack/react-query`, `zustand`, `axios`, `react-hook-form`,
  `zod`, `@handshake-agent/contracts`). A device-fingerprint helper is hand-rolled (no new dep).
