# Product Requirements Document (PRD)

**Company:** Handshake · **Product:** Handshake Agent (chat-native crypto, payments & ticketing)
**Status:** Draft v1.0 · For internal alignment
**Date:** 17 June 2026
**Owner:** Founder / Product
**Related documents:** Business Requirements Document (BRD), Investor Memo

> **Open items referenced throughout** (tracked, not yet resolved): WaaS provider selection, commercial terms with ticketing providers, and the detailed regulatory design workstream. These are flagged inline as `[TBD]` where they affect a requirement.

---

## 1. Overview

Handshake Agent is a conversational financial assistant that lets users in Nigeria buy, sell, swap, send, and receive cryptocurrency, and discover and purchase event tickets, entirely through natural-language chat in any language. WhatsApp and a companion web application are both full agent surfaces: a user can complete the entire experience in either, including in-thread on WhatsApp via end-to-end-encrypted WhatsApp Flows. The web application remains the system of record and full fallback, and the same server-side deterministic engine settles every regulated transaction in both channels.

This stays within Meta policy by design. Meta's WhatsApp Commerce Policy prohibits crypto as in-thread _commerce_ (Catalog, Cart, WhatsApp Pay), so Handshake never uses those for crypto: WhatsApp carries conversation, approved templates, and end-to-end-encrypted WhatsApp Flows (for KYC, confirmation, and PIN), while the regulated settlement is brokered by our own server-side engine — never as a WhatsApp commerce transaction. See `docs/adr/0003-whatsapp-full-agent-surface.md` (a counsel/Meta review is required before launch).

### 1.1 Product principles

The product is governed by four principles, in priority order:

1. **Safety of funds before convenience.** No language-model output moves money on its own. The conversational layer interprets intent; a separate deterministic layer executes every transaction, after explicit parameter confirmation and step-up authentication. This keeps fund movement validated, authorized, and auditable.
2. **Compliance is a feature, not a wrapper.** KYC, AML/CFT screening, the Travel Rule, and transaction monitoring are built into the transaction path itself, not bolted on afterward.
3. **Identity is independent of the phone number.** WhatsApp identity is a phone number, which is exposed to SIM-swap attacks. Account identity and transaction authorization are anchored to verified KYC, a bound device, and a user-set PIN — never to the phone number alone.
4. **Graceful degradation across channels.** If WhatsApp restricts or removes the account, the web app continues to serve the full experience with no loss of user funds or history.

### 1.2 Goals

- Let a WhatsApp or web user create a verified account and provisioned crypto wallets through a guided conversation — completing KYC and verification in-thread via WhatsApp Flows or on the web app.
- Support fiat-to-crypto and crypto-to-fiat conversion in the fiat currencies available through the payment processor, with a transparent, competitive FX spread.
- Support on-chain send and receive, and asset-to-asset swaps, for a supported set of assets and chains.
- Let users manage saved beneficiaries and authorize payments with a PIN plus step-up authentication.
- Let users discover and buy event tickets through integrated providers, with the platform settling the provider and delivering the ticket.
- Operate the assistant in any language the user writes in.

### 1.3 Non-goals (for the MVP / Phase 0)

- The platform is **not** a custodial bank, a lending product, a yield/staking product, or an investment-advice service.
- The MVP never completes a crypto purchase as a WhatsApp _commerce_ transaction (no Catalog/Cart/WhatsApp Pay for crypto); in-thread flows are conversation + encrypted WhatsApp Flows, and every settlement is engine-brokered server-side.
- The MVP does not attempt to support every asset, chain, or fiat currency — scope is intentionally narrow at launch (see Section 12).
- The product does not provide tax filing, though it will retain records sufficient for users and the business to meet reporting obligations.

---

## 2. Users and personas

**Primary persona — the mobile-first retail user.** Lives in Nigeria, transacts primarily on a smartphone, already uses WhatsApp daily, and wants to buy or sell crypto (often USDT or BTC) for savings, remittances, or payments without learning an exchange interface. Values speed, a familiar conversational surface, and naira pricing they can trust.

