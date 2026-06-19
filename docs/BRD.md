# Business Requirements Document (BRD)

**Company:** Handshake · **Product:** Handshake Agent (chat-native crypto, payments & ticketing)
**Status:** Draft v1.0 · For internal alignment
**Date:** 17 June 2026
**Owner:** Founder
**Related documents:** Product Requirements Document (PRD), Investor Memo

---

## 1. Executive summary

Handshake is a chat-native crypto and payments venture for the Nigerian market. Its product, Handshake Agent, lets users buy, sell, swap, send, and receive cryptocurrency and purchase event tickets through natural-language conversation. WhatsApp is the acquisition and engagement channel; a companion web application is the system of record where verification and transaction execution occur. Revenue comes from a foreign-exchange spread on fiat-to-crypto conversion, processing fees on transactions, and a commission on ticket sales.

The company is at pre-seed stage and is raising a small bridge round to fund MVP development and regulatory groundwork. Full Virtual Asset Service Provider (VASP) licensing capital is deferred to a later, larger round; the near-term regulatory route is the SEC's Accelerated Regulatory Incubation Program (ARIP).

This document defines the business objectives, market rationale, revenue model, regulatory and operational requirements, and risks. It is kept in sync with the PRD (which defines the product) and the Investor Memo (which defines the raise).

---

## 2. Business objectives

1. Acquire users cheaply through a channel they already use daily (WhatsApp) and convert them into verified, transacting users on the web app.
2. Provide a fairly priced fiat on/off-ramp and crypto operations with a transparent, competitive take rate.
3. Layer a second transactional product (event ticketing) onto the same conversational surface to increase engagement and revenue per user.
4. Enter the Nigerian regulatory perimeter via ARIP, establishing the compliance foundation required to access banking/payment rails and to scale on a licensed footing.
5. Reach an MVP and a demonstrable pilot that de-risks the seed/licensing round.

---

## 3. Market opportunity

Nigeria is one of the highest crypto-adoption markets in the world, driven by a large, young, mobile-first population, persistent inflation and currency depreciation that push savers toward dollar-denominated stores of value (notably stablecoins), and substantial diaspora remittance flows. WhatsApp is near-ubiquitous as a communication channel. These conditions create a natural fit for a conversational on/off-ramp that meets users where they already are.

The currency backdrop is also the basis of the revenue model. Following the 2023 liberalization, the official and parallel exchange rates have largely converged: as of mid-June 2026 the official (NFEM/CBN) rate sits around ₦1,360 per US dollar and the parallel/street rate around ₦1,400, a gap of roughly 2–3%. This convergence is the reason the revenue model is built on a sustainable 1–2% FX spread rather than the wide premiums of earlier years — a distinction that matters for both pricing competitiveness and investor credibility.

Market structure note: crypto on/off-ramps in Nigeria are an established and competitive category, with several local exchanges and P2P platforms already operating. The company's differentiation is not "another exchange" but a conversational, multi-product, multilingual experience distributed through WhatsApp. That differentiation must be defended on user experience and distribution, not on having a unique core transaction.

---

## 4. Business model and revenue streams

The business earns on three streams. All rates below are the canonical figures used across the PRD, BRD, and Investor Memo.

**Stream 1 — FX spread (on/off-ramp).** A 1–2% spread (base case 1.5%) applied over the company's sourcing cost when converting fiat to crypto and back. Worked example: source dollar-equivalent liquidity at ~₦1,360 and sell to the user at ~₦1,385–1,390 (≈1.5–2%), which remains at or below the parallel rate of ~₦1,400 and is therefore competitive. The spread is a margin on conversion, not riskless cross-market arbitrage; FX and liquidity risk are real and managed by treasury (Section 9).

**Stream 2 — Processing fee.** A 1–3% fee on transactions, covering payment-processing cost, on-chain cost, and margin. For modeling, a base-case on-ramp blends roughly 1.5% FX spread + 1% processing ≈ a 2.5% gross take rate, against which payment-processing fees (on the order of ~1.4% for card/transfer rails) and network costs are netted to reach contribution.

**Stream 3 — Ticketing commission.** A 1–5% commission (or markup) on the face value of event tickets, earned as the merchant of record while settling providers from the business account.

**Blended take-rate transparency.** Because the on-ramp stacks a spread and a processing fee, the all-in cost to a user buying crypto is roughly 2.5–4.5% depending on tier and rails. This must be presented to users transparently and benchmarked against competitors; the business should not assume it can sustain the top of that range.

| Stream         | Rate             | Basis               | Notes                                                  |
| -------------- | ---------------- | ------------------- | ------------------------------------------------------ |
| FX spread      | 1–2% (base 1.5%) | Conversion notional | Must stay at/under parallel rate to remain competitive |
| Processing fee | 1–3%             | Transaction value   | Nets against processor + network cost                  |
| Ticketing      | 1–5%             | Ticket face value   | Working capital exposure during settlement lag         |

