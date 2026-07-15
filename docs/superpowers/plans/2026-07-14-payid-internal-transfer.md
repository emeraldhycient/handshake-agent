# PayID + public nicknames + internal transfer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send crypto to another Handshake user by their `@handle` (auto-minted PayID or a user-owned public nickname), settled as an instant, feeless internal ledger transfer.

**Architecture:** A PayID is minted for every user in `createSignup` and stored on `User` (case-insensitively unique). Public nicknames live in a `PublicAlias` table sharing one namespace. A global `resolveHandle` turns an `@handle` into a `recipientUserId`; the Spec-1 `SendDestination` seam's reserved `internal_user` variant carries it into `createSendProposal`, which settles via a new ledger double-entry (debit sender `user_wallet`, credit recipient `user_wallet`) — no on-chain withdraw.

**Tech Stack:** NestJS 11 + Prisma 7 (api), Zod contracts, Next 16/React 19 (web), Jest (unit + Testcontainers e2e), Vitest (web).

**Spec:** [`docs/superpowers/specs/2026-07-14-payid-internal-transfer-design.md`](../specs/2026-07-14-payid-internal-transfer-design.md)

## Global Constraints

- **§3.1** — the model never emits/extracts a PayID/handle as a destination; it captures `recipientNickname` (a lookup key), and the engine resolves it server-side. MCP stays read + propose only.
- **§3.1 no-misroute** — an unresolved `@handle` surfaces a clarification, NEVER a default beneficiary.
- **§3.3** — KYC/tier/velocity + **counterparty-user sanctions** + a **userId self-send guard** re-run server-side; PIN + device-bound step-up at execute.
- **Ledger integrity** — internal-transfer legs sum to zero; every `LedgerEntry.amount` is non-zero; `sequence === prev+1`; `balanceAfter === prev + signedAmount` (the invariants in `ledger.ts`).
- **PayID format** — `^[a-z0-9_]{3,30}$`, stored lowercase, reserved-word denylist; displayed `@handle`.
- **Tier** — internal transfer is a new `crypto.transfer` capability, gated **tier_2**, `onChainSend:false` (no on-chain per-send cap).
- **Migration-first** — every user must have a PayID before the send path resolves handles.
- Shapes crossing FE/BE live in `@handshake-agent/contracts`. Strict TDD (RED→GREEN). Conventional Commits. Money-path e2e run locally (Docker Postgres :5544 + Redis :6379).

## File change map

| File | Responsibility |
| --- | --- |
| `packages/contracts/src/common.ts` | `PayIdSchema` + reserved-word list + `normalizeHandle`. |
| `packages/contracts/src/auth/auth.dto.ts`, `dto/profile.dto.ts` | `payId` on `MeResponse`/`ProfileResponse`; `ClaimPayIdSchema`; public-nickname DTOs. |
| `api/prisma/schema/02-identity.prisma` | `User.payId` + `payIdChangedAt`; `PublicAlias` model. |
| `api/prisma/migrations/*` | columns + `lower()` partial-unique indexes + backfill. |
| `api/src/modules/auth/infrastructure/auth-user.prisma.repository.ts` | mint PayID in `createSignup`; select in `loadMe`. |
| `api/src/modules/identity/**` (new `handle` service + controller) | `resolveHandle`; PublicAlias CRUD; `PATCH /profile/payid`. |
| `api/src/modules/transactions/domain/ledger.ts` | `buildInternalTransferLedgerEntries`. |
| `api/src/modules/transactions/application/proposal.service.ts` | `internal_user` branch + `internal_transfer` type. |
| `api/src/modules/transactions/application/execution.service.ts` | internal settlement branch (ledger post). |
| `api/src/modules/compliance/**` | `screenCounterpartyUser`. |
| `api/src/modules/chat/application/web-chat.service.ts` | `resolveSendDestination`: `@`-sigil → `resolveHandle`. |
| `api/test/internal-transfer.e2e-spec.ts` | Testcontainers vertical. |
| `web/components/chat/cards/**`, `web/components/settings/**` | confirmation card + PayID/public-nickname UI. |

