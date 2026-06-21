# 5. Agent-driven UI directives (declarative, cross-channel, provenance-gated)

Date: 2026-06-19

## Status

Accepted. **Amends [ADR-0004](0004-channel-architecture.md)** (`ConversationReply`'s single optional directive → `directives[]`). Builds on ADR-0002/0003/0004 and CLAUDE.md §3.

## Context

The product is conversation-first: all user input flows through the agent. But the apps still need rich UI — the itemized **confirmation**, **PIN** entry, the **KYC wizard**, quote/balance/receipt **cards**, the **beneficiary picker**. The question: how does the agent trigger these on web **and** WhatsApp without (a) shipping markup, (b) letting the LLM move money, or (c) letting the two channels diverge?

## Decision

**Server-driven UI via a closed, Zod-validated `UiDirective` contract.** The agent never opens a modal imperatively — it emits a declarative directive and each channel renders it.

- The core emits `ConversationReply.directives: UiDirective[]` (channel-neutral). A directive carries a **`ref`** (an id from a finite `UiComponentRef` enum), **validated pure-data `params`**, and — for money-touching kinds — a **`proposalId`**. Never markup; never live model-sourced money figures.
- **Web:** a `DirectiveHost` (in `web/components/chat`) reads validated directives from `chat-store` and renders the matching **app-owned** component via an exhaustive `ref → component` registry. Delivered over SSE. An unknown/invalid ref fails Zod and renders a safe fallback — never raw markup, never a throw.
- **WhatsApp:** the **same** directive is mapped by the WhatsApp adapter to a **Flow** (confirmation / PIN / forms) or interactive buttons/list. One directive, two adapters. **Secret-bearing directives (PIN/KYC) must map to an E2E-encrypted Flow**, never plaintext.
- **Round-trip:** a web modal submit and a WhatsApp Flow `data_exchange` both reconstruct the **same** `directive_result` inbound (`directiveId`, `ref`, validated `payload`, `proposalId`) into `ConversationService.handleInbound()` — indistinguishable to the channel-agnostic core.

## Safety model — trust by PROVENANCE, not shape (the crux)

This is the part that makes it safe for money. Inferring trust from a directive's _type_ alone is a confused-deputy hole: a prompt-injected model could emit a `show_confirmation`/`request_pin` shape and surface a spurious money modal. So:

- **Two trust tiers.** **Low-trust** (info modal, toast, clarify, read-only card) — the LLM may originate. **High-trust** (`show_confirmation`, `request_pin`, `request_step_up` — anything money- or secret-touching) — may be emitted **only by the deterministic engine / core**.
- **The discriminator is a server-stamped `origin` (`agent`|`core`|`engine`) + a signature/HMAC** over `(proposalId, nonce, expiresAt, userId)` on high-trust directives. The surface and the engine **reject** any high-trust directive whose origin is `agent` or whose signature fails — a model emitting a confirmation/PIN shape is dropped, not rendered.
- **Params carry no model-sourced money.** A high-trust directive carries only `proposalId` (+ nonce/expiry/sig). Amount/rate/fee/destination are read **server-side from the proposal** at render and **re-read at submit**; the Intent's free-text never becomes the confirmed figures.
- **One-shot + nonce + expiry** (mirrors ADR-0004's handoff token): CSPRNG ≥256-bit nonce bound to `(userId, proposalId)`, only the hash stored in a `DirectiveGrant` table (`issued/consumed/expired/failed`), TTL = the quote lock (AppSetting), atomic consume-on-redeem. A replayed directive finds the nonce consumed/expired → rejected (no second PIN prompt, no stale-price execution).
- **Submit re-validates server-side regardless of the directive (§3.3):** resolved identity (KYC + device + PIN, **not** the phone — §3.4), KYC tier + limits + velocity + sanctions/AML, balance, a fresh re-quote within lock drift, nonce, PIN + step-up, idempotency key. The directive only supplies `proposalId`; it authorizes nothing.
- **PIN/secrets never travel in a directive or plaintext chat.** `request_pin` only signals the surface to collect a PIN inside the secure channel (web overlay over TLS / encrypted Flow); the PIN submits **out-of-band** to the engine (NFR-1).
- **No crypto commerce object (§3.5).** The directive schema **cannot express** a Catalog/Cart/WhatsApp-Pay object; settlement stays engine-brokered.
- **Unlinked-contact gating.** An unlinked/unverified contact gets only low-trust onboarding/info directives.

## Consequences & rules

- **Contracts:** add `packages/contracts/src/channels/ui-directive.ts` (the `UiComponentRef` enum, the `UiDirective` union discriminated on `type` with `origin`/trust, the `directive_result` shape + result-by-ref schemas) and `ConversationReply.directives[]`.
- **Web layering:** the registry lives behind a `components/chat` `DirectiveHost` that reads validated directives from `chat-store`; `lib/` stays component-free (no `lib↛components` inversion). `chat-store.pinComplete()` remains the **sole receipt-producing path**; **at most one blocking directive active per surface**.
- **No raw HTML.** `params` are typed display strings only; never `dangerouslySetInnerHTML` (OWASP LLM05). The closed registry avoids the raw-markup path entirely.
- **Streaming.** Sensitive directives gate on a fully-streamed `complete` state before becoming interactive; non-sensitive cards may render progressively.
- **Flow mapping.** `UiComponentRef → published-Meta-Flow-id + version` is an AppSetting (§7); the single-use web-handoff link (ADR-0004) is the fallback when a Flow is unavailable.
- **Extensibility (mirrors §7).** A new rich-UI surface = one `UiComponentRef` value + one `DirectiveHost`/registry entry + one WhatsApp adapter branch (+ a result schema if it submits) + a Flow-id mapping. No change to `ConversationReply`, the agent, or callers.
- **Audit.** Every dropped/forged high-trust directive raises a security event to the compliance/admin console (a prompt-injection signal); a `dependency-cruiser` rule + unit test prove the agent code path cannot construct a high-trust directive.

## Resolved (see [ADR-0006](0006-provider-selections.md))

- **Signing primitive: HMAC-SHA256** — signer == verifier (single backend trust domain), so symmetric HMAC is simplest/fastest/dependency-free and consistent with the WhatsApp webhook HMAC; PASETO's public-key verifiability isn't needed. Sign `(directiveId, ref, proposalId, nonce, expiresAt, userId, origin)` with `DIRECTIVE_SIGNING_KEY` (env secret, rotatable); the client never holds the key.
- **`DirectiveGrant` is its own table** (`issued/consumed/expired/failed`).
- **`request_pin` expiry = 120s, configurable** via an AppSetting (bounded independently of the quote lock).
