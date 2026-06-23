# WhatsApp Outbound Vertical (receive · sell · send) + mock KYC — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`. Builds on the completed buy vertical (`2026-06-22-whatsapp-staging-vertical.md`).

**Goal:** Add the remaining money flows so a WhatsApp user can **receive** USDT (deposit), **sell** USDT→NGN (off-ramp payout), and **send** USDT on-chain — plus a **mockable KYC onboarding** that turns an unlinked Contact into a verified Tier-1 User (real provider plugs in later). Same safety architecture as buy.

**Reuse from buy (do NOT rebuild):** the deterministic engine spine (proposal → directive → PIN → execute → atomic settle → receipt), `DirectiveService`, `PinService`, ledger domain, Flow E2E crypto + endpoint pattern, `flow_token` signer, provider ports (`IWalletProvider` Blockradar, `IPaymentProvider` Flutterwave), `KycGateService` (server-side gate), `ConversationService` routing, the contracts intents (`SendCryptoIntent`, `ReceiveCryptoIntent`, `SellCrypto…` — extend as needed), Testcontainers e2e helper.

## Global Constraints (same as buy — binding)

- §3.1 model-proposes/engine-disposes; §3.2 agent no DB; §3.3 server-side KYC/velocity at execute; one-shot signed directive + PIN (+ **step-up for send**); §3.5 Flow E2E for secrets, webhook verification; idempotency end-to-end; decimal-safe money (BigInt/string, no floats); generated Prisma enums (not `as never`); domain pure; depcruise clean (no cycles); TDD with real-Postgres e2e.
- **Money-OUT adds new mandatory guards:** balance sufficiency (debit ≤ available), and for **send**: destination address validation, beneficiary first-use cooling-off (`firstUseLockedUntil`), Travel-Rule capture above a threshold (`TravelRuleData`), sanctions screening (`ComplianceEvent`). These are safety-critical, not optional.

---

## FLOW R — Receive (deposit address + on-chain deposit settlement)

### Task R1: receive_crypto routing → deposit address

- ConversationService routes `receive_crypto` (linked user) → `WalletService.getOrProvisionUsdtTronWallet(userId)` → reply with the address + asset/network + a "send only USDT on TRON; other assets/networks are lost" warning. Unlinked contact → KYC ask. Read-only (no proposal/engine). Unit + conversation e2e.

### Task R2: Blockradar deposit webhook → credit

- `wallets/presentation/blockradar-webhook.controller.ts`: verify `x-blockradar-signature` (HMAC-SHA512 keyed by the API key — reuse `hmacHex('sha512', apiKey, rawBody)`); parse `deposit.success` (txHash = `hash`, amount, address, asset); dedup by `txHash` (`DepositConfirmation @unique`); in one `$transaction` credit via the ledger (user_wallet USDT credit + clearing/treasury counter) + upsert `WalletBalance` + write `DepositConfirmation(confirmed)`; notify the user (sendText). Ack-then-process (200; 401 on bad signature). Idempotent on `txHash`. Unit + Testcontainers e2e (incl. replay no-double-credit).

---

## FLOW K — Mock KYC onboarding (Contact → verified Tier-1 User)

### Task K1: KYC provider port + mock adapter

- `identity/application/ports/kyc-provider.port.ts` — `KYC_PROVIDER` + `IKycProvider { verify(input: { nin?, bvn?, firstName, lastName, dateOfBirth? }): Promise<{ approved: boolean; tier: KycTier; reference: string; reason?: string }> }`.
- `identity/infrastructure/mock-kyc.provider.ts` — auto-approves (Tier-1) when required fields present; rejects otherwise. Config flag `KYC_MOCK_MODE` (env, default true). Real provider later implements the same port. Unit tests.

### Task K2: KycService — upgrade Contact → verified User + PIN

- `identity/application/kyc.service.ts` — `completeVerification(input: { contactOrChannelAddress, nin?, bvn?, firstName, lastName, pin }): Promise<{ userId }>`:
  - resolve/create the `User`; call `KYC_PROVIDER.verify`; on approve: persist `KycProfile(verified, tier_1)`, set `User.kycStatus=verified, kycTier=tier_1`, link the Contact + its `ChannelIdentity` to the User (verificationStatus verified), set the PIN via `PinService.setPin`, optionally bind a device. Atomic. On reject → typed error.
- Repos as needed (KycProfile, user upgrade, contact link). Unit + Testcontainers e2e (contact → verified user, PIN set, channel linked).

### Task K3: KYC Flow (onboarding via WhatsApp Flow)

- ConversationService: when an unlinked Contact attempts a transaction (or messages a KYC intent), send the **KYC Flow** (reuse sendFlow + flow_token; screen collects NIN/BVN/name + PIN). Flow endpoint `data_exchange` (KYC screen) → `KycService.completeVerification` (secrets only via Flow E2E) → success screen. (If `WHATSAPP_FLOW_ID`/KYC flow id unset → text fallback explaining KYC is required.) Reuse the Task 6.2 flow controller (add a KYC action branch). Unit + e2e.