---

## Task 1: Contracts — PayIdSchema + surfacing + DTOs

**Files:**
- Modify: `packages/contracts/src/common.ts`; `packages/contracts/src/auth/auth.dto.ts`; `packages/contracts/src/dto/profile.dto.ts`
- Test: the sibling `*.spec.ts` for each

**Interfaces produced:** `PayIdSchema` (`z.string().regex(/^[a-z0-9_]{3,30}$/)` + reserved denylist refine); `normalizeHandle(s: string): string` (strip leading `@`, trim, lowercase); `MeResponse.payId?: string`; `ProfileResponse.payId?: string`; `ClaimPayIdSchema = z.object({ payId: PayIdSchema }).strict()`; `CreatePublicNicknameSchema = z.object({ alias: PayIdSchema }).strict()`; `PublicNicknameSchema = z.object({ id: z.string().uuid(), alias: z.string() })`.

- [ ] **Step 1: Write the failing tests** (in `common.spec.ts`)

```ts
import { PayIdSchema, normalizeHandle } from './common'
describe('PayIdSchema', () => {
  it('accepts a valid handle', () => { expect(PayIdSchema.parse('hycient_1')).toBe('hycient_1') })
  it('rejects too short / bad chars / reserved', () => {
    expect(() => PayIdSchema.parse('ab')).toThrow()
    expect(() => PayIdSchema.parse('Bad-Char')).toThrow()
    expect(() => PayIdSchema.parse('admin')).toThrow()
  })
})
describe('normalizeHandle', () => {
  it('strips @, trims, lowercases', () => { expect(normalizeHandle('  @Ada ')).toBe('ada') })
})
```

- [ ] **Step 2: Run** `pnpm --filter @handshake-agent/contracts test -- common` → FAIL.

- [ ] **Step 3: Implement** in `common.ts`:

```ts
const RESERVED_HANDLES = new Set(['admin','support','handshake','payid','pay','system','root','help','me'])
export const PayIdSchema = z
  .string()
  .regex(/^[a-z0-9_]{3,30}$/, 'handle must be 3-30 chars of a-z, 0-9, _')
  .refine((h) => !RESERVED_HANDLES.has(h), 'that handle is reserved')
export function normalizeHandle(raw: string): string {
  return raw.trim().replace(/^@/, '').toLowerCase()
}
```

Add `payId: z.string().optional()` to `MeResponseSchema` and `ProfileResponseSchema`; add `ClaimPayIdSchema`, `CreatePublicNicknameSchema`, `PublicNicknameSchema`, and a `PublicNicknamesResponseSchema = z.object({ nicknames: z.array(PublicNicknameSchema) })`.

- [ ] **Step 4: Run** the contracts test → PASS.
- [ ] **Step 5: Commit** `feat(contracts): PayId schema + payId on Me/Profile + public-nickname DTOs`.

---

## Task 2: Prisma schema + migration + backfill

**Files:**
- Modify: `api/prisma/schema/02-identity.prisma`
- Create: `api/prisma/migrations/<ts>_add_payid_and_public_alias/migration.sql`

**Interfaces produced:** `User.payId String?`, `User.payIdChangedAt DateTime?`; `PublicAlias { id, userId, alias, createdAt }`.

- [ ] **Step 1: Edit the schema** — add to `model User`:

```prisma
  payId          String?   @unique
  payIdChangedAt DateTime? @db.Timestamptz
  publicAliases  PublicAlias[]
```

Add the model:

```prisma
model PublicAlias {
  id        String   @id @default(uuid(7)) @db.Uuid
  userId    String   @db.Uuid
  alias     String
  createdAt DateTime @default(now()) @db.Timestamptz
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@index([userId])
  @@map("public_aliases")
}
```

- [ ] **Step 2: Hand-author the migration** (`migration.sql`) — the `@unique` on `payId` covers exact-case; add the case-insensitive partial-unique indexes + backfill:

