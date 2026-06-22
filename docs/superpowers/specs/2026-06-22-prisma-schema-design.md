# Prisma schema design — Handshake Agent

**Date:** 2026-06-22 · **Status:** Implemented (initial migration applied & verified) · **Owner:** backend

Design record for the full database schema (FND-02 + the data-model foundation every
later phase builds on). Read alongside the root [`CLAUDE.md`](../../../CLAUDE.md) (§3
invariants, §7 config), [`api/CLAUDE.md`](../../../api/CLAUDE.md) (Prisma 7 specifics),
the ADRs, and [`plan/backlog.md`](../../../plan/backlog.md).

## 1. Scope

Model the **entire** target schema in one initial migration (all 12 feature domains,
**50 models, 71 native enums**), rather than growing it per-ticket. Rationale: doing it
once forces every cross-module foreign key and enum conflict to be resolved up front
(the discovery pass found the same concept — `Quote`/`Proposal`/`DirectiveGrant`,
`Channel`, `VerificationStatus` — modelled inconsistently across domains; that is the
single largest latent-defect source and is now resolved). Per-ticket work (IDN/WAL/TXN/…)
adds **behaviour** (services, guards, the engine) on top of a stable data model; it does
not keep re-shaping tables.

Files: [`api/prisma/schema/`](../../../api/prisma/schema) — `_base.prisma` (generator,
datasource, shared symbolic enums) + numbered per-module files mirroring
`api/src/modules/<feature>`. Config: [`api/prisma.config.ts`](../../../api/prisma.config.ts)
points `schema` at the folder. Initial migration:
`api/prisma/migrations/20260622142238_init_full_schema/`.

## 2. Cross-cutting conventions (locked, see `_base.prisma` header)

| Concern                      | Decision                                                                                                                                                                                                                                                                                                                                                                                     |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **IDs**                      | `String @id @default(uuid(7)) @db.Uuid`. Time-sortable uuid v7 (index locality on append-heavy tables); a valid uuid matching contracts' `.uuid()`. Generated **client-side by Prisma** (the typed client is the only sanctioned DB door, §3.2) — raw-SQL inserts must supply an id.                                                                                                         |
| **Crypto / engine money**    | `Decimal @db.Decimal(38,18)` — covers BTC (8dp), USDT (6dp) and FX/fee intermediates without in-flight rounding. App math via `Decimal.js`, never float.                                                                                                                                                                                                                                     |
| **Fiat-only display**        | `Decimal @db.Decimal(38,2)` (NGN).                                                                                                                                                                                                                                                                                                                                                           |
| **Fees / spread**            | `Int` basis points (mirrors contracts `spreadBps`/`processingFeeBps`).                                                                                                                                                                                                                                                                                                                       |
| **Snapshots**                | Crypto amounts/rates that must byte-round-trip (`Quote.cryptoAmount`/`fxRate`/`baseRate`, `cryptoHeld`) are `String`, not arithmetic operands.                                                                                                                                                                                                                                               |
| **Enums**                    | Prisma native enums. **UPPER** for symbolic constants (`SupportedAsset`, `FiatCurrency`, `Network`) mirroring contracts; **lower_snake** for status/type/action enums (mirrors the `BuyOrderStatus`/`IntentSchema` precedent → DB value === Zod value === wire value, no mapping layer, §8).                                                                                                 |
| **Timestamps**               | `@db.Timestamptz`, UTC. `createdAt` + `updatedAt @updatedAt` on mutable tables; append-only tables get `createdAt` (or a domain-time field like `capturedAt`/`evaluatedAt`) only.                                                                                                                                                                                                            |
| **Soft-delete**              | `deletedAt DateTime?` **only** on `User`, `Beneficiary`, `ChannelIdentity`, `Contact`. Everywhere else a status terminal state — no hard deletes in the money/identity/audit path.                                                                                                                                                                                                           |
| **Idempotency**              | `idempotencyKey String? @unique @db.Uuid` on side-effecting tables (`Quote`, `Proposal`, `SettlementOutbox`); **non-nullable** `@unique` on the money-movers (`Transaction`, `TicketOrder`). Nullable-unique is the intended "dedupe when a client key is present" idiom; the hard at-most-once guarantee lives on `Transaction.idempotencyKey`.                                             |
| **Table naming**             | PascalCase models / camelCase fields → snake*case **table** names via `@@map`. **Column names stay camelCase** (Prisma default): the typed client uses field names, Prisma 7 has no global snake_case setting, and ~400 per-column `@map` would be noise (§13 KISS). *(Deviation from the originally-stated "snake*case columns" — see §7.)*                                                 |
| **Audit / admin decoupling** | The immutable `AuditLog` is **relation-free** (plain indexed `actor`/`subject`/`actorUserId`/`actorAdminId` strings) so it survives soft-deletes and nothing cascades into the chain. Cross-module admin attribution (`reviewedByAdminId`, `dispositionAdminId`, …) uses plain `String?` refs, keeping `AdminUser`'s back-relation surface small. The operational graph uses real relations. |