---

## FLOW S — Sell (USDT → NGN off-ramp)

### Task S1: sell quote + contracts

- `QuotesService.quoteSell({ asset, cryptoAmount, fiatCurrency })` → NGN out after spread/fee (mirror buy pricing, inverse direction); contracts `SellQuoteOutput` + `SellProposalConfirmation`. Decimal-safe. Unit.

### Task S2: Flutterwave payout in the provider

- Extend `IPaymentProvider`: `createPayout(input: { amount, currency:'NGN', reference, bankAccount: { accountNumber, bankCode, accountName } }): Promise<{ providerRef, status }>` + `verifyPayout(reference)`. Implement against Flutterwave Transfers API (`POST /transfers`, verify). Mock HTTP in tests. Unit. (⚠️ verify the exact Transfers payload against live docs at build time.)

### Task S3: bank beneficiary (payout destination)

- Beneficiary handling for `bank_account` (add/select; the `Beneficiary` model). Minimal: a capture step (or seeded for tests) + a resolver `getDefaultBankBeneficiary(userId)`. Step-up on add (reuse directive). Unit + e2e.

### Task S4: sell proposal + execute + settle

- `ProposalService.createSellProposal` (sell quote + **balance check: user's USDT ≥ cryptoAmount** + KYC/velocity gate + beneficiary) → confirmation Flow (reuse).
- `ExecutionService.executeSell` (gauntlet: proposal/expiry, re-quote drift, KYC/velocity, **balance sufficiency**, directive consume, PIN; create `Transaction(sell, settling)`; reserve/debit USDT) → `settleSellPayout` (Flutterwave payout → on success atomic: ledger USDT debit + NGN payout entries (balanced), WalletBalance debit, Transaction completed, receipt) → notify. Idempotent. Unit + Testcontainers e2e (balanced ledger, insufficient-balance rejected, idempotent).

---

## FLOW N — Send (on-chain USDT/TRON withdrawal)

### Task N1: Blockradar withdraw + send quote

- Extend `IWalletProvider`: `withdraw(input: { addressId, toAddress, amount, asset }): Promise<{ providerReference, txHash?, status }>`. `QuotesService.quoteSend` (network fee). Validate TRON address format. Mock HTTP in tests. Unit. (⚠️ verify Blockradar withdraw payload at build time.)

### Task N2: crypto beneficiary + cooling-off + sanctions

- `Beneficiary(crypto_address)` add/select with **first-use cooling-off** (`firstUseLockedUntil`) and address validation; a sanctions/compliance screen on the destination (`ComplianceEvent` — mockable screening port, like KYC). Unit + e2e (cooling-off blocks, screening blocks a flagged address).

### Task N3: send proposal + execute + settle (with Travel-Rule + step-up)

- `ProposalService.createSendProposal` (balance + network fee + KYC/velocity + beneficiary cooling-off + **Travel-Rule capture above threshold** `TravelRuleData` + sanctions) → confirmation Flow.
- `ExecutionService.executeSend` (gauntlet incl. **PIN + step-up**, balance, cooling-off, sanctions, directive; create `Transaction(send, settling)`; debit USDT) → Blockradar `withdraw` → settle (ledger USDT debit + network fee, `onChainTxHash`, Transaction completed, receipt) → notify. Idempotent. Unit + Testcontainers e2e (balanced ledger, cooling-off/sanctions/insufficient-balance rejected, idempotent).

---

## FLOW W — Wiring + acceptance

### Task W1: ConversationService routes sell/send/receive + KYC onboarding

- Extend routing: `sell_crypto`/`send_crypto` → respective proposal + confirmation Flow; `receive_crypto` → address; unlinked contact on any → KYC onboarding Flow. Update the Flow endpoint to dispatch to executeSell/executeSend (by proposal type) on data_exchange. Unit + e2e.

### Task W2: capstone e2e per flow

- Extend `buy-vertical.e2e-spec.ts` (or new specs): full HTTP drive of receive (deposit webhook), sell (→ payout settle), send (→ on-chain settle), and a fresh-contact → KYC Flow → verified → buy. Faked providers/LLM; real engine. Balanced ledgers + idempotent replays.

## Sequence (dependency order)

Receive (R1,R2) → mock KYC (K1,K2,K3) → Sell (S1–S4) → Send (N1–N3) → Wiring/acceptance (W1,W2).
Rationale: receive/KYC fund + onboard a testable user; sell/send spend; each reuses the buy spine.

## Notes

- Provider payloads for Flutterwave **Transfers** (payout) and Blockradar **withdraw** must be verified against live docs during their tasks (we only used collection + address-create for buy).
- KYC and sanctions are **mockable ports** now (KYC_MOCK_MODE), real providers plug in later — same pattern as the deterministic engine isolating the LLM.
- Receipts/ledger account mapping for sell/send differ from buy (money/crypto OUT) — define balanced legs per flow in the ledger domain (extend `ledger.ts` with `buildSellLedgerEntries`/`buildSendLedgerEntries`/`buildDepositLedgerEntries`).