```sql
ALTER TABLE "users" ADD COLUMN "pay_id" TEXT;
ALTER TABLE "users" ADD COLUMN "pay_id_changed_at" TIMESTAMPTZ;
CREATE UNIQUE INDEX "users_pay_id_key" ON "users"("pay_id");
CREATE UNIQUE INDEX "users_pay_id_lower_key" ON "users"(lower("pay_id")) WHERE "pay_id" IS NOT NULL;

CREATE TABLE "public_aliases" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL,
  "alias" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "public_aliases_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "public_aliases_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE
);
CREATE INDEX "public_aliases_userId_idx" ON "public_aliases"("userId");
CREATE UNIQUE INDEX "public_aliases_alias_lower_key" ON "public_aliases"(lower("alias"));

-- Backfill: mint a deterministic PayID for every existing user from email local-part,
-- de-duplicated with a row-number suffix so it is globally unique + non-reserved-safe.
WITH base AS (
  SELECT id,
         regexp_replace(lower(split_part(coalesce(email,'user'), '@', 1)), '[^a-z0-9_]', '', 'g') AS slug
  FROM users WHERE pay_id IS NULL
), padded AS (
  SELECT id, CASE WHEN length(slug) < 3 THEN slug || 'user' ELSE left(slug,30) END AS slug FROM base
), numbered AS (
  SELECT id, slug, row_number() OVER (PARTITION BY slug ORDER BY id) AS rn FROM padded
)
UPDATE users u SET pay_id = CASE WHEN n.rn = 1 THEN n.slug ELSE left(n.slug, 26) || n.rn::text END
FROM numbered n WHERE u.id = n.id;
```

- [ ] **Step 3: Apply + regenerate.** Run (per the `:5544` orphan-migration caveat, apply via docker psql if `migrate dev` is blocked, then `migrate resolve --applied`): `pnpm --filter @handshake-agent/api exec prisma migrate dev --name add_payid_and_public_alias` → then `prisma generate`.
- [ ] **Step 4: Verify** — `docker exec handshake-agent-db psql ... -c "SELECT count(*) FROM users WHERE pay_id IS NULL;"` → expect 0.
- [ ] **Step 5: Commit** `feat(api): add User.payId + PublicAlias schema + backfill migration`.

---

## Task 3: Mint PayID at signup + surface in /auth/me

**Files:**
- Modify: `api/src/modules/auth/infrastructure/auth-user.prisma.repository.ts` (`createSignup` ~44; `loadMe` projection ~193)
- Test: `api/src/modules/auth/infrastructure/auth-user.prisma.repository.spec.ts` (or an e2e if no unit harness)

**Interfaces produced:** a private `mintPayId(tx, seed: string): Promise<string>` used inside the `createSignup` transaction; `loadMe` returns `payId`.

- [ ] **Step 1: Write the failing e2e** (extend an existing auth e2e, since this repo mints via real Postgres): after `POST /auth/signup` + verify, assert `GET /auth/me` returns a `payId` matching `/^[a-z0-9_]{3,30}$/`; sign up a second user with the same email local-part (different domain) and assert the two `payId`s differ (collision suffix).

- [ ] **Step 2: Run** the auth e2e → FAIL (no payId).

- [ ] **Step 3: Implement** — inside `createSignup`'s `$transaction`, after `tx.user.create`, mint + set the PayID. Add the helper (mirror `bindDevice`'s `Prisma.PrismaClientKnownRequestError` P2002 handling):

```ts
private async mintPayId(tx: Prisma.TransactionClient, seed: string): Promise<string> {
  const base = (seed.split('@')[0] || 'user').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 26) || 'user'
  const slug = base.length < 3 ? `${base}user` : base
  for (let attempt = 0; attempt < 6; attempt++) {
    const candidate = attempt === 0 ? slug : `${slug.slice(0, 26)}${attempt}`
    try {
      await tx.user.update({ where: { id: /* userId */ }, data: { payId: candidate } })
      return candidate
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') continue
      throw err
    }
  }
  const rnd = `${slug.slice(0, 22)}${Math.floor(1000 + /* seeded */ 0)}` // fallback; use a crypto random suffix
  await tx.user.update({ where: { id: /* userId */ }, data: { payId: rnd } })
  return rnd
}
```

