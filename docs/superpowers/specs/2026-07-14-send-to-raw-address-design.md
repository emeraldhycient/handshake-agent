# Send crypto to a raw address — design (Spec 1)

**Date:** 2026-07-14
**Status:** Approved (brainstorming) — ready for implementation plan
**Scope:** Sub-project 1 of 2. This spec covers **sending crypto to a raw on-chain
address** on **web + WhatsApp**. The sibling sub-project — **send to another
Handshake user by PayID / public nickname via an internal ledger transfer** — is
explicitly deferred to its own design (see [Non-goals](#non-goals)); this spec
only makes the destination-resolution seam forward-compatible with it.

---

## 1. Goal

Let a user send crypto (USDT/TRON at launch) to a **raw address** they paste in
chat — not only to a previously-saved beneficiary — and let them **save that
address as a beneficiary before OR after** sending, if they choose. Remove the
current dead-end where pasting an address replies "save it as a recipient" with
no way to actually do so.

## 2. Problem & current behaviour

The send vertical is beneficiary-only:

- `SendCryptoIntentSchema` (`packages/contracts/src/intents/send-crypto.intent.ts:14`)
  carries only `asset / cryptoAmount / network? / recipientNickname?` — **no
  address field**, by §3.1 (the NLU never extracts a destination).
- `ProposalService.createSendProposal`
  (`api/src/modules/transactions/application/proposal.service.ts:633`) **requires a
  `beneficiaryId`** and derives `toAddress = beneficiary.cryptoAddress`
  (line 766).
- The LLM prompt tells the model to return `action:"none"` + "save it as a
  recipient" for a raw-address paste
  (`api/src/modules/agent/infrastructure/anthropic-llm.provider.ts:161`), which
  maps to a plain text bubble — the reported **dead-end** (no card, no save
  affordance).

**Known hazard (must not regress):** `resolvePayoutBeneficiary`
(`api/src/modules/chat/application/web-chat.service.ts:673`) falls through to the
user's **default** crypto beneficiary when there is no nickname and no explicit
id (line ~749). Routing a raw-address paste naïvely into a no-nickname
`send_crypto` would therefore **silently misroute to the default beneficiary** —
a §3.1 funds hazard. This design eliminates that path for any send that carries
an explicit-but-unsaved destination.

## 3. Decisions locked in brainstorming

| Decision | Choice |
| --- | --- |
| Surfaces / rails | **Web + WhatsApp**, crypto-send only. Bank/sell-to-unsaved and PayID/internal transfer are separate specs. |
| Address capture (§3.1) | **Pre-fill from the user's own message**: a deterministic parser at the chat edge (NOT the model) extracts the address token; the user confirms it in a form field; the engine re-validates. |
| Architecture | **Approach 1** — one engine that accepts *either* a saved `beneficiaryId` *or* a validated user-supplied raw address. |
| Cooling-off posture | **Instant, existing gates only.** A one-time raw send is gated by PIN + device-bound step-up + sanctions + on-chain per-send cap + velocity cap. First-use cooling-off governs *reusable saved* destinations, so it does **not** hold a one-time send. If "save" is ticked, the *saved* record still gets normal cooling-off for **future** reuse. |
| Seam | **Forward-compatible** destination resolver, so Spec 2 (PayID / public nickname → internal user) adds variants without reworking Spec 1's contracts or the engine signature. |

## 4. Non-goals

- **PayID** (a public payment handle minted at account creation, surfaced in the
  profile) and **public nicknames** (recipient-owned aliases).
- **Internal user-to-user (ledger-to-ledger) transfer** settlement — a new rail
  distinct from the on-chain withdrawal. None exists today
  (`execution.service.ts:1293-1660` only settles on-chain via
  `walletService.withdraw`).
- Bank-account sell to an unsaved account (name-enquiry rail).

These are Sub-project 2. This spec only shapes the seam to accept them later
(see §5.1).

---

## 5. Architecture

### 5.1 The destination-resolver seam (forward-compatible)

Generalize the resolver's success return from a bare `beneficiaryId` to a
**discriminated `SendDestination` descriptor**. New shape (contracts, api-side
application type — NOT the model-facing intent):

```
type SendDestination =
  | { kind: 'saved_beneficiary'; beneficiaryId: string }   // existing path
  | { kind: 'raw_address'; address: string; network: string; save?: { label?: string } }
  // reserved for Spec 2 (do NOT implement now):
  // | { kind: 'internal_user'; recipientUserId: string; displayHandle: string }
```

`resolvePayoutBeneficiary` (`web-chat.service.ts:673`) becomes
`resolveSendDestination(...)` returning either
`{ resolved: true; destination: SendDestination }` or the existing
`{ resolved: false; outcome; summaryText }`. The chat dispatch (send case,
`web-chat.service.ts:358-400`) passes the descriptor to `createSendProposal`.

Because both web and WhatsApp converge on `createSendProposal`
(`whatsapp-flow.controller.ts:419`), the descriptor + engine branch live in the
**engine**, keeping the destination-kind→settlement decision server-side (§3.1).

### 5.2 Contracts changes (`packages/contracts`)

- `SendCryptoIntentSchema` — **UNCHANGED**. The model still emits
  `{ asset, cryptoAmount, network?, recipientNickname? }` and never an address.
- `ChatMessageRequestSchema` (`chat/chat.schemas.ts:10`) — add an optional,
  mutually-exclusive-with-`beneficiaryId` field:
  `sendDestination?: { address: string; network: string; saveAsBeneficiary?: boolean; label?: string }`.
  These are **structured client fields**, never model output. Add a `.refine`
  forbidding both `beneficiaryId` and `sendDestination` in one request.
- `AgentTurnOutcomeSchema` `needs_beneficiary` variant
  (`chat/chat.schemas.ts:44-79`) — add optional `prefillAddress?: string` (the
  edge-parsed token) and `allowRawSend?: boolean` so the card renders the raw
  entry + pre-fill. One card, not a new kind.
- A new `RawSendAddressSchema` (crypto address string, non-empty, bounded) lives
  beside the beneficiary schemas; the engine re-validates against the registry
  regardless.
- `SendProposalConfirmationSchema` — **UNCHANGED**. For an unsaved send
  `beneficiaryLabel` is simply absent; the card shows the masked address alone.

### 5.3 Engine — `createSendProposal` raw branch

`CreateSendProposalInput` (`proposal.service.ts:106`) accepts the discriminated
descriptor instead of only `beneficiaryId`. The method resolves
`toAddress + network` from the descriptor **first**, then runs **every existing
guard unchanged** on that address:

1. amount-floor (`assertCryptoAmountAtLeastMin`, line 641)
2. fee-coverage (line 668)
3. ledger balance (line 678)
4. KYC / velocity / Travel-Rule gate on NGN-equivalent, `onChainSend: true`,
   `capability: 'crypto.send'` (line 735)
5. `AssetRegistry.validateAddress(network, address)` (line 767) — for the raw
   branch this is the **primary** validation (reject → `InvalidSendAddressError`,
   a clean 4xx/clarification, not `BeneficiaryWrongTypeError`)
6. self-send guard: `toAddress === wallet.address` (line 784)
7. sanctions `screenSendDestination({ address, network })` (line 800)
8. **cooling-off (line 789): only for the `saved_beneficiary` kind.** The
   `raw_address` kind skips it (decision §3) — a one-time send is not a reusable
   saved destination.

`proposal.parameters` (line 829) gains a `destinationKind` discriminant;
`beneficiaryId` becomes nullable in the blob (present only for the saved kind).
`toAddress` is persisted exactly as today.

**Settlement is unchanged.** `execution.service.ts:1293-1660` reads
`params.toAddress` (line 1302) and withdraws on-chain — a raw address is just
another `toAddress`. **No execution-service change for Spec 1.** (Guard: the
existing `missing-beneficiaryId` check at ~1311 must be relaxed to
`missing-toAddress` so a raw send with no `beneficiaryId` still executes.)

**Network inference.** The edge parser uses `AssetRegistry.inferNetworkForAddress`
(`asset-registry.ts:656`) to classify the pasted token's network, so the user
need not name it; the engine still re-validates `validateAddress(network,
address)`.

### 5.4 Web chat flow

1. User: *"send 50 USDT to TXYZ…"*. Model emits `send_crypto { asset,
   cryptoAmount }` — no address (§3.1).
2. In the send dispatch, `resolveSendDestination` runs. A **deterministic edge
   parser** checks whether the user's literal message contains an
   address-shaped token (`inferNetworkForAddress`). If the send has **no
   explicit `beneficiaryId` and no matching nickname**, the resolver returns a
   `needs_beneficiary` outcome with `allowRawSend: true` and `prefillAddress`
   set to the parsed token (or empty if none) — **never** the default
   beneficiary. This removes the misroute path.
3. The card (`web/components/chat/cards/needs-beneficiary-card.tsx` + a new
   `add-crypto-form` "send" mode) renders: saved-recipient list **+** an address
   field pre-filled with `prefillAddress` (editable) **+** a **"Save this
   recipient for next time"** toggle (off = send once; on = save + send) **+**
   optional label (shown when the toggle is on). **No PIN field in this mode** —
   unlike today's standalone add form, the send flow collects the PIN once, at
   execute (step 5).
4. On submit, the resolve loop (`web/lib/store/chat-store.ts`
   `sendToAgent`/`resolveBeneficiary`, lines 429-591) re-asks the engine
   carrying `sendDestination: { address, network, saveAsBeneficiary, label }`
   instead of a `beneficiaryId`. The `_beneficiaryIntents` binding
   (message-id → intent text) is generalized to carry either identifier.
5. Confirmation card (masked address) → **PIN + device-bound step-up** →
   execute.
6. **Save timing — single PIN.**
   - *Save & send* (`saveAsBeneficiary: true`): the address is persisted as a
     **side-effect of the send's execute authorization** — the send's PIN +
     device-bound step-up is at least as strong as the standalone
     beneficiary-add step-up (§3.3), so it covers the persist. It does **not**
     re-prompt for a PIN. The saved record carries normal first-use cooling-off
     for **future** reuse (it never blocks the current send).
   - *Save after send*: a **"Save this recipient"** button on the send
     **receipt** is a separate, deliberate action that goes through the standard
     `BeneficiaryService.addCryptoAddress` (`beneficiary.service.ts:278`) with
     its **own** PIN + step-up.
   - *Send once* (toggle off): nothing is persisted.

### 5.5 WhatsApp flow (§3.5)

The WhatsApp send already flows through `createSendProposal`
(`whatsapp-flow.controller.ts:419`). The raw address is captured in an
**E2E-encrypted WhatsApp Flow** form (never plaintext chat), pre-filled from the
edge-parsed inbound message, with the same "save this recipient" toggle. It
resolves to the same engine raw branch → same itemized Flow confirmation → PIN.
No second settlement path, no crypto Commerce object (§3.5).

---

## 6. Invariants preserved

- **§3.1 — model proposes, engine disposes.** The model never emits an address.
  The address originates from a structured client/Flow field the user confirmed;
  the deterministic engine re-validates it and constructs the transaction.
- **§3.1 — no default misroute.** A send with an explicit-but-unsaved
  destination never resolves to the default beneficiary.
- **§3.3 — server-side gates.** KYC / tier / velocity / on-chain cap / sanctions
  all re-run on the user-supplied address, identical to a saved one.
- **§3.4 — device-bound step-up + PIN** remain the last human checkpoint at
  execute.
- **§6 — MCP stays read + propose only.** No new execute surface; the raw-send
  proposal still ends at the signed-directive + PIN flow on web/WhatsApp.

## 7. Error handling

Every failure is an in-chat (or in-Flow) clarification via the existing
`proposalErrorClarification` path (`web-chat.service.ts:808+`), never a 5xx:

- unparseable / invalid address → "That doesn't look like a valid USDT (TRON)
  address — check it and try again."
- sanctions hit → existing `SanctionsBlockedError` clarification.
- self-send → existing `SelfSendError` clarification.
- over-cap / insufficient balance → existing clarifications.

## 8. Testing (TDD, ~100% on the money path)

**Unit**
- `resolveSendDestination`: returns `raw_address` descriptor for a
  client-supplied address; returns `saved_beneficiary` for a picked id; returns
  `needs_beneficiary(allowRawSend, prefillAddress)` for a no-nickname send with a
  parsed address; **never returns the default** when a destination was named.
- `createSendProposal` raw branch: runs validateAddress / self-send / sanctions /
  KYC-velocity / on-chain cap on the user-supplied address; skips cooling-off for
  `raw_address`; persists `destinationKind` + `toAddress`.
- edge parser: extracts a TRON address from message text; ignores non-address
  text; classifies network via `inferNetworkForAddress`.

**e2e (real Postgres via Testcontainers, `web-chat.e2e-spec.ts` sibling)**
- raw-address send end-to-end: stub the agent to `send_crypto`, POST with
  `sendDestination`, assert a `send` proposal is created against the raw address
  (masked) and executes — 200, never 500.
- **misroute regression:** a `send_crypto` with no nickname + a user who HAS a
  default crypto beneficiary must return a `needs_beneficiary` card, **not** a
  proposal to the default.
- save-before (`saveAsBeneficiary: true`) persists a beneficiary + sends;
  save-after persists from the receipt path.

**WhatsApp**
- Flow controller resolves a raw address → `createSendProposal` raw branch
  (controller-level).

---

## 9. File-by-file change map

| File | Change |
| --- | --- |
| `packages/contracts/src/chat/chat.schemas.ts` | `sendDestination` on request; `prefillAddress`/`allowRawSend` on `needs_beneficiary` outcome; refine mutual-exclusion. |
| `packages/contracts/src/intents/send-crypto.intent.ts` | unchanged (documented invariant). |
| `api/src/modules/chat/application/web-chat.service.ts` | `resolvePayoutBeneficiary`→`resolveSendDestination` (descriptor return); edge address parser; no-default-misroute; pass descriptor to engine. |
| `api/src/modules/transactions/application/proposal.service.ts` | `CreateSendProposalInput` takes descriptor; raw branch derives `toAddress`; cooling-off gated to saved kind; `destinationKind` in params. |
| `api/src/modules/transactions/application/execution.service.ts` | relax `missing-beneficiaryId` guard → `missing-toAddress` (raw send has no beneficiaryId). |
| `api/src/core/catalog/asset-registry.ts` | reuse `validateAddress` + `inferNetworkForAddress` (no change; consumed). |
| `api/src/modules/beneficiaries/application/beneficiary.service.ts` | reuse `addCryptoAddress` for save-before/after (no change). |
| `api/src/modules/whatsapp/presentation/whatsapp-flow.controller.ts` | raw-address Flow → descriptor → `createSendProposal`. |
| `web/components/chat/cards/needs-beneficiary/add-crypto-form.tsx` | pre-fill + "save this recipient" toggle + send-once path. |
| `web/components/chat/cards/needs-beneficiary-card.tsx` | thread `prefillAddress`/`allowRawSend`. |
| `web/lib/store/chat-store.ts` | resolve loop carries `sendDestination` descriptor (generalize `_beneficiaryIntents`). |
| receipt component | "Save this recipient" button (save-after-send). |

## 10. Rollout / follow-ups

- The LLM prompt rule 12
  (`anthropic-llm.provider.ts:161`) is updated so a raw-address paste yields
  `send_crypto` (asset+amount, no nickname) rather than `action:"none"`, letting
  the edge parser + card take over. The model still never extracts the address.
- **Sub-project 2 (separate spec):** PayID minted at signup
  (`auth-user.prisma.repository.ts:26` `createSignup` transaction, with a P2002
  collision-retry loop mirroring `bindDevice`), a case-insensitive partial-unique
  index (ChannelIdentity precedent, `02-identity.prisma:381`), surfaced in
  `MeResponseSchema` / `ProfileResponseSchema`; a public-nickname registry
  (recipient-owned, global — NOT the private beneficiary nickname); and the
  `internal_user` destination variant + a ledger-to-ledger settlement branch in
  `execution.service.ts` (`onChainSend: false`, counterparty-user sanctions,
  userId self-send guard). The seam in §5.1 already reserves its shape.