---

## 5. Unit economics (illustrative)

These are model logic, not forecasts; actuals depend on volume, mix, and confirmed costs.

- **Take rate per on-ramp transaction:** ~2.5% gross (base case), netting to a positive contribution after ~1.4% processing and modest network cost.
- **Customer acquisition cost (CAC):** structurally low — WhatsApp is an owned, organic-leaning channel and the conversational hook reduces friction versus app installs. This is a core thesis advantage and should be measured rigorously from the first pilot.
- **Contribution driver:** profitability is a function of transaction frequency and average transaction size, not one-time acquisition. The second product (tickets) and repeat on/off-ramp behavior are the levers.
- **Float/working capital:** ticket settlement lag and FX inventory both consume working capital; treasury and settlement timing are first-order operational concerns, not afterthoughts.

---

## 6. Stakeholders

Founder/management; product and engineering; compliance/operations; the WaaS provider `[TBD]`; the payment processor; ticketing providers (`[TBD terms]`); identity-verification vendors (NIN/BVN, liveness); the SEC and, indirectly, the CBN as it governs banking access for crypto businesses; investors; and end users.

---

## 7. Business requirements

Business requirements are numbered and trace to PRD functional requirements (FR-x).

- BR-1 → FR-1..4: The business must onboard users from WhatsApp into verified, KYC-complete accounts whose identity is independent of the phone number.
- BR-2 → FR-5..9: The business must let users hold, buy, sell, send, and receive supported crypto assets with a transparent take rate.
- BR-3 → FR-11..12: The business must let users control payouts (beneficiaries) and authorize transactions securely (PIN + step-up).
- BR-4 → FR-13..14: The business must source, sell, and fulfill event tickets as merchant of record, settling providers reliably.
- BR-5 → FR-15..16: The business must serve users in any language and must never let a probabilistic component move funds unaided.
- BR-6 → FR-17..18: The business must keep WhatsApp within Meta's Commerce Policy (no in-thread crypto transactions) and must operate a web app that is both primary execution surface and full fallback.
- BR-7 → NFR-4..5: The business must meet KYC/AML/CFT, sanctions-screening, Travel Rule, and reporting obligations as a regulated activity.
- BR-8: The business must operate within the SEC perimeter (via ARIP near-term) to access compliant banking/payment rails.

---

## 8. Regulatory and compliance requirements

Crypto services to Nigerian users are a regulated activity. The Investments and Securities Act 2025 (ISA 2025), signed in March 2025, classifies virtual assets as securities and makes the Securities and Exchange Commission (SEC) the regulator for VASPs. The practical implications for this business:

- **Licensing perimeter.** Offering crypto services to Nigerian users requires SEC authorization. The near-term route is **ARIP** — a supervised, incubation-style pathway leading to an Approval-in-Principle and a transition to full registration — which allows the company to operate under supervision with a lower near-term capital bar (reported around 25% of required shareholder funds at the AIP stage) while full statutory capital is deferred to the licensing round.
- **Costs.** VASP registration carries a fee reported on the order of ₦30 million, plus capital-adequacy/shareholder-funds requirements, fidelity bonds, and legal/advisory costs. The bridge round funds **groundwork** — entity incorporation, regulatory counsel, ARIP application preparation, and compliance-framework design — not the full registration fee or statutory capital, which sit in the later round. (The full statutory capital requirement for the target tier, established in prior analysis at roughly ₦2 billion, is explicitly deferred.)
- **Operating conditions.** A locally registered Nigerian entity, key management resident in Nigeria, fidelity bonds, mandatory AML/CFT controls, Travel Rule adherence, and suspicious-transaction reporting are baseline expectations.
- **Banking access.** Banks and payment processors are barred from servicing _unlicensed_ crypto businesses. This makes entering the supervised perimeter (ARIP) a prerequisite for reliable, compliant fiat rails — i.e., regulatory standing and the payment-processor relationship are sequenced, not independent.

Specific figures and conditions above should be validated against current SEC instruments with Nigerian counsel, as requirements can evolve through SEC rules and supervisory practice.

---

## 9. Operational requirements

**Treasury and liquidity.** The company must source crypto liquidity, manage an FX/inventory position, and price the spread to stay competitive with the parallel rate while covering FX risk. Exposure limits, hedging policy, and rebalancing cadence are required from day one.

**Settlement.** Fiat collection (on-ramp), fiat payout (off-ramp), and provider settlement (tickets) each have timing and float implications. Ticket settlement and refund/chargeback handling are a working-capital exposure that must be modeled before scaling that product.