Wire it: capture `user.id` from the create, then `await this.mintPayId(tx, email)` referencing that id (pass the id in, not a comment). Add `payId: true` to the `loadMe` select + the `MeProjection` port + the returned object.

- [ ] **Step 4: Run** the auth e2e → PASS.
- [ ] **Step 5: Commit** `feat(api): mint a PayID at signup + surface it in /auth/me`.

---

## Task 4: Handle resolver + PublicAlias CRUD + PATCH /profile/payid

**Files:**
- Create: `api/src/modules/identity/application/handle.service.ts` + its port/repository; `api/src/modules/identity/presentation/handle.controller.ts`
- Test: `handle.service.spec.ts`

**Interfaces produced:**
```ts
resolveHandle(handle: string): Promise<{ userId: string; displayName: string; handle: string } | null>
addPublicNickname(userId: string, alias: string): Promise<{ id: string; alias: string }>   // throws HandleTakenError / NicknameCapError
removePublicNickname(userId: string, id: string): Promise<void>
listPublicNicknames(userId: string): Promise<{ id: string; alias: string }[]>
changePayId(userId: string, payId: string): Promise<void>   // throws HandleTakenError / PayIdAlreadyChangedError
```
Consumes: the repository does the case-insensitive lookups (`lower(pay_id)` / `lower(alias)`); the display name is `firstName + ' ' + lastName[0] + '.'` (minimal reveal).

- [ ] **Step 1: Write the failing tests** — `resolveHandle('@Ada')` (case-insensitive) returns the payId owner; a public-nickname match resolves; a miss returns `null`; `addPublicNickname` rejects a taken handle (`HandleTakenError`) and enforces the ≤5 cap (`NicknameCapError`); `changePayId` rejects a second change (`PayIdAlreadyChangedError`) and a taken handle.

- [ ] **Step 2: Run** `pnpm --filter @handshake-agent/api test -- handle.service` → FAIL.

- [ ] **Step 3: Implement** the service (normalize via `normalizeHandle`; the repo checks `User.payId` then `PublicAlias`; `addPublicNickname` checks BOTH tables for the shared namespace + counts existing ≤5; `changePayId` checks `payIdChangedAt IS NULL` + both tables, sets `payId` + `payIdChangedAt=now`). Controller: `GET/POST/DELETE /profile/public-nicknames` (JwtAuthGuard, no PIN) + `PATCH /profile/payid` (JwtAuthGuard, `@Throttle` tight, `ClaimPayIdSchema`). Map `HandleTakenError`→409, `NicknameCapError`→422, `PayIdAlreadyChangedError`→409 in the DomainExceptionFilter.

- [ ] **Step 4: Run** the service test → PASS. `pnpm --filter @handshake-agent/api typecheck`.
- [ ] **Step 5: Commit** `feat(api): global handle resolver + public-nickname CRUD + PATCH /profile/payid`.

---

## Task 5: Ledger — buildInternalTransferLedgerEntries

**Files:**
- Modify: `api/src/modules/transactions/domain/ledger.ts`
- Test: `api/src/modules/transactions/domain/ledger.spec.ts`

**Interfaces produced:**
```ts
interface BuildInternalTransferLedgerInput {
  senderWalletId: string; recipientWalletId: string; asset: string; cryptoAmount: string;
  postedAt: Date; accountStates: Record<AccountKey, AccountState>;
}
export function buildInternalTransferLedgerEntries(input: BuildInternalTransferLedgerInput): LedgerEntryDraft[]
```

- [ ] **Step 1: Write the failing test** — a `5` USDT transfer produces exactly 2 drafts: a **debit** on `user_wallet:senderWalletId:USDT` (amount `-5`) and a **credit** on `user_wallet:recipientWalletId:USDT` (amount `+5`); the signed sum is exactly `0`; each `balanceAfter === prevBalance + signedAmount`; `sequence === prevSequence + 1` per account; a zero amount throws `LedgerError`.

- [ ] **Step 2: Run** `pnpm --filter @handshake-agent/api test -- ledger` → FAIL.