**Secondary persona — the remittance recipient/sender.** Receives value from a diaspora contact or sends value out, and wants the fiat on/off-ramp to be fast and the rate to be fair relative to the street rate.

**Secondary persona — the event-goer.** Wants tickets to a concert, match, or conference and would rather ask a chat assistant to find and buy them than navigate multiple ticketing sites.

**Internal persona — the operations/compliance analyst.** Needs tooling to review flagged transactions, manage KYC escalations, monitor treasury exposure, and respond to suspicious-activity alerts.

---

## 3. Core user flows

Each flow below is written as the user experiences it, with the channel boundary made explicit. "WA" denotes a step that happens in WhatsApp; "Web" denotes a step that happens in the web app.

### 3.1 Onboarding and wallet provisioning

1. **(WA)** An existing WhatsApp user messages the business number. The assistant greets them in the language they wrote in and explains what it does.
2. **(WA)** The assistant creates a provisional account keyed to the user and guides them through tiered KYC — completed in-thread via an end-to-end-encrypted WhatsApp Flow, or on the web app. Verification and authorization use the Flow's encrypted forms (or web), never plaintext chat.
3. **(Web)** The user completes tiered KYC: identity verification using NIN/BVN, an ID document, and a liveness check. The user sets a transaction PIN. The current device is bound to the account.
4. **(Web)** On successful KYC, the platform provisions custodial wallets for the supported assets/chains via the WaaS provider `[TBD]` and displays the wallet addresses and balances.
5. **(WA)** The assistant confirms the account is live and can now answer questions, surface balances, and complete money movement in-thread via encrypted WhatsApp Flows (or on the web app).

**Critical requirement:** account identity is bound to the verified KYC record and device, not to the phone number. A change of SIM or phone number triggers re-verification and step-up authentication before any transaction.

### 3.2 Buy crypto (fiat → crypto)

1. **(WA)** User expresses intent ("I want to buy 50,000 naira of USDT"). The assistant parses this into a _structured intent_, not a transaction.
2. **(WA)** The assistant generates a quote (asset, fiat amount, crypto amount, the FX rate applied, the spread, the processing fee, and the all-in price) and presents the itemized confirmation in-thread via a WhatsApp Flow (or on the web app) for explicit review and PIN authorization.
3. **(Web)** The user reviews the fully itemized quote. The exact parameters are displayed for explicit confirmation. The user authorizes with PIN and step-up authentication.
4. **(Web)** The deterministic execution engine re-validates the quote against live pricing and limits, collects fiat through the payment processor, and credits the user's wallet with the purchased asset.
5. **(WA + Web)** A receipt is delivered in-thread and via email/notification. The settlement itself is engine-brokered server-side — never a WhatsApp _commerce_ transaction — which keeps it within WhatsApp policy.

### 3.3 Sell crypto (crypto → fiat)

Mirror of 3.2: the user expresses intent, receives an itemized quote (crypto amount, fiat proceeds, spread, fee), confirms parameters explicitly on the web app, authorizes with PIN/step-up, and the engine debits the wallet and pays out fiat to a verified payout method.

### 3.4 Send crypto (on-chain transfer)

1. **(WA)** User expresses intent to send a specific amount of an asset to a beneficiary or address.
2. **(Web)** Because the destination is irreversible, the web app displays the parsed destination address (or saved beneficiary), the asset, the amount, and the network fee for explicit confirmation. Address is validated for format and checksum; first-time addresses surface an additional warning.
3. **(Web)** User authorizes with PIN/step-up. The engine constructs and broadcasts the transaction with an idempotency key to prevent double-sends.

### 3.5 Receive crypto

The assistant surfaces the user's deposit address(es) for a chosen asset/chain (read-only, safe to display in either channel) and notifies the user on confirmed inbound deposits.

### 3.6 Swap (asset → asset)

The user expresses intent to swap one supported asset for another. The platform returns a quote including the swap rate, the platform swap fee, and any network cost, for explicit confirmation and PIN/step-up authorization on the web app.

### 3.7 Beneficiaries and PIN