## 3. Modules & models (50)

- **config** (`00`): `AppSetting` (layered DB-admin config), `OutboxMessage` (transactional outbox, FND-14).
- **audit/compliance** (`01`, 8): `AuditLog` (hash-chained spine), `ComplianceEvent`, `SanctionsRecord`, `AmlRule`, `AmlRuleEvaluation`, `TravelRuleData`, `VelocityCounter`, `ComplianceReport`.
- **identity** (`02`, 7): `User` (hub), `KycProfile`, `Device`, `Session`, `Beneficiary` (unified bank+crypto), `Contact`, `ChannelIdentity`.
- **admin/RBAC** (`03`, 6): `AdminUser`, `AdminSession`, `Role`, `Permission`, `RolePermissionAssignment`, `AdminInvitation`.
- **wallets** (`04`, 5): `Wallet`, `WalletBalance`, `DepositConfirmation`, `WithdrawalPolicy`, `WalletSyncLog`.
- **pricing/treasury** (`05`, 4): `Quote` (canonical), `PriceSnapshot`, `TreasuryExposure`, `TreasuryAlert`.
- **engine** (`06`, 6): `Proposal` (canonical), `Transaction`, `LedgerEntry`, `SettlementOutbox`, `CompensationRecord`, `DirectiveGrant` (canonical).
- **receipts** (`07`, 1): `Receipt`.
- **conversations/agent/channels** (`08`, 6): `Conversation`, `ConversationMessage`, `MessageIntent`, `ConversationReply`, `ChannelOutboundDispatch`, `HandoffToken`.
- **notifications** (`09`, 3): `Notification`, `NotificationPreference`, `NotificationTemplate`.
- **tickets** (`10`, 2): `TicketOrder`, `TicketRefund`.

## 4. The money-safety spine (§3.1 model-proposes / engine-disposes)

```
ConversationMessage ──1:1── MessageIntent      (validated NLU output; never executable)
                                  │ 1:1
                                  ▼
User ──1:N──► Proposal ──N:1── Quote            (re-validated at execute, never trusted)
                 │ 1:N            (engine owns Quote/Proposal/DirectiveGrant)
                 ├── DirectiveGrant              (one-shot, signed, nonce+expiry — PIN/confirm)
                 │ 1:1
                 ▼
              Transaction ──1:N── LedgerEntry    (double-entry: signed amount, direction,
                 │                                 per-account `sequence`, sum-to-zero)
                 ├──1:1── Receipt                 (immutable, signed, sequential number)
                 ├──1:N── SettlementOutbox        (durable, idempotent external settlement)
                 ├──1:1── TravelRuleData / 1:N ComplianceEvent
                 └──1:1── CompensationRecord (refund/reward)
```

Identity resolution never trusts the phone: `ChannelIdentity(channel,address) → Contact XOR User`; `Conversation` keys on the resolved identity (DB CHECK enforces the XOR); `channel` is a per-message audit tag only.

## 5. Conflict resolutions (from the discovery pass)