- [ ] **Step 3: Implement** — mirror `buildBuyLedgerEntries`' `EntrySpec[]`→`buildEntry` structure, but with two `user_wallet` legs in the same `asset`:

```ts
export function buildInternalTransferLedgerEntries(input: BuildInternalTransferLedgerInput): LedgerEntryDraft[] {
  const { senderWalletId, recipientWalletId, asset, cryptoAmount, postedAt, accountStates } = input
  assertPositiveDecimal(cryptoAmount, 'cryptoAmount')
  const specs: EntrySpec[] = [
    { accountType: LedgerAccountType.user_wallet, accountId: senderWalletId, currency: asset,
      amount: fromScaled(-toScaled(cryptoAmount)), description: `Internal transfer: ${cryptoAmount} ${asset} sent` },
    { accountType: LedgerAccountType.user_wallet, accountId: recipientWalletId, currency: asset,
      amount: cryptoAmount, description: `Internal transfer: ${cryptoAmount} ${asset} received` },
  ]
  return specs.map((s) => buildEntry(s, postedAt, accountStates))  // match buildBuyLedgerEntries' exact call shape
}
```
(Match the real `buildEntry`/`EntrySpec` signature + the sequence/balance threading used by `buildBuyLedgerEntries` — read lines 201-260 of `ledger.ts` and follow it exactly.)

- [ ] **Step 4: Run** the ledger test → PASS.
- [ ] **Step 5: Commit** `feat(api): ledger double-entry builder for internal transfers`.

---

## Task 6: Engine — createSendProposal internal_user branch

**Files:**
- Modify: `api/src/modules/transactions/application/proposal.service.ts` (`SendDestination` type; `createSendProposal` branch; `internal_transfer` type)
- Modify: `api/src/modules/compliance/**` (add `screenCounterpartyUser`) — or do Task 8 first and consume it
- Test: `proposal.service.spec.ts`

**Interfaces produced:** `SendDestination` gains `{ kind: 'internal_user'; recipientUserId: string; displayHandle: string }`; proposal `parameters` carry `destinationKind: 'internal_user'`, `recipientUserId`, `recipientWalletId`, `networkFeeCrypto: '0'`, `totalDebit === cryptoAmount`, no `toAddress`; proposal `type: 'internal_transfer'`.

**Interfaces consumed:** `walletService.getOrProvisionNetworkWallet(recipientUserId, network)`; `complianceService.screenCounterpartyUser({ userId })` (Task 8); `SelfSendError`.

- [ ] **Step 1: Write the failing tests** — internal_user destination: resolves the recipient wallet, `recipientUserId === userId` → `SelfSendError`; counterparty sanctions block → `SanctionsBlockedError`; `totalDebit === cryptoAmount` (no fee); KYC gate called with `onChainSend:false` + `capability:'crypto.transfer'`; persists `destinationKind:'internal_user'` + `recipientUserId` + no `toAddress`; proposal `type:'internal_transfer'`.

- [ ] **Step 2: Run** `pnpm --filter @handshake-agent/api test -- proposal.service` → FAIL.

- [ ] **Step 3: Implement** the `internal_user` branch in `createSendProposal` (parallel to the `saved_beneficiary`/`raw_address` branches from Spec 1). Resolve `recipientWallet = getOrProvisionNetworkWallet(recipientUserId, network)`; guard `recipientUserId === userId` → `SelfSendError`; `screenCounterpartyUser`; gate with `onChainSend:false`, `capability:'crypto.transfer'`; set `networkFeeCrypto='0'`, `totalDebit=cryptoAmount`; persist the params + `type:'internal_transfer'`. Register `crypto.transfer` in `configuration.ts` (tier_2, default enabled). Confirmation carries `recipientDisplayName`, `recipientHandle`, `networkFeeCrypto:'0'`, `instant:true`.

- [ ] **Step 4: Run** the proposal test + `typecheck` → PASS.
- [ ] **Step 5: Commit** `feat(api): internal_user branch in createSendProposal (ledger transfer proposal)`.

---

## Task 7: Execution — internal settlement branch

