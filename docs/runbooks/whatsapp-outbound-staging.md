# Runbook — WhatsApp outbound flows staging (RECEIVE · SELL · SEND + KYC + beneficiaries)

Companion to [`whatsapp-buy-staging.md`](./whatsapp-buy-staging.md). That document covers prerequisites, secrets, tunnel setup, Postgres, and the BUY (NGN→USDT) flow. Read it first — everything there applies here unchanged. This runbook extends it for the four additional flows:

| Flow                 | User intent                                                    | Settlement webhook                                                   |
| -------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------- |
| RECEIVE (deposit)    | "deposit address" / "receive usdt"                             | `POST /webhooks/blockradar` (`deposit.success`)                      |
| SELL (USDT→NGN)      | "sell 10 usdt"                                                 | `POST /webhooks/flutterwave` (`transfer.completed`)                  |
| SEND (on-chain USDT) | "send 5 usdt to T…"                                            | `POST /webhooks/blockradar` (`withdraw.success` / `withdraw.failed`) |
| KYC web handoff      | triggered by any transaction attempt from an unverified number | `POST /kyc/complete` (web → API)                                     |

---

## 1. Additional env vars to add to `api/.env`

The buy runbook lists the core secrets. The outbound flows need these on top:

| Var                            | How to get it                                                                                  | Gates                                                                                                                                                                                    | Default          |
| ------------------------------ | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `WHATSAPP_BENEFICIARY_FLOW_ID` | Publish the beneficiary add/select Flow in the Meta WhatsApp Flows dashboard; copy the Flow ID | Beneficiary add/select in-thread form (sell → bank account; send → crypto address). Empty = Flow not published; controller sends a plain-text "please add a beneficiary" message instead | `''` (optional)  |
| `WEB_APP_BASE_URL`             | The public URL of the web frontend (e.g. `https://handshake.example.com`)                      | KYC web-handoff CTA button: `${WEB_APP_BASE_URL}/kyc?t=<token>`. Empty = falls back to a plain-text "visit our web app to verify" message                                                | unset (optional) |
| `KYC_MOCK_MODE`                | Set to `'true'` for staging                                                                    | When `'true'`, the `MockKycProvider` auto-approves any submission that has NIN + BVN + first/last name. Flip to `'false'` once a real NIN/BVN provider is wired                          | `'true'`         |

> `WHATSAPP_FLOW_ID` (the confirmation + PIN Flow — already listed in the buy runbook) is also required for sell and send. Sell uses the same Flow at screen `SELL_CONFIRM`; send at screen `SEND_CONFIRM`. Both fall back to a plain-text itemized confirmation when the var is unset.

### Vars in the schema that are not yet in `.env.example`

The following vars exist in `api/src/core/config/env.schema.ts` but are absent from `api/.env.example`. Operators should add placeholders for them:

```
WHATSAPP_FLOW_ID=
WHATSAPP_BENEFICIARY_FLOW_ID=
WHATSAPP_APP_ID=
WHATSAPP_TEST_RECIPIENT=
KYC_MOCK_MODE=true
WEB_APP_BASE_URL=
```

---

## 2. Webhook URL checklist (register all five with the respective provider)

All five endpoints must be reachable via the public HTTPS tunnel (`cloudflared` or `ngrok`) you set up for the buy flow.

| Provider                  | Dashboard location                              | URL to register                         | Verifies via                                                                            |
| ------------------------- | ----------------------------------------------- | --------------------------------------- | --------------------------------------------------------------------------------------- |
| Meta (inbound)            | WhatsApp → Configuration → Callback URL         | `https://<tunnel>/whatsapp/webhook`     | `X-Hub-Signature-256` + `WHATSAPP_APP_SECRET`; `hub.verify_token` for GET handshake     |
| Meta (Flow data exchange) | WhatsApp Flows → your published Flow → endpoint | `https://<tunnel>/whatsapp/flow`        | RSA Flow E2E (`WHATSAPP_FLOW_PRIVATE_KEY`)                                              |
| Flutterwave               | Dashboard → Settings → Webhooks                 | `https://<tunnel>/webhooks/flutterwave` | `verif-hash` header = `FLUTTERWAVE_WEBHOOK_SECRET`                                      |
| Blockradar                | Dashboard → Webhooks (master wallet)            | `https://<tunnel>/webhooks/blockradar`  | HMAC-SHA512 of raw body keyed by `BLOCKRADAR_API_KEY` (header `x-blockradar-signature`) |