- Users add, label, and remove payout accounts and crypto addresses as saved beneficiaries.
- Adding a new beneficiary is a sensitive action requiring step-up authentication and (for crypto addresses) a cooling-off or small-value verification on first use.
- The PIN authorizes transactions; it is rate-limited, lockout-protected, and never transmitted or stored in plaintext.

### 3.8 Event ticket discovery and purchase

1. **(WA)** User asks the assistant to find tickets to an event.
2. **(WA)** The assistant queries integrated ticketing providers (e.g., Zentry, Tix, and others `[TBD commercial terms]`) through internal tools and presents normalized options (event, date, tier, price in naira inclusive of the platform fee).
3. **(WA)** The user selects an option and pays via an in-thread WhatsApp Flow (or on the web app); settlement is engine-brokered server-side.
4. **(Web)** User pays; the platform settles the provider from its business account and the provider issues the ticket, which is delivered to the user.

**Settlement note:** the platform is the merchant of record to the user and settles the provider out of band. Provider commercial terms, settlement timing, and refund/chargeback handling are open items that materially affect working-capital needs (see BRD).

### 3.9 Multilingual interaction

The assistant detects the user's language per message and responds in kind, across all flows. Financial figures, asset tickers, and addresses are rendered unambiguously regardless of language. Numerals and amounts are normalized to a canonical representation before parsing into structured intent.

### 3.10 Web app as system of record and full fallback

WhatsApp and the web app are both full agent surfaces; the web app is additionally the **system of record** and the **full fallback**. It exposes the same conversational interface plus full account management. If WhatsApp restricts or removes the business account, users transact entirely on the web app with no loss of funds, history, or beneficiaries. User communications, marketing, and onboarding can fail over to web/email/SMS channels.

---

## 4. The agent architecture (safety-critical)

This is the core of Handshake Agent. The system is layered so that no probabilistic component can move money on its own.

### 4.1 Layer 1 — Conversational / NLU layer

A large language model interprets the user's message in any language, maintains conversation context, asks clarifying questions, and produces a **structured intent object** (e.g., `{action: buy, asset: USDT, fiat_amount: 50000, fiat_currency: NGN}`). It does not produce a transaction, a destination address, or a final amount that is acted upon directly. Free-text from the model is never interpreted as a financial parameter.

### 4.2 Layer 2 — Tool / MCP layer (in-house)

The model can only act by calling typed, validated internal tools exposed through the platform's own MCP servers. Each tool has a strict input schema and rejects malformed or out-of-range inputs. Representative tools:

- `get_balances`, `get_deposit_address` (read-only)
- `quote_buy`, `quote_sell`, `quote_swap` (pricing, no side effects)
- `execute_buy`, `execute_sell`, `execute_swap`, `send_crypto` (side-effecting; gated)
- `search_tickets`, `quote_ticket`, `purchase_ticket`
- `add_beneficiary`, `list_beneficiaries`

Side-effecting tools never execute on the basis of the model's call alone — they create a **proposal** that must pass the deterministic layer and explicit user confirmation.

### 4.3 Layer 3 — Deterministic execution engine

The engine is the only component that constructs and submits real transactions. For every side-effecting proposal it:

1. Re-validates all parameters against schemas, live pricing, and the user's KYC-tier limits.
2. Runs balance checks, velocity/limit checks, sanctions screening, and AML rules.
3. Renders the exact, itemized parameters to the user for **explicit confirmation** (amount, asset, destination, rate, fees).
4. Requires **PIN + step-up authentication** before execution.
5. Executes with an **idempotency key** to guarantee at-most-once execution.
6. Enforces hard caps, per-transaction and per-period limits, and irreversibility guards (e.g., first-time-address warnings, cooling-off on new beneficiaries).

If the model hallucinates an amount or an address, the discrepancy is caught at the confirmation step, where the user sees the parsed parameters before authorizing — and even an authorized-but-wrong parameter is constrained by hard caps and screening. The model cannot bypass, disable, or reorder these controls.

### 4.4 Why this matters

Separating interpretation from execution lets Handshake Agent deliver a natural conversational experience while keeping every transaction validated, confirmed, and authorized. The model proposes; the deterministic engine disposes. This separation is core to the design and is what makes chat-native payments both safe and auditable.