**Files:**
- Modify: `api/src/modules/transactions/application/execution.service.ts` (send/settlement dispatch)
- Test: `execution.service.spec.ts`

**Interfaces consumed:** `buildInternalTransferLedgerEntries` (Task 5); `ledgerRepo.postTransaction`/equivalent (match how `executeBuy`/`executeSend` post ledger entries today).

- [ ] **Step 1: Write the failing tests** — executing an `internal_transfer` proposal posts the two-leg ledger transaction (NOT `walletService.withdraw`), the sender's `getAccountBalance` decreases by the amount and the recipient's increases by the amount; the idempotency early-return + PIN + step-up fence still apply; no on-chain webhook is enqueued.

- [ ] **Step 2: Run** `pnpm --filter @handshake-agent/api test -- execution.service` → FAIL.

- [ ] **Step 3: Implement** — in the execute dispatch, branch on `params.destinationKind === 'internal_transfer'` (or the proposal `type`): after the shared PIN/step-up/idempotency fence, call `buildInternalTransferLedgerEntries({ senderWalletId, recipientWalletId, asset, cryptoAmount, postedAt, accountStates })` and persist via the same ledger-post path buy/sell use; mark the tx `completed` (instant, no settling poll); record both legs for admin oversight. Do NOT call `walletService.withdraw` and do NOT enqueue the on-chain settlement outbox.

- [ ] **Step 4: Run** the execution test + `typecheck` → PASS.
- [ ] **Step 5: Commit** `feat(api): execute internal transfers via ledger double-entry`.

---

## Task 8: Compliance — screenCounterpartyUser

**Files:**
- Modify: `api/src/modules/compliance/**` (mirror `screenSendDestination`)
- Test: the compliance service spec

**Interfaces produced:** `screenCounterpartyUser(input: { userId: string }): Promise<{ passed: boolean; reason: string | null; complianceEventId: string }>`.

- [ ] **Step 1: Write the failing test** — a clean counterparty passes; a sanctioned counterparty (mock the screener) returns `passed:false` with a reason + a persisted compliance event.
- [ ] **Step 2: Run** the compliance spec → FAIL.
- [ ] **Step 3: Implement** — mirror `screenSendDestination` but key the screen on the counterparty user's identity (name/KYC identifiers) instead of an address; always write a compliance event.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(api): counterparty-user sanctions screening for internal transfers`.

*(Sequencing: implement Task 8 before/with Task 6 so the branch can consume it.)*

---

## Task 9: Chat — resolveSendDestination @-sigil routing

**Files:**
- Modify: `api/src/modules/chat/application/web-chat.service.ts` (`resolveSendDestination`)
- Test: `web-chat.service.spec.ts`

**Interfaces consumed:** `handleService.resolveHandle` (Task 4); `SendDestination.internal_user` (Task 6).

- [ ] **Step 1: Write the failing tests** — `recipientNickname` starting with `@` and resolving → `{ resolved: true, destination: { kind:'internal_user', recipientUserId, displayHandle } }`; an `@handle` that resolves to NOBODY → `needs_beneficiary`/clarification (NEVER `getDefault`); a plain nickname (no `@`) still routes to the existing private-beneficiary path unchanged.

- [ ] **Step 2: Run** `pnpm --filter @handshake-agent/api test -- web-chat.service` → FAIL.

- [ ] **Step 3: Implement** — at the top of the crypto branch of `resolveSendDestination`, if `recipientNickname?.startsWith('@')`: `const hit = await this.handleService.resolveHandle(recipientNickname)`; hit → internal_user descriptor; miss → `{ resolved:false, outcome:{ kind:'clarification', text: 'No Handshake user ' + recipientNickname + ' — double-check the handle.' }, summaryText: … }`. Do NOT fall through to nickname/default for an `@`-prefixed miss.

- [ ] **Step 4: Run** the web-chat test + `typecheck` → PASS.
- [ ] **Step 5: Commit** `feat(api): route @handle sends to the internal-transfer resolver`.

---

## Task 10: api e2e — internal transfer vertical