The Flutterwave webhook handles **both** buy (`charge.completed`) and sell (`transfer.completed`). The Blockradar webhook handles **both** receive (`deposit.success`) and send (`withdraw.success` / `withdraw.failed`). No additional endpoints are needed.

---

## 3. Admin-tunable config (JSON defaults layer — no env vars needed)

The following values live in `api/src/core/config/configuration.ts` as JSON defaults (committed). They are admin-tunable at runtime via the DB AppSetting layer once that is built. For staging you can edit the JSON defaults if needed:

| Key                                           | Default     | What it controls                                                                                          |
| --------------------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------- |
| `pricing.assets.USDT.buySpreadBps`            | `150`       | Buy spread (platform markup, bps)                                                                         |
| `pricing.assets.USDT.sellSpreadBps`           | `150`       | Sell spread (platform markdown, bps)                                                                      |
| `pricing.processingFeeBps`                    | `100`       | Processing fee on buy/sell (bps)                                                                          |
| `catalog.networks.TRON.networkFeeCrypto.USDT` | `'1'`       | Flat USDT fee deducted per on-chain send                                                                  |
| `compliance.travelRuleThresholdNgn`           | `1_000_000` | NGN equivalent above which a send proposal sets `requiresTravelRule: true`                                |
| `compliance.sanctionsDenylist`                | `[]`        | Crypto addresses flagged by `MockSanctionsScreener`; add test addresses here to exercise the blocked path |
| `catalog.sendQuoteExpiresInSec`               | `30`        | Validity window for send quotes (seconds)                                                                 |
| `directive.ttlSeconds`                        | `300`       | Directive grant TTL (5 min — time the user has to complete the Flow)                                      |

---

## 4. Seeding a test user (all four flows)

The buy runbook covers seeding a Tier-1 KYC-verified user with a bound device + PIN. The same seed applies to all four flows. For the sell and send flows you additionally need beneficiaries (see §§6 and 7 below for the in-thread beneficiary-add path, or seed directly):

```bash
# Prisma Studio shortcut — add a Beneficiary row linked to the test User:
# For SELL: type='bank_account', accountNumber='0123456789', bankCode='058', accountName='Test User', verified=true
# For SEND: type='crypto_address', address='T<33 Base58 chars>', network='TRON', asset='USDT', firstUseLockedUntil=null (or a past date)
```

The `firstUseLockedUntil` cooling-off period for crypto beneficiaries (set on first add via the Flow) will block immediate sends if seeded via the Flow path. Override to a past date when seeding directly for fast staging iteration.

---

## 5. RECEIVE — deposit address + webhook settlement

**What the user sends:** any message meaning "receive" or "deposit address" (e.g. "receive usdt", "deposit address").

**What happens:**

1. ConversationService routes the `receive_crypto` intent.
2. KYC guard: if the number is unverified → sends a CTA button linking to `${WEB_APP_BASE_URL}/kyc?t=<token>` (or a plain-text fallback if `WEB_APP_BASE_URL` is unset). See §8 for the KYC flow.
3. Happy path: `WalletService.getOrProvisionWallet('USDT', 'TRON')` provisions a Blockradar child address (first request only). Returns the on-chain address as a plain-text reply: "Your USDT deposit address (TRON (TRC-20)): T…".
4. **No proposal, no directive, no Flow** — receive is read-only.

**Settlement (incoming deposit):**

Blockradar calls `POST /webhooks/blockradar` with event `deposit.success`. The controller:

- Verifies HMAC-SHA512 (`x-blockradar-signature` header keyed by `BLOCKRADAR_API_KEY`).
- Resolves the wallet by `data.recipientAddress`.
- Calls `settleDepositAtomic` (idempotent by on-chain `txHash`; creates a `deposit` Transaction, double-entry ledger, `WalletBalance` credit, signed `Receipt`).
- Sends a WhatsApp receipt: "✅ Deposit received — {amount} {asset} credited. New balance: {balance}. Receipt: {number}."

**How to trigger in sandbox:** Send real TRC-20 USDT to the child address in sandbox mode, or use Blockradar's dashboard replay / webhook simulator to POST a `deposit.success` body. Body shape:

```json
{
  "event": "deposit.success",
  "data": {
    "hash": "txhash123",
    "amount": "10.000000",
    "recipientAddress": "T<your child address>",
    "senderAddress": "T<sender>",
    "asset": { "symbol": "USDT", "network": { "name": "TRON" } },
    "id": "webhook-uuid"
  }
}
```

Sign the body: `x-blockradar-signature: <HMAC-SHA512(body, BLOCKRADAR_API_KEY)>`.

**Verify (DB):**

- `Transaction` row with `type='deposit'`, `status='completed'`.
- Balanced `LedgerEntry` rows (two entries summing to zero for the same currency per transaction).
- `Receipt` row with `receiptNumber` set.
- `WalletBalance.balance` incremented by the deposit amount.
- `DepositConfirmation` row keyed by `txHash` (idempotency guard — re-sending the same `txHash` is a no-op).

---

## 6. SELL — USDT→NGN via Flutterwave payout

**Prerequisites:** user must have at least one verified `bank_account` beneficiary. Add one via the in-thread beneficiary Flow (§6a) or seed directly in Prisma Studio (see §4).

**What the user sends:** e.g. "sell 10 usdt", "convert usdt to naira".

**What happens:**

1. `sell_crypto` intent → KYC guard (same as §5) → resolve default `bank_account` beneficiary.
2. **No beneficiary found:** ConversationService either sends the `WHATSAPP_BENEFICIARY_FLOW_ID` Form (bank-account add/select screen, seeded with the sell's `currency`) or — if the var is unset — sends a plain-text message: "Please add a bank account to sell crypto. Once added, send your sell request again." The Flow endpoint handles `beneficiary_add` (bank account fields: `accountNumber`, `bankCode`, `accountName`, `label`, `currency`, plus a `pin` collected on the E2E Flow's PIN screen — never plaintext chat, §3.5) and `beneficiary_select` (selecting an existing one).
3. **Beneficiary found:** `ProposalService.createSellProposal` is called; a `SELL_CONFIRM` screen Flow (or itemized text fallback) is sent.
4. User completes the Flow (confirms + enters PIN). Flow endpoint verifies the `flow_token`, resolves proposal type `'sell'`, calls `ExecutionService.executeSell` (KYC + velocity gate re-checked server-side; directive consumed; USDT debited from `WalletBalance`; Flutterwave payout initiated).
5. Engine sends a provisional reply: "Your payout has been initiated. You will be notified once it completes."

**Settlement (Flutterwave payout):**

Flutterwave calls `POST /webhooks/flutterwave` with event `transfer.completed`. The controller:

- Verifies `verif-hash` header against `FLUTTERWAVE_WEBHOOK_SECRET` (fail-closed in all envs).
- Routes on `data.status`:
  - `SUCCESSFUL` → `ExecutionService.settleSellPayout` (re-verifies server-side via `IPaymentProvider.verifyPayout`; finalizes ledger; creates signed `Receipt`; sends WhatsApp receipt: "✅ Your crypto purchase is complete! Receipt: {number}. Your USDT has been credited…").
  - `FAILED` → `ExecutionService.settleSellPayout` (refund path: USDT credited back to wallet; compensation recorded; WhatsApp failure notice sent).
- Matching is by `data.reference` = the idempotency key written at `executeSell` time (same as `transactionId`).

**Caution on Flutterwave Transfers in sandbox:** the Flutterwave sandbox may not accurately simulate NGN bank payouts. Use the dashboard's transfer retry/simulate tooling or contact Flutterwave sandbox support to fire `transfer.completed`. The settlement path is idempotent — safe to retry.

**Verify (DB):**

- `Transaction.status='completed'` (or `'failed'` with a `LedgerEntry` refund).
- `WalletBalance` debited by `cryptoAmount` on `executing`, `completed` on settlement.
- `Receipt` row with `receiptNumber` set.
- `SettlementOutbox.status='completed'`.

### 6a. Beneficiary add via WhatsApp Flow (SELL path — bank account)

When `WHATSAPP_BENEFICIARY_FLOW_ID` is set and no default bank beneficiary exists:

1. User receives the beneficiary Form (add/select screen). The sell's payout `currency` is seeded into the Flow (default NGN); the bank **country is derived server-side** from that currency — a client-supplied country is never trusted (§3.3).
2. User fills in `accountNumber`, `bankCode` (e.g. `'058'` for GTBank), `accountName`, optional `label`, and their transaction **PIN** on the Flow's PIN screen (E2E-encrypted; §3.5).
3. Flow endpoint `data_exchange` action `beneficiary_add` runs the **R2 step-up chain** first — `PinService.verifyPin` (lockout-protected) + a device-bound step-up recorded against the user's pinned device (fail-closed: no device → ERROR screen, nothing persisted) — then `BeneficiaryService.addBankAccount`. For NGN the account name is resolved via name-enquiry and persisted `verified`; for a currency whose rail cannot run name-enquiry (non-NG) the account is persisted `unverified` and the reply notes the name could not be auto-verified.
4. User re-sends the sell intent — now the beneficiary is found and the flow proceeds.

---

## 7. SEND — on-chain USDT via Blockradar withdraw

**Prerequisites:** user must have at least one verified `crypto_address` beneficiary with `firstUseLockedUntil` in the past (cooling-off period lifted). Add via the in-thread beneficiary Flow (§7a) or seed directly (§4).

**What the user sends:** e.g. "send 5 usdt to T…", "transfer usdt".

**What happens:**

1. `send_crypto` intent → KYC guard → resolve default `crypto_address` beneficiary.
2. **No beneficiary:** same as §6 but for crypto addresses; Flow screen `beneficiary_add` accepts `address`, `network`, `asset`, `label`, plus the `pin` collected on the E2E Flow's PIN screen (§3.5).
3. **Beneficiary found:** `ProposalService.createSendProposal` runs 7 guards in order before creating the proposal:
   - Balance ≥ `totalDebit` (`cryptoAmount + networkFeeCrypto`).
   - KYC verified + velocity not exceeded (on NGN-equivalent value).
   - Beneficiary owned by user + `AssetRegistry.validateAddress` passes.
   - Cooling-off: `firstUseLockedUntil` must be in the past.
   - Sanctions screen: `MockSanctionsScreener` checks `compliance.sanctionsDenylist` — add the target address there to test the blocked path.
   - Travel Rule: if NGN-equivalent ≥ `compliance.travelRuleThresholdNgn` (₦1,000,000), `requiresTravelRule=true` is flagged on the proposal (Travel-Rule data capture at execution).
4. `SEND_CONFIRM` screen Flow (or itemized text fallback) is sent. Send uses a `request_step_up` directive (higher-assurance step-up, not just PIN).
5. User completes Flow → `ExecutionService.executeSend` (12-step gauntlet: same guards re-checked server-side + step-up directive consumed + PIN + TravelRuleData persisted if flagged + atomic `createSendSettlingWithReserveAtomic` + Blockradar withdraw initiated).
6. Provisional reply: "Your withdrawal has been initiated. It will be confirmed on-chain shortly."

**Settlement (Blockradar withdraw):**

Blockradar calls `POST /webhooks/blockradar` with event `withdraw.success` or `withdraw.failed`. The controller:

- Verifies HMAC-SHA512 signature.
- Routes on event type:
  - `withdraw.success` → `ExecutionService.settleSendOnChain({ reference, success: true, onChainTxHash })` (finalizes ledger; creates signed `Receipt`; sends WhatsApp receipt: "✅ Your crypto send is complete! Receipt: {number}. Reply 'balance' to check.").
  - `withdraw.failed` → `settleSendOnChain({ reference, success: false })` (refund path: USDT credited back; compensation recorded; sends: "⚠️ Send failed. Your USDT has been refunded to your Handshake wallet.").
- Matching is by `data.reference` = idempotency key (= `transactionId`) passed to Blockradar at withdraw time.

**Verify (DB):**

- `Transaction.status='completed'` (or `'failed'` with refund).
- `WalletBalance` debited by `totalDebit` (`executing` → `completed`).
- `Receipt` row.
- `SettlementOutbox.status='completed'`.

### 7a. Beneficiary add via WhatsApp Flow (SEND path — crypto address)

Same Flow endpoint as §6a; discriminated by field presence (`address` present → crypto_address path):

1. User fills in `address` (TRC-20 address, validated against `^T[1-9A-HJ-NP-Za-km-z]{33}$`), `network` (`TRON`), `asset` (`USDT`), optional `label`, and their transaction `pin` on the E2E PIN screen (§3.5).
2. Flow endpoint runs the **R2 step-up chain** (PIN verify + device-bound step-up, fail-closed) then `BeneficiaryService.addCryptoAddress` → `Beneficiary` row created with `firstUseLockedUntil` set to 48 hours from now (cooling-off — additional to, not a replacement for, the step-up). For staging, update this to a past date directly in Prisma Studio to skip the wait.

