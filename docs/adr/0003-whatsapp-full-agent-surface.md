# 3. WhatsApp is a full agent surface (via Flows), settled by the engine

Date: 2026-06-19

## Status

Accepted. Supersedes the "WhatsApp = awareness/discovery/care + handoff only" stance previously encoded in CLAUDE.md §3.5, PRD §1 / §1.3 / §3.10 / FR-17 / NFR-11, and BRD BR-6.

## Context

WhatsApp was originally scoped to awareness/discovery/care + a handoff to the web app for every money-moving step, for two distinct reasons:

1. **Meta policy.** Meta's WhatsApp Commerce Policy prohibits cryptocurrency as in-thread _commerce_ (Catalog / Cart / WhatsApp Pay), and facilitating a prohibited exchange can get a business barred from WhatsApp Business Services — the deplatforming risk in BRD §11.
2. **Security/auth.** Money movement requires KYC + a bound device + a user-set PIN + step-up, which the handoff-to-web design satisfied on a surface we controlled.

We want WhatsApp to be a **first-class agent surface — as capable as the web app** — not a second-class funnel that punts every action to a link.

## Decision

WhatsApp becomes a full agent surface. Users complete flows **in-thread** using the official WhatsApp Cloud API **plus WhatsApp Flows** — Meta's end-to-end-encrypted (RSA + AES-GCM) in-chat forms — for KYC capture, the itemized confirmation, and **PIN entry**.

The safety model is unchanged and channel-independent:

- **The model still only proposes; the same server-side deterministic engine still settles** every transaction (CLAUDE.md §3.1). WhatsApp collects the validated intent and the authorization (PIN / step-up, inside an encrypted Flow); the engine executes server-side after re-validation, KYC/limit/sanctions checks, and an idempotency key.
- **No crypto "commerce" object is ever presented to Meta.** WhatsApp never uses a Catalog/Cart or WhatsApp Pay to buy/sell crypto, and never completes a crypto payment as a WhatsApp _commerce_ transaction. Settlement is **engine-brokered** server-side. What travels over WhatsApp is conversation + encrypted Flow data + approved templates.
- **Official Cloud API + Flows + approved templates only.** No unofficial automation (itself a ban trigger).
- **The web app remains the system of record and a full fallback.** Both channels are full agent surfaces; if WhatsApp is restricted, web serves the complete experience with no loss of funds/history/beneficiaries.
- **Identity is still not the phone number (§3.4).** Device binding is weaker on WhatsApp than on web, so sensitive actions still require PIN + step-up, and a SIM/number change still forces re-verification. The handoff-to-web path is retained for cases that need strong device binding.
- **PIN/KYC secrets only travel via Flow E2E encryption** — never as plaintext WhatsApp chat messages (NFR-1 holds).

## Compliance posture

This is a **risk-reduced** posture, not a guaranteed-compliant one. The reasoning: Meta's Commerce Policy targets crypto _commerce_ features; we use none of them. WhatsApp carries messaging + encrypted Flows + templates, and the regulated settlement runs on our own engine. Whether Meta considers a Flow-driven, engine-brokered crypto flow "facilitating a prohibited exchange" is a judgment call. Therefore: **validate with Nigerian counsel and Meta before launch** (PRD already mandates counsel review), keep the deplatforming risk in the register, and keep the web fallback fully functional so a restriction is survivable.

## Consequences

- The channel architecture is **symmetric** — WhatsApp and web are both full agent surfaces over one shared conversation core, identity, and engine (see the channel-architecture plan / ADR-0004 when written).
- New infrastructure: a **WhatsApp Flows endpoint** (RSA keypair for Flow payload encryption, a data-exchange endpoint) in the `whatsapp` module; config gains the Flow keys (secrets, env).
- The per-flow "(WA → Web)" handoff language throughout PRD §3.1–§3.8 should be reframed to "complete in-thread via a Flow, or on web" — tracked as a follow-up sweep.
- Safety invariants CLAUDE.md §3.1–§3.4 are **unchanged**; only §3.5 (the Meta-policy/channel clause) is rewritten.