**Files:**
- Create: `api/test/internal-transfer.e2e-spec.ts` (bootstrap copied from `web-chat.e2e-spec.ts` / `send-raw-address.e2e-spec.ts`)

- [ ] **Step 1: Write the tests** — mint two tier_2 users A + B (each with a PayID from signup); seed A's USDT ledger balance; stub the LLM to `send_crypto` with `recipientNickname: '@' + B.payId`; POST `/chat/messages` → proposal `type:'internal_transfer'`; authorize + execute; assert A's `getAccountBalance` decreased by 5 and B's increased by 5 (both via `prisma`/the balance read); B's wallet auto-provisioned if absent. Plus: self-send to `@A.payId` → clarification, no proposal; unknown `@nobody` → clarification; A's `/auth/me` carries `payId`.

- [ ] **Step 2: Run** `pnpm --filter @handshake-agent/api test:e2e -- internal-transfer` → FAIL until Tasks 1-9 merge, then PASS.
- [ ] **Step 3-4:** No new prod code (validates 1-9; fix in the owning task if a gap surfaces).
- [ ] **Step 5: Commit** `test(api): e2e for internal transfer + self-send + unknown-handle`.

---

## Task 11: Web — confirmation card + profile PayID/public-nickname UI

**Files:**
- Modify: the chat quote/confirmation card (`web/lib/chat/agent-outcome.ts` send branch + the card) to render an internal-transfer confirmation (recipient name + `@handle` + "Instant · No network fee")
- Create: `web/components/settings/payid-section.tsx` + `public-nicknames-section.tsx` (orchestrated by `settings-panel.tsx`, root §16) + their `lib/query` hooks + axios clients
- Test: Vitest for the card + the settings sections

- [ ] **Step 1: Write the failing tests** — the send confirmation for an `internal_transfer` shows the recipient display name + `@handle`, "Instant", and no network-fee row; the PayID section shows the user's `@handle` with a copy button + one-time-change control; the public-nicknames section lists/adds/removes aliases.
- [ ] **Step 2: Run** the web tests → FAIL.
- [ ] **Step 3: Implement** — extend the outcome mapper's send confirmation to carry the internal-transfer fields; build the two Settings sections (TanStack Query hooks over `GET/POST/DELETE /profile/public-nicknames` + `PATCH /profile/payid`; forms via zod+RHF from contracts). Money display via `formatFiat` where relevant.
- [ ] **Step 4: Run** the web tests + `pnpm --filter @handshake-agent/web typecheck` → PASS.
- [ ] **Step 5: Commit** `feat(web): internal-transfer confirmation card + PayID/public-nickname settings`.

---

## Task 12: Full-gate sweep + visual verify

- [ ] **Step 1:** `pnpm lint && pnpm typecheck && pnpm test && pnpm depcruise` — all green.
- [ ] **Step 2:** `pnpm --filter @handshake-agent/api test:e2e -- internal-transfer web-chat send-raw-address` — green.
- [ ] **Step 3:** Visual verify: two tier_2 users; from A, `send 5 USDT to @<B.payId>` → confirmation shows B's name + `@handle` + instant/no-fee → PIN → execute → A debited, B credited (check both dashboards). Profile shows A's `@handle` + add a public nickname → send to it from B. Screenshot.
- [ ] **Step 4:** Final whole-branch review, then finishing-a-development-branch.

## Notes for the implementer

- **Migration-first:** Task 2 must land + backfill before Task 9 resolves handles in a live send.
- **No default misroute:** an `@`-prefixed handle that misses is a clarification, never a fallback to a saved/default beneficiary (§3.1) — Task 9's regression test guards this.
- **Ledger call shape:** read the real `buildEntry`/`EntrySpec`/sequence-threading in `ledger.ts:201-260` and match it exactly in Task 5 — do not invent a signature.
- **Instant completion:** an internal transfer settles synchronously (no settling poll, no webhook). Task 7 marks it `completed`, unlike the on-chain send's `settling`.
- **WhatsApp:** the internal-transfer proposal resolves + builds on the WhatsApp path too, but end-to-end WhatsApp execution stays gated on the Spec-1 `TODO(W2)` work.