---

## 8. KYC web handoff (unverified numbers)

Any intent that reaches a money-moving handler (`buy_crypto`, `sell_crypto`, `send_crypto`, `receive_crypto`) triggers the KYC guard. If the sending number is an unlinked Contact (no `User` row yet):

1. `HandoffTokenService.mintKycToken` mints a single-use `HandoffToken` (256-bit CSPRNG, 10-minute TTL, `purpose='kyc'`, bound to the WhatsApp `channelAddress`).
2. If `WEB_APP_BASE_URL` is set: `IWhatsAppSender.sendCtaUrl` sends a CTA button ("Verify now") linking to `${WEB_APP_BASE_URL}/kyc?t=<token>`. If unset: plain-text fallback ("Please visit our web app to verify your identity.").
3. The user opens the link in their browser and submits identity data (NIN, BVN, first/last name, date of birth, PIN).
4. The web app posts to `POST /kyc/complete` (public endpoint, throttled by `ThrottlerGuard`):
   - Consumes the `HandoffToken` atomically (single-use — replay safe).
   - Calls `KycService.completeVerification` → `MockKycProvider.verify` (auto-approves any submission with NIN + BVN + names when `KYC_MOCK_MODE=true`) → atomically creates the `User`, `KycProfile`, links the `ChannelIdentity`, hashes and stores the PIN.
   - Returns `{ userId, status: 'verified' }`.
5. The user then re-sends their original intent from WhatsApp — they are now resolved as a verified Tier-1 User.

**Note:** the web KYC UI (`web/` package) is a separate deliverable. For API-only staging, `POST /kyc/complete` can be called directly with curl:

```bash
curl -X POST https://<tunnel>/kyc/complete \
  -H 'Content-Type: application/json' \
  -d '{
    "token": "<the token from the CTA URL>",
    "nin": "12345678901",
    "bvn": "12345678901",
    "firstName": "Test",
    "lastName": "User",
    "dateOfBirth": "1990-01-01",
    "pin": "1234"
  }'
```

Expected response: `{"userId":"<uuid>","status":"verified"}`.

---

## 9. End-to-end success checklist

Run this after exercising each flow:

| Flow               | `Transaction.status`        | `WalletBalance`               | `Receipt`                | WhatsApp message                               |
| ------------------ | --------------------------- | ----------------------------- | ------------------------ | ---------------------------------------------- |
| Receive            | `completed`                 | `balance` ↑ by deposit        | Row with `receiptNumber` | "✅ Deposit received…"                         |
| Sell               | `completed`                 | `balance` ↓ by `cryptoAmount` | Row with `receiptNumber` | "✅ Your crypto purchase is complete!…"        |
| Send (success)     | `completed`                 | `balance` ↓ by `totalDebit`   | Row with `receiptNumber` | "✅ Your crypto send is complete!…"            |
| Send (fail/refund) | `failed`                    | `balance` restored            | —                        | "⚠️ Send failed. Your USDT has been refunded…" |
| KYC complete       | `User.kycStatus='verified'` | —                             | —                        | re-send original intent works                  |

Check `SettlementOutbox.status='completed'` for sell and send flows (webhook-driven settlement).

---

## 10. Known follow-ups (non-blocking for staging)

Tracked from the final whole-branch review:

- `Number()` → `BigInt` at the KYC velocity gate (rounding edge on large amounts).
- Receipt numbering via a Postgres sequence (current: UUID-based, not sequential).
- Dedicated `RECEIPT_SIGNING_KEY` (currently shares `DIRECTIVE_SIGNING_KEY`).
- Outbox poller for webhook-miss recovery (if a Blockradar/Flutterwave webhook is never delivered, the transaction stays `settling` — manual retry or poller needed).
- Session-based device step-up (`Session.stepUpCompletedAt` wiring).
- Beneficiary name-enquiry (mock auto-verifies; real path requires a bank-name-enquiry API call).
- Travel-Rule name enrichment at execution (data is persisted; enrichment via external provider TBD).
- `BLOCKRADAR_WEBHOOK_SECRET` in `.env.example` is documented but Blockradar currently uses the API key for webhook HMAC — remove or clarify once the provider confirms.

See `docs/runbooks/whatsapp-buy-staging.md §Known follow-ups` for the buy-specific list.