---

## 5. Functional requirements

Requirements are numbered for traceability against the BRD. "MVP" marks Phase 0 scope.

**Onboarding & identity**

- FR-1 (MVP): Provision a provisional account from a WhatsApp inbound message and guide the user into verification — in-thread via an encrypted WhatsApp Flow, or via a secure single-use web link.
- FR-2 (MVP): Complete tiered KYC (NIN/BVN, ID document, liveness) on the web app before any wallet is provisioned.
- FR-3 (MVP): Bind the account to a verified device and a user-set PIN; anchor identity to KYC, not the phone number.
- FR-4 (MVP): Detect SIM/phone-number change and require re-verification + step-up before transactions.

**Wallets & crypto operations**

- FR-5 (MVP): Provision custodial wallets for the supported assets/chains via the WaaS provider and display addresses and balances.
- FR-6 (MVP): Buy crypto with fiat; FR-7 (MVP): Sell crypto for fiat — both with itemized quotes.
- FR-8 (MVP): Send crypto on-chain with address validation and idempotent execution.
- FR-9 (MVP): Receive crypto and notify on confirmed deposits.
- FR-10 (Phase 1): Swap one supported asset for another.

**Payments control**

- FR-11 (MVP): Manage saved beneficiaries (payout accounts and crypto addresses) with step-up on add and first-use safeguards.
- FR-12 (MVP): Authorize all side-effecting transactions with PIN + step-up; enforce rate limiting and lockout.

**Ticketing**

- FR-13 (MVP, ≥1 provider): Search integrated ticketing providers and present normalized options inclusive of the platform fee.
- FR-14 (MVP): Collect payment, settle the provider from the business account, and deliver the ticket; handle refunds/failures.

**Conversation**

- FR-15 (MVP): Operate in any language the user writes in, across all flows.
- FR-16 (MVP): Produce structured intent only; never treat model free-text as a financial parameter.

**Channel**

- FR-17 (MVP): WhatsApp is a full agent surface (Cloud API + WhatsApp Flows) — KYC, confirmation, and PIN complete in-thread; settlement is engine-brokered server-side in either channel, never as a WhatsApp commerce object.
- FR-18 (MVP): Provide a web app with the full conversational + account-management experience and channel failover.

---

## 6. Non-functional requirements

**Security**

- NFR-1: No plaintext storage of PINs, private keys, or KYC secrets; key custody handled by the WaaS provider's security model (MPC/HSM) `[evaluate on selection]`.
- NFR-2: Step-up authentication for sensitive actions (new beneficiary, large/first-time transfer, credential or device change).
- NFR-3: Full, immutable audit log of every proposal, confirmation, authorization, and execution.

**Compliance**

- NFR-4: KYC/AML/CFT checks embedded in the transaction path; sanctions screening on counterparties; Travel Rule data on qualifying transfers; suspicious-activity detection and reporting.
- NFR-5: Tiered limits by KYC level; configurable velocity and exposure limits.

**Reliability & performance**

- NFR-6: Quotes reflect live pricing with a bounded validity window; stale quotes are re-validated before execution.
- NFR-7: Idempotent execution for all side-effecting operations; no double-spend, no double-settle.
- NFR-8: Conversational latency targets suitable for chat (sub-second acknowledgement; quote generation within a few seconds).

**Observability & operations**

- NFR-9: Operations/compliance console for KYC escalations, flagged-transaction review, treasury exposure, and provider settlement status.
- NFR-10: Alerting on treasury exposure thresholds, failed settlements, and anomalous transaction patterns.

**Platform integrity**

- NFR-11: Use only the official WhatsApp Business Platform (Cloud API) + WhatsApp Flows with approved templates; never a crypto commerce object (Catalog/Cart/WhatsApp Pay); settlement is engine-brokered server-side; no unofficial automation tooling (which itself triggers bans).

---

## 7. Custody model

Crypto custody is delegated to a Wallet-as-a-Service provider `[TBD]`. Selection criteria, to be evaluated before commitment:

- Key-management security model (MPC vs HSM-backed), and where signing authority sits.
- Supported chains and assets matching launch scope.
- Built-in compliance tooling (screening, Travel Rule, reporting).
- Regulatory standing and references in regulated markets.
- Naira/fiat settlement compatibility and payout rails.
- SLAs, uptime history, and incident transparency.
- Withdrawal controls, allow-listing, and policy-engine support.

Provider dependency is a concentration risk (Section 9). The architecture isolates the custody interface behind the tool layer so the provider can, in principle, be migrated.

---

## 8. Data model (high level)

Core entities: **User** (KYC record, tier, status), **Device** (binding, trust state), **Wallet** (asset, chain, address, provider reference), **Beneficiary** (payout account or crypto address, verification state), **Quote** (parameters, validity window), **Transaction** (type, parameters, idempotency key, status, audit trail), **TicketOrder** (provider, event, settlement status, delivery state), **ComplianceEvent** (screening hits, flags, dispositions).

Sensitive data (KYC secrets, keys) is segregated and access-controlled; the conversational layer operates on references and non-sensitive fields only.

---

## 9. Product risks and mitigations

| Risk                                            | Mitigation                                                                                                                |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| LLM hallucinates a transaction parameter        | Deterministic execution layer, explicit parameter confirmation, PIN/step-up, hard caps, idempotency                       |
| SIM-swap / account takeover                     | Identity anchored to KYC + device, not phone; SIM-change re-verification; step-up on sensitive actions                    |
| WhatsApp restriction/removal                    | Web app is the system of record and full fallback; no money operation depends on WhatsApp, so a restriction is survivable |
| Custody provider failure or compromise          | Provider due diligence; custody isolated behind tool layer; withdrawal controls; migration path                           |
| Fraud / social engineering / scams              | First-use address warnings, beneficiary cooling-off, velocity limits, anomaly alerting, user education in-flow            |
| Irreversible mis-send                           | Address validation, explicit destination confirmation, first-time-address friction                                        |
| Payment-rail or processor restriction on crypto | Confirm crypto-permissible rails; regulatory standing (ARIP) to access compliant rails; processor redundancy              |

---

## 10. Dependencies and open questions

- **WaaS provider** `[TBD]` — gates wallet provisioning, custody, and supported assets.
- **Payment processor** crypto-permissibility and settlement timing — affects on/off-ramp viability and float.
- **Ticketing providers** `[TBD terms]` — settlement timing and refund/chargeback handling affect working capital and the ticket flow.
- **Regulatory status** — access to compliant banking/payment rails depends on entering the SEC's supervised perimeter (ARIP); see BRD.
- **Identity providers** — NIN/BVN verification and liveness vendor selection.

---

## 11. Success metrics (product)

- Onboarding completion rate (WhatsApp inbound → KYC complete → wallet live).
- Quote-to-execution conversion on the web app.
- Transaction success rate and median time-to-completion per flow.
- Incidence of mis-sends and confirmation-step catches (a leading safety indicator).
- Repeat transaction rate and time-to-second-transaction.
- Support contact rate per transaction and KYC escalation rate.

---

## 12. Phasing and MVP scope

**Phase 0 — Pre-seed bridge (≈0–6 months).** Entity setup and ARIP application preparation; web app core (onboarding + tiered KYC, wallet provisioning, buy/sell NGN↔crypto for a narrow asset set, send/receive, PIN, beneficiaries); WhatsApp as a full agent surface (Cloud API + WhatsApp Flows); one ticketing integration as a pilot; closed beta with capped limits. Deliberately narrow: one or two assets (e.g., USDT, BTC), NGN only, single primary chain per asset.

**Phase 1 — Seed / licensing round.** Full SEC VASP registration and statutory capital; broaden assets, chains, and fiat currencies (leveraging the processor's multi-currency reach for pan-African optionality); add swap; scale go-to-market; additional ticketing providers; hardened operations and compliance tooling.

**Phase 2+ — Scale.** Expand product surface and markets on a licensed footing.

---

_This PRD is a living document and will be updated as open items resolve. Specific regulatory parameters and provider terms must be validated against current SEC instruments and signed agreements before build commitments._
