# 6. External provider selections (Blockradar, Resend, Flutterwave) + directive signing

Date: 2026-06-19

## Status

Accepted. Resolves the WaaS / email / payments `[TBD]`s in PRD §7, §10 and BRD §10, and the open items in [ADR-0005](0005-agent-driven-ui-directives.md). Every provider sits behind a §7 capability-registry port, so each stays swappable.

## Decisions

### Custody / WaaS → Blockradar

[Blockradar](https://docs.blockradar.co) — stablecoin wallet infrastructure on EVM / TRON / Solana. Model: a **master wallet → per-customer child addresses**; **deposit webhooks** with automatic sweeping; a **withdraw** API (single + batch); API-key auth. It sits behind the WaaS provider port (`WAL-01`).

**Caveat — no native Bitcoin.** Blockradar covers stablecoins (USDT/USDC), not BTC. Combined with the contracts' TRON-only `NetworkSchema`, **launch scope is USDT on TRON; BTC is deferred** until a BTC-capable custody path is chosen (a second provider behind the same port). `SupportedAsset` keeps `BTC` as a forward value, but the `crypto.*` capabilities for BTC stay **flag-off** (§7 registry) until then.

### Email → Resend

Behind the `NotificationProvider` email port (`NTF-03`). Env: `RESEND_API_KEY`, `EMAIL_FROM`.

### Payments (fiat rails) → Flutterwave

Behind the payment-processor port (`TXN-04`). Two capabilities:

- **On-ramp (buy):** generate a **collection / virtual bank account** so a user funds a buy by bank transfer; confirm via collection webhook.
- **Off-ramp (sell):** **transfer / payout** to the recipient's bank account.

Webhooks (collection + transfer) are signature-verified; reconciliation is idempotent. Env: `FLUTTERWAVE_SECRET_KEY`, `FLUTTERWAVE_BASE_URL`, `FLUTTERWAVE_WEBHOOK_SECRET`. (Per BRD/PRD: validate crypto-permissibility + settlement timing; compliant rails depend on regulatory standing / ARIP.)

## Directive signing (resolves ADR-0005's open items)

- **Signing primitive: HMAC-SHA256.** The signer and verifier are the **same backend** (a single trust domain), so symmetric HMAC is the right call — simplest, fastest, dependency-free (Node `crypto`), and consistent with the WhatsApp webhook HMAC. PASETO / asymmetric tokens buy public-key verifiability we don't need (no external party verifies a directive). Sign a canonical serialization of `(directiveId, ref, proposalId, nonce, expiresAt, userId, origin)` with `DIRECTIVE_SIGNING_KEY` (env secret, rotatable); the client never holds the key (its checks are UX-only — the server re-verifies on submit).
- **`DirectiveGrant` is its own table** (`issued/consumed/expired/failed`).
- **`request_pin` expiry = 120s, configurable** via an AppSetting (bounded independently of the quote lock).

## Consequences

- New env (see [`api/.env.example`](../../api/.env.example)): `BLOCKRADAR_*`, `RESEND_API_KEY` / `EMAIL_FROM`, `FLUTTERWAVE_*`, `DIRECTIVE_SIGNING_KEY`.
- Still `[TBD]`: the identity/KYC vendor (`IDN-09`) and the ticketing vendor (`TKT-02`).
- One open **product** decision: **BTC at launch** — defer (recommended; matches Blockradar + the TRON-only network scope) or stand up a second custody provider now.
