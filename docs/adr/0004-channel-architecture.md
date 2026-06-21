# 4. Channel-agnostic conversation architecture (WhatsApp + web as equal surfaces)

Date: 2026-06-19

## Status

Accepted. Builds on [ADR-0003](0003-whatsapp-full-agent-surface.md) (WhatsApp is a full agent surface) and the foundational architecture in [ADR-0002](0002-foundational-architecture.md).

## Context

WhatsApp and the web app must **both be fully functional regardless of which channel acquired the user**, and either must keep working if the other is unavailable. Per ADR-0003, WhatsApp is now a first-class surface (in-thread KYC/confirmation/PIN via WhatsApp Flows), not a handoff-only funnel. We need one architecture where **one agent core, one account, and one conversation thread** serve both surfaces, money settles only through the shared server-side engine, and the safety invariants (CLAUDE.md §3.1–§3.5) hold across channels. The agent LLM is **Claude (`claude-opus-4-8`)** behind the `LlmProvider` port (CLAUDE.md §6).

## Decision

### The cardinal rule

**Channel concerns live only at the adapter edge.** The conversation core, the agent, and the deterministic engine never learn which channel a message came from. A conversation is keyed on **resolved identity (Contact/User), not the channel**, so a thread started on WhatsApp continues on web and vice-versa.

### Modules (all greenfield except `quotes`)

| Module                               | Layer                               | Role                                                                                                                                                                                                  |
| ------------------------------------ | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `channels`                           | application ports + normal form     | `InboundChannel`/`OutboundChannel` ports, `ChannelMessage`/`ConversationReply` normal form, and a registry. Adding a channel = implement two ports + register. No SDKs, no DB, no policy.             |
| `whatsapp`                           | presentation + infrastructure       | The official Cloud API adapter: signed webhook in, Graph send out, **and a WhatsApp Flows endpoint** (RSA-decrypted in-thread KYC/confirmation/PIN). All WhatsApp policy lives here.                  |
| web adapter (in `notifications`/web) | presentation (SSE) + infrastructure | Authenticated web chat in; pushes replies over SSE; persists + replays.                                                                                                                               |
| `conversations`                      | domain + application + infra        | The core. `ConversationService.handleInbound()` resolves identity, loads the shared thread, calls the agent through a port, decides reply/Flow/handoff, dispatches. No SDK, no Prisma in application. |
| `identity` (extend)                  | domain + application + infra        | `Contact`/`ChannelIdentity` (phone → contact) + `HandoffToken`. Upgrades a phone to a verified `User` only after KYC + device + PIN.                                                                  |
| `agent` (reuse)                      | core behind ports                   | Claude behind `LlmProvider`/`AgentPort`. Sees no channel. Emits a validated `Intent`.                                                                                                                 |
| `transactions` (reuse)               | the engine                          | Settles money server-side, in either channel, after confirmation + PIN + step-up + idempotency key.                                                                                                   |
| `notifications` (new)                | provider abstraction                | Receipts/alerts with failover WhatsApp → email/SMS.                                                                                                                                                   |

### Flows

- **Inbound:** adapter normalizes a raw payload → `ChannelMessage` → `ConversationService.handleInbound()` → resolve identity → load shared thread → `AgentPort.run()` (Claude, channel-stripped) → validated `Intent` + reply.
- **Money intent:** on **either** channel, the core routes to the deterministic engine for confirmation + PIN + step-up. On WhatsApp the confirmation + PIN are collected **in-thread via an encrypted WhatsApp Flow** (ADR-0003); on web via the app UI. The web handoff (single-use link) is retained as a **fallback** (e.g. when strong device binding is required, or Flows are unavailable). The engine settles server-side either way — never as a WhatsApp commerce object.
- **Outbound:** `ConversationService` → `ChannelRegistry.for(channel)` → `OutboundChannel.send()`. The WhatsApp adapter enforces policy at the edge (24h template window; official Cloud API only; never a crypto commerce object). The web adapter pushes over SSE and persists for replay.

