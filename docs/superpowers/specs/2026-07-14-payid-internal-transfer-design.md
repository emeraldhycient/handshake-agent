# Send to another Handshake user — PayID, public nicknames & internal transfer (Spec 2)

**Date:** 2026-07-14
**Status:** Approved (brainstorming) — ready for implementation plan
**Scope:** Sub-project 2 of 2. Send crypto to **another Handshake user** by their **PayID** or a **public nickname**, settled as an **internal ledger-to-ledger transfer** (a new rail distinct from the on-chain send built in Spec 1). Builds on the destination-resolver seam Spec 1 reserved.

**Predecessor:** [`2026-07-14-send-to-raw-address-design.md`](2026-07-14-send-to-raw-address-design.md) — the `SendDestination` descriptor already reserves an `internal_user` variant; `resolveSendDestination` is the seam this extends.

---

## 1. Goal

Every user gets a **PayID** — an auto-minted, human-readable handle (`@handle`) — at account creation, surfaced in their profile. A user can also create **public nicknames** (recipient-owned aliases so others can reach them — the inverse of today's private, sender-owned beneficiary nicknames). Sending *"send 5 USDT to @ada"* resolves the handle server-side to a Handshake user and settles as an **instant, feeless internal ledger transfer** — no on-chain withdrawal.

## 2. Decisions locked in brainstorming

| Decision | Choice |
| --- | --- |
| PayID assignment / format | **Auto-minted `@handle`** at signup (slug from name/email, collision-suffixed), shown in profile, **one** later change. Stored without the sigil; displayed as `@handle`. |
| Public nicknames | Additional user-owned aliases in a `PublicAlias` table; share ONE namespace with PayIDs. Add/remove is a plain session action (no PIN — it never moves money or changes the owner's destinations). |
| Recipient reveal | On the send confirmation, show a **limited display name (first name + last initial) + @handle** — like a bank name-enquiry. Anti-enumeration: exact-handle only, rate-limited, minimal reveal. |
| Settlement rail | **Ledger double-entry** (debit sender `user_wallet`, credit recipient `user_wallet`), instant, feeless. New `internal_transfer` tx type. |
| Tier gating | New **`crypto.transfer` capability, tier_2** (consistent with `crypto.send`), own velocity limits, **no on-chain cap**. |
| Carried from Spec 1 | Option A (every send confirms its destination); the model proposes / engine disposes; the model never extracts a handle as a destination (§3.1 — it's a server-resolved lookup key). |

## 3. Non-goals

- Fiat (NGN) P2P transfer — this spec is crypto (USDT) internal transfer only.
- Requesting money / payment requests (a receiver-initiated flow) — future.
- Cross-asset internal transfer (sender USDT → recipient TRX) — same-asset only.
- Discovery/search of users by handle — anti-enumeration forbids browse; exact-handle lookup only.

---

## 4. Architecture

### 4.1 PayID identity

- **Schema:** add `payId String? @unique` to `User` (`prisma/schema/02-identity.prisma`). Plain `@unique` is case-sensitive and NULL-distinct, so enforce case-insensitive uniqueness with a **raw-SQL `CREATE UNIQUE INDEX ... ON users (lower(pay_id)) WHERE pay_id IS NOT NULL`** in the migration — the ChannelIdentity precedent (`02-identity.prisma:381`).
- **Mint site:** the ONLY `user.create` is `createSignup` (`api/src/modules/auth/infrastructure/auth-user.prisma.repository.ts:44`, inside a `$transaction`). Mint the PayID there: derive a slug from `firstName`/email local-part → lowercase → strip non-`[a-z0-9_]` → truncate; insert; on `P2002` retry appending an incrementing numeric suffix (mirror the `PrismaClientKnownRequestError` handling at `bindDevice`, `auth-user.prisma.repository.ts:180`). A bounded retry (e.g. 5) then a random suffix fallback.
- **Format rules** (`PayIdSchema` in `packages/contracts/src/common.ts`): `^[a-z0-9_]{3,30}$`, a reserved-word denylist (admin, support, handshake, payid, …), stored lowercase. The `@` is display-only.
- **Backfill:** a migration/one-off CLI mints a PayID for every existing user (same slug+collision logic).
- **Surface:** widen `MeProjection` (`auth-user.repository.port.ts`) + `MeResponseSchema` (`auth.dto.ts`) and `ProfileResponseSchema` (`dto/profile.dto.ts` / `profile.service.ts`) with `payId`.
- **Change:** `PATCH /profile/payid` — a dedicated, PIN-free-but-rate-limited endpoint with its own `.strict()` `ClaimPayIdSchema` (do NOT loosen the general `UpdateProfileRequestSchema` `.strict()`). Allows **one** change (a `payIdChangedAt` guard); availability-checked against the shared namespace (§4.2).

### 4.2 Public-nickname / alias registry

- **Schema:** new `PublicAlias { id, userId, alias String, createdAt }` with a `lower(alias)` partial-unique index, `@@index([userId])`, and a per-user cap (≤5, enforced in the service).
- **Shared namespace:** an alias must be unique across BOTH `User.payId` and `PublicAlias.alias`. The claim/change services check both tables before insert (app-layer, with the per-table unique index + a retry closing the race). A PayID change likewise checks `PublicAlias`.
- **Resolver:** `resolveHandle(handle: string): Promise<{ userId, displayName, handle } | null>` — normalize (strip `@`, lowercase), look up `User.payId` then `PublicAlias.alias`; return the owner's `userId` + a **limited display name** (first name + last initial). Mirrors `beneficiaryService.resolveByNickname`'s "lookup key, never a destination" contract (`beneficiary.service.ts:348`), but resolves GLOBALLY to a user, not the caller's own beneficiaries.
- **Management:** `GET/POST/DELETE /profile/public-nicknames` (session-authed, no PIN). `POST` validates format + shared-namespace availability + the cap.
- **Anti-enumeration:** no list/search endpoint; resolution happens only inside a send turn (or a single availability check on claim), rate-limited; the reveal is name-minimal. Mirror the auth layer's enumeration discipline (`auth.service.ts` timing defences).

### 4.3 Internal-transfer settlement rail

- **Descriptor:** implement the reserved `SendDestination` variant `{ kind: 'internal_user'; recipientUserId: string; displayHandle: string }` (`proposal.service.ts`).
- **Proposal** (`createSendProposal`, `internal_user` branch): resolve the recipient's `user_wallet` for the asset's network via `getOrProvisionNetworkWallet(recipientUserId, network)` (auto-provision if absent). Guards, all before persist (§3.3):
  1. amount-floor + balance (sender) — reuse existing.
  2. **userId self-send guard** — `recipientUserId === userId` → `SelfSendError` (the address-based guard cannot catch this).
  3. **counterparty-user sanctions** — screen the recipient USER (a new `complianceService.screenCounterpartyUser({ userId: recipientUserId })`), not an address.
  4. KYC/velocity gate with `onChainSend: false` + `capability: 'crypto.transfer'` — the on-chain per-send cap does NOT apply.
  5. **no network fee** — `networkFeeCrypto: '0'`, `totalDebit: cryptoAmount`.
  - Persist `parameters`: `destinationKind: 'internal_user'`, `recipientUserId`, `recipientWalletId`, asset, cryptoAmount, `totalDebit`, NO `toAddress`. New proposal/tx `type: 'internal_transfer'`.
- **Execute** (`execution.service`, internal branch): instead of `walletService.withdraw`, post a **double-entry ledger transaction** via a new `buildInternalTransferLedgerEntries` (debit `user_wallet:senderWalletId:USDT`, credit `user_wallet:recipientWalletId:USDT`, equal amounts, nets to zero — the invariants in `ledger.ts`). No on-chain broadcast, no webhook wait; the recipient's `getAccountBalance` reflects the credit immediately. Reuse the idempotency early-return + PIN + device-bound step-up fence (identical to the on-chain send). A settlement record with both legs for admin oversight.
- **Confirmation** (`SendProposalConfirmation` or a sibling `InternalTransferConfirmation`): `recipientDisplayName`, `recipientHandle` (`@ada`), asset, cryptoAmount, `networkFeeCrypto: '0'`, `totalDebit`, `instant: true`. No masked address (there is none).

### 4.4 Send flow (web + WhatsApp)

- **Disambiguation:** a recipient token beginning with **`@`** → public/internal resolution; a plain nickname → existing private-beneficiary resolution. The model still only captures `recipientNickname` (what the user said); the `@` sigil is the server-side router.
- **`resolveSendDestination`:** if `recipientNickname` starts with `@` → `resolveHandle`. Hit → `{ resolved: true, destination: { kind: 'internal_user', recipientUserId, displayHandle } }`. Miss → `needs_beneficiary`-style clarification *"No Handshake user @ada — double-check the handle."* (never a default misroute — same §3.1 rule as Spec 1).
- **Dispatch:** the `internal_user` descriptor → `createSendProposal` internal branch → `proposal` outcome → the confirmation card (recipient name + @handle + instant + no fee) → PIN → execute.
- **Profile UI (`components/settings`):** a PayID section (your `@handle`, copy button, one-time change) + a public-nicknames manager (list/add/remove) — added as new Settings sections (orchestrator rule, root §16).
- **WhatsApp:** routes through the same `createSendProposal` internal branch; execution stays W2-gated as in Spec 1 (the resolver + proposal work; end-to-end WhatsApp send awaits W2).

## 5. Invariants preserved

- **§3.1** — the model never emits/extracts a PayID or handle as a destination; it captures `recipientNickname` (a lookup key) and the engine resolves it server-side. MCP stays read + propose only.
- **§3.1 no-misroute** — an unresolved `@handle` never falls through to a default; it surfaces a clarification.
- **§3.3** — KYC/tier/velocity + counterparty sanctions + userId self-send re-run server-side; PIN + device-bound step-up is the last checkpoint.
- **Ledger integrity** — the internal transfer's legs sum to zero; the double-entry invariants in `ledger.ts` hold; admin ledger/oversight surfaces both legs.

## 6. Error handling

In-chat clarifications (never 5xx): unknown handle, self-send, insufficient balance, counterparty sanctions block, tier/velocity gate. Reuse `proposalErrorClarification`.

## 7. Testing (TDD)

**Unit**
- `resolveHandle`: payid hit, public-nickname hit, miss, case-insensitive; minimal-reveal name.
- PayID mint in `createSignup`: slug derivation, P2002 collision-retry, random fallback.
- `PublicAlias`: add (format + shared-namespace + cap), remove, cross-namespace uniqueness vs PayIDs.
- `createSendProposal` internal branch: userId self-send → `SelfSendError`; counterparty sanctions → block; `onChainSend:false`; `totalDebit === cryptoAmount` (no fee); persists `recipientUserId`, no `toAddress`.
- `buildInternalTransferLedgerEntries`: nets to zero, debit+credit legs, both `balanceAfter` correct, sequence per account.
- `PATCH /profile/payid`: one-change guard, availability, `.strict()`.

**e2e (Testcontainers)**
- send to `@handle` → proposal → authorize → execute → **sender debited + recipient credited** (both `getAccountBalance`); recipient wallet auto-provisioned if absent.
- self-send to own `@handle` → blocked (clarification).
- unknown `@handle` → clarification, no proposal.
- PayID minted at signup + present in `/auth/me` + `/profile`; backfill mints for pre-existing users.
- public-nickname claim collides with an existing PayID → rejected.

## 8. File change map

| File | Change |
| --- | --- |
| `api/prisma/schema/02-identity.prisma` | `User.payId` + `payIdChangedAt`; new `PublicAlias` model. |
| `api/prisma/migrations/*` | payId column + `lower(pay_id)` partial-unique; `PublicAlias` + `lower(alias)` partial-unique; **backfill** existing users' PayIDs. |
| `packages/contracts/src/common.ts` | `PayIdSchema` + reserved-word list. |
| `packages/contracts/src/auth/*`, `dto/profile.dto.ts` | `payId` on `MeResponse`/`ProfileResponse`; `ClaimPayIdSchema`; public-nickname DTOs. |
| `api/src/modules/auth/infrastructure/auth-user.prisma.repository.ts` | mint PayID in `createSignup` (collision-retry); select in `loadMe`. |
| `api/src/modules/identity/**` (or a new `handles` service) | `resolveHandle`; PublicAlias service; `PATCH /profile/payid`; public-nickname endpoints. |
| `api/src/modules/transactions/application/proposal.service.ts` | `internal_user` branch (self-send/counterparty/no-fee); `internal_transfer` type. |
| `api/src/modules/transactions/domain/ledger.ts` | `buildInternalTransferLedgerEntries`. |
| `api/src/modules/transactions/application/execution.service.ts` | internal settlement branch (ledger post, no withdraw). |
| `api/src/modules/compliance/**` | `screenCounterpartyUser`. |
| `api/src/modules/chat/application/web-chat.service.ts` | `resolveSendDestination`: `@`-sigil → `resolveHandle` → `internal_user` / clarification. |
| `web/components/settings/**` | PayID section + public-nicknames manager. |
| `web/components/chat/cards/**` | internal-transfer confirmation card (recipient name + @handle + instant + no fee). |

## 9. Rollout / notes

- Ship the migration (+ backfill) first so every user has a PayID before the send path resolves handles.
- The `crypto.transfer` capability flag is registered in the layered config (root §7), default tier_2, admin-toggleable.
- The Spec-1 WhatsApp `TODO(W2)` still gates end-to-end WhatsApp for internal transfer too.