**Compliance operations.** KYC escalation handling, flagged-transaction review, sanctions-hit disposition, and SAR/STR filing require staffed tooling (the PRD's ops/compliance console).

**Fraud and support.** Handshake builds fraud monitoring and user-facing safeguards (first-use warnings, cooling-off) into the flow, with responsive support, to address social-engineering and scam-induced transfer risks.

**Platform integrity.** WhatsApp messaging must use the official Cloud API with approved templates and within messaging/frequency limits; unofficial automation is itself a ban trigger and is prohibited.

---

## 10. Partnerships and integrations

| Partner / integration                     | Role                                                         | Status                                                                  |
| ----------------------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------- |
| Payment processor (e.g., Flutterwave)     | Fiat collection and payout (NGN; multi-currency optionality) | Confirmed available; validate crypto-permissibility & settlement timing |
| WaaS provider                             | Wallet provisioning and custody                              | `[TBD — selection pending]`                                             |
| Ticketing providers (Zentry, Tix, others) | Ticket inventory and fulfillment                             | APIs available; `[commercial terms TBD]`                                |
| Identity verification (NIN/BVN, liveness) | KYC                                                          | Vendor selection pending                                                |
| On-chain infrastructure                   | Broadcast, monitoring, screening                             | Tied to WaaS selection                                                  |

The payment processor's multi-currency reach across African markets is noted as **expansion optionality** for a later phase, not MVP scope.

---

## 11. Risk register (business-level)

| Risk                                                     | Likelihood                  | Impact | Mitigation                                                                               |
| -------------------------------------------------------- | --------------------------- | ------ | ---------------------------------------------------------------------------------------- |
| Regulatory: licensing delay, evolving rules, capital bar | Medium                      | High   | ARIP pathway, counsel-led groundwork, deferred-capital framing, conservative scope       |
| Banking/payment-rail restriction on crypto               | Medium                      | High   | Enter supervised perimeter first; confirm crypto-permissible rails; processor redundancy |
| WhatsApp deplatforming                                   | Medium (baseline, not tail) | Medium | WhatsApp scoped to acquisition only; web app is system of record and full fallback       |
| FX / liquidity / inventory loss                          | Medium                      | Medium | Exposure limits, hedging policy, disciplined spread pricing                              |
| AML/fraud/scam incidents                                 | Medium–High                 | High   | Compliance-in-path, screening, transaction safeguards, monitoring                        |
| AI agent moves funds in error                            | Low (by design)             | High   | Deterministic execution layer + confirmation + step-up (see PRD §4)                      |
| Custody provider dependency/failure                      | Low–Medium                  | High   | Due diligence, isolation behind tool layer, migration path                               |
| Ticketing settlement / chargeback exposure               | Medium                      | Medium | Settlement-timing terms, working-capital buffer, refund handling                         |
| Competitive compression of take rate                     | Medium                      | Medium | Differentiate on UX/distribution; multi-product engagement                               |

---

## 12. Success metrics / KPIs

- Acquisition: WhatsApp inbound volume; inbound → KYC-complete conversion; CAC.
- Activation: time-to-first-transaction; quote-to-execution conversion.
- Revenue: gross take rate by stream; net contribution per transaction; revenue per active user.
- Retention: repeat transaction rate; time-to-second-transaction; ticket attach rate.
- Risk/ops: fraud/mis-send incidence; KYC escalation rate; treasury exposure vs limits; settlement success rate.
- Regulatory: ARIP application progress and milestone completion.

---

## 13. Assumptions and constraints

- The 1–2% FX spread is the sustainable, competitive base case; wider spreads are not assumed.
- WhatsApp cannot host crypto transactions; the web app is mandatory for execution.
- Compliant fiat rails depend on regulatory standing; ARIP is the near-term route.
- The bridge round funds MVP + regulatory groundwork only; full licensing capital is a later round.
- Custody, ticketing terms, identity vendor, team, traction, and company name are open items.

---

## 14. Roadmap / phasing

**Phase 0 (bridge, ≈0–6 months):** entity + ARIP preparation; web app core (KYC, wallets, NGN↔crypto buy/sell, send/receive, PIN, beneficiaries); WhatsApp acquisition layer; one ticketing pilot; closed beta with capped limits.

**Phase 1 (seed/licensing round):** full SEC registration + capital; broaden assets/chains/currencies; add swap; scale GTM; additional ticketing providers; hardened compliance ops.

**Phase 2+:** scale product and markets on a licensed footing; evaluate pan-African expansion via the processor's multi-currency reach.

---

_This BRD is a living document, kept in sync with the PRD and Investor Memo. Regulatory specifics must be confirmed with Nigerian counsel against current SEC instruments before commitments are made._