### Contracts to add (`packages/contracts/src/channels/`)

`InboundChannelMessageSchema` (channel, senderAddress, `externalMessageId` for dedup, text, receivedAt), `OutboundChannelReplySchema` (channel-neutral text + optional Flow/handoff directive + optional templateRef), `HandoffTokenSchema`. Plus an intent-envelope extension: `language` + `rawUserText` (reply-in-kind + audit); `extractionConfidence` optional (see Multilingual).

## Decisions baked in (from the adversarial review)

- **Identity-keyed shared thread.** One `Conversation` per resolved Contact/User; channel is a per-message tag for audit only.
- **No channel field reaches the agent or engine.** Enforced by the `AgentPort` input type **and** a `dependency-cruiser` rule + a unit test — not by type alone.
- **Unlinked-contact gating.** An unlinked phone gets product info + onboarding only; every balance/address/beneficiary read requires a linked, verified User. Guarded in `ConversationService` and unit-tested.
- **Per-number rate limit.** `ThrottlerModule` keyed on resolved Contact, applied **after** signature-verify + dedup, **before** the (paid) Claude call. Tunable via AppSetting.
- **Handoff token = bearer credential.** CSPRNG (≥256 bits), only the hash stored, short TTL (AppSetting), single-use (atomic consume-on-redeem), sibling tokens invalidated; redeemed on first web load and **rotated to a session cookie** (kept out of the URL); `Referrer-Policy: no-referrer`; never logged.
- **Durable async inbound.** Fast-ack (200 < 5s) → durable, replayable sink (outbox table or BullMQ) → process. Dedup on `wamid` with an explicit `received/processed/failed` state so a failed agent turn re-runs without double-answering.
- **Outbound failure state machine.** `131047` (out-of-window) → fall back to template / defer; `131026` (undeliverable) → mark contact undeliverable → trigger email/SMS failover. Driven off the persisted `wamid → status` map.
- **Out-of-band fallback identifier.** Capture a **verified email (and/or backup phone) during KYC**, stored on the User, so notifications reroute if WhatsApp is restricted.
- **SIM-swap.** The Cloud API gives no swap signal, so the phone number is a **routing key only**; trust is anchored to KYC + device + PIN, and sensitive actions always require step-up. A swapped SIM gains nothing without the device/PIN.

## Multilingual (relaxed under Claude)

Claude is strong at Nigerian languages (incl. Pidgin) and reliable structured output, so the small-model mitigations are no longer mandatory. The real guard against a mis-parsed amount is, as always, the **itemized confirmation** (re-rendered in the Flow/web before PIN) + Zod validation + the engine — all model-independent. Keep `language` + `rawUserText` in the intent envelope; `extractionConfidence` gating is optional insurance.

## WhatsApp Flows specifics

The `whatsapp` module exposes a **Flows data-exchange endpoint**: Meta sends RSA+AES-GCM-encrypted Flow responses; the server decrypts with `WHATSAPP_FLOW_PRIVATE_KEY` (PEM, env secret). KYC fields, the itemized confirmation, and the **PIN** travel only inside this encrypted channel — never as plaintext chat (NFR-1). Webhook security is unchanged: raw-body `X-Hub-Signature-256` HMAC verified in a guard before any pipe, fast-ack, dedup on `wamid`.

## Consequences

- Symmetric channel architecture over one shared core; new modules `channels`, `whatsapp`, `conversations`, plus an `identity` extension and `notifications`.
- New config: `WHATSAPP_WABA_ID`, `WHATSAPP_GRAPH_VERSION`, `WHATSAPP_FLOW_PRIVATE_KEY` (see `api/.env.example`).
- Build order (TDD-first): contracts → `channels` ports → `whatsapp` inbound (signed webhook) → `conversations` core (reply/Flow/handoff + unlinked-contact gating) → `whatsapp` outbound + Flows endpoint + 24h policy → `identity` + handoff → web adapter (SSE) + notification failover.
- ADR-0003's compliance posture still requires Nigerian counsel + Meta review before launch.