- **One canonical `Quote`, `Proposal`, `DirectiveGrant`** (in pricing/engine); agent, channels and compliance reference them by FK — not per-domain copies.
- **Unified `Beneficiary`** (type-discriminated bank/crypto); the separate `WalletAddressBook` was dropped.
- **Single `VelocityCounter`** (`Decimal(38,18)`); supersedes the engine's `TransactionVelocityRecord`.
- **`AuditLog` absorbs admin-audit** (`AdminAuditBinding` dropped) — every admin mutation writes an `AuditLog` row with `actorAdminId` + reason.
- **Enums deduplicated & renamed** to unique names with reconciled value supersets (`Channel` = {whatsapp,web,email,sms,in_app}; `VerificationStatus`; `DirectiveGrantStatus`; distinctly-named `LedgerDirection`/`PermissionAction`/`WalletSyncStatus`/`ReceiptDeliveryStatus`/etc.). 71 enums, **zero name collisions**.

## 6. Constraints Prisma can't express (added as raw SQL in the migration)

1. **Partial unique** — one active `ChannelIdentity` per `(channel, channelAddress)` `WHERE deletedAt IS NULL` (a composite unique including the nullable `deletedAt` would be defeated by Postgres NULL-distinctness).
2. **Partial unique** — `beneficiaries (userId, cryptoAddress) WHERE type='crypto_address' AND deletedAt IS NULL`.
3. **XOR CHECK** — `conversations`: exactly one of `contactId`/`userId` is set.

**Append-only immutability** (`AuditLog`, `LedgerEntry`, `Receipt`, `DepositConfirmation`,
`SanctionsRecord`, `*Evaluation`, `TravelRuleData`, `PriceSnapshot`) is enforced in the
infrastructure repository layer (no update/delete path), per AUD-01 — Prisma can't express
it. DB triggers are a future hardening option, deferred to AUD-01.

## 7. Notable decisions / deviations

- **camelCase columns** (not snake_case) — see §2 naming. Reverse later with per-column `@map` only if a raw-SQL consumer needs it.
- **Prisma 7 `prisma-client` generator requires a driver adapter** (`@prisma/adapter-pg`). The runtime client connects via the adapter (no baked-in engine / `datasourceUrl`); CLI `migrate`/`generate` use `prisma.config.ts`. FND-02's `PrismaService` must instantiate with `new PrismaClient({ adapter: new PrismaPg(...) })`. `@prisma/adapter-pg` + `pg` added as deps.
- **BTC is a forward `SupportedAsset` value, flag-off** (Blockradar has no native BTC, ADR-0006). Schema carries it; capability stays disabled via the `AppSetting` registry.
- **KYC/beneficiary/MFA secrets** are plain `String?` columns **encrypted at rest by the application** (NFR-1) — Prisma has no encrypted type; the boundary is the infrastructure layer, consistent with PIN/token hashing.

## 8. Verification performed

- `prisma format` + `prisma validate` — clean.
- Adversarial multi-agent review (5 dimensions × adversarial verify): 44 raw findings → 3 confirmed (all timestamp-convention; fixed: `VelocityCounter` createdAt/updatedAt, `ConversationMessage`/`HandoffToken` createdAt), 41 dismissed as contradicting intentional conventions.
- Migration **applied to real Postgres** (`migrate deploy`): 51 tables, 71 enums, 55 FKs, both partial-unique indexes and the XOR CHECK present; smoke-tested the XOR rejection, partial-unique active-vs-soft-deleted behaviour, audit-chain linkage, and idempotency uniqueness.
- Testcontainers integration test: [`api/test/prisma-schema.e2e-spec.ts`](../../../api/test/prisma-schema.e2e-spec.ts) (`test:e2e` lane; requires Docker — runs in CI).
- `tsc --noEmit` + ESLint — clean.

## 9. Follow-ups (own tickets)

- **FND-02 finish:** `PrismaService` (adapter-based connect + shutdown hooks), wired into Nest; `dependency-cruiser` rule forbidding `generated/prisma`/`@prisma/client` outside `infrastructure`.
- **AUD-01:** append-only repository guards (+ optional DB triggers) and the hash-chain compute/verify service.
- **Contracts sync:** as each DTO ticket lands (sell/send/swap order statuses, channel/UI-directive contracts), add the matching Zod enum in `packages/contracts` with values **identical** to the DB enum (no mapping).
- **Config seed:** `AppSetting` JSON defaults (fees, limits, flags) per FND-04/05.
