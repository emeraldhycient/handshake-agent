# Send crypto to a raw address — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user send crypto to a **raw on-chain address** they paste in chat (web + WhatsApp) — not only to a saved beneficiary — and save that address as a beneficiary before or after sending.

**Architecture:** Approach 1 — one engine (`createSendProposal`) accepts *either* a saved `beneficiaryId` *or* a validated user-supplied raw address, expressed as a discriminated `SendDestination` descriptor. The chat edge deterministically parses the address out of the user's own message (never the model) and pre-fills a user-confirmed field; the engine re-validates every guard. Settlement is unchanged (a raw address is just another on-chain `toAddress`). The descriptor's shape reserves the Spec-2 `internal_user` variant.

**Tech Stack:** NestJS 11 + Prisma 7 (api), Next 16 + React 19 + Zustand + TanStack Query (web), Zod contracts (`@handshake-agent/contracts`), Jest (api unit + Testcontainers e2e), Vitest (web).

**Spec:** [`docs/superpowers/specs/2026-07-14-send-to-raw-address-design.md`](../specs/2026-07-14-send-to-raw-address-design.md)

## Global Constraints

- **§3.1** — the NLU/model NEVER emits or extracts a destination address. The address originates only from a structured client/Flow field the user confirmed. `SendCryptoIntentSchema` stays unchanged.
- **§3.1 no-misroute** — a send with an explicit-but-unsaved destination must NEVER resolve to the user's default beneficiary.
- **§3.3** — KYC/tier/velocity/on-chain-cap/sanctions re-run server-side on the user-supplied address, identical to a saved one.
- **Cooling-off** — first-use cooling-off applies only to the `saved_beneficiary` kind; a one-time `raw_address` send is instant (gated by PIN + device-bound step-up + sanctions + on-chain per-send cap + velocity cap). A ticked "save" gives the SAVED record cooling-off for future reuse only.
- **Single PIN** — the send flow collects the PIN once, at execute. Save-before folds into that authorization (no second PIN). Save-after (receipt) is a deliberate action with its own PIN via the standard add-beneficiary path.
- **One zod instance** — schemas live in `@handshake-agent/contracts`; never redefine a crossing shape.
- **Money path = ~100% coverage** — every `createSendProposal`/`resolveSendDestination` branch is unit-tested; the vertical is covered by an api Testcontainers e2e (local lane).
- **Commit style** — Conventional Commits (`feat(api):`, `feat(web):`, `feat(contracts):`, `test(api):`). One coherent change per commit.
- Run the api e2e locally (`pnpm --filter @handshake-agent/api test:e2e`); it needs Docker Postgres + Redis :6379.

---

## File change map

| File | Responsibility |
| --- | --- |
| `packages/contracts/src/chat/chat.schemas.ts` | `SendDestinationInputSchema`; `sendDestination` on the request (xor `beneficiaryId`); `prefillAddress`/`allowRawSend` on the `needs_beneficiary` outcome. |
| `api/src/modules/transactions/application/proposal.service.ts` | `SendDestination` descriptor type; `CreateSendProposalInput.destination`; `createSendProposal` raw branch + guards + `destinationKind`/`saveAsBeneficiary` params. |
| `api/src/modules/transactions/application/execution.service.ts` | Guard relax (require `toAddress`, not `beneficiaryId`); persist beneficiary on success when `saveAsBeneficiary` is set. |
| `api/src/modules/transactions/domain/*` | New `InvalidSendAddressError` domain error. |
| `api/src/modules/chat/application/web-chat.service.ts` | `resolveSendDestination` (descriptor return, no-misroute); deterministic edge address parser; dispatch wiring. |
| `api/test/send-raw-address.e2e-spec.ts` | Testcontainers vertical: raw send, save-before, misroute regression. |
| `api/src/modules/agent/infrastructure/anthropic-llm.provider.ts` | Prompt rule 12 → raw-address paste yields `send_crypto` (no nickname), never `action:"none"`. |
| `api/src/modules/whatsapp/presentation/whatsapp-flow.controller.ts` | Raw-address Flow screen → `createSendProposal` raw branch. |
| `web/components/chat/cards/needs-beneficiary/add-crypto-form.tsx` | "send" mode: prefilled address, save toggle, no PIN. |
| `web/components/chat/cards/needs-beneficiary-card.tsx` + `web/types/*` | Thread `prefillAddress`/`allowRawSend`; generalize resolve callback. |
| `web/lib/store/chat-store.ts` | Resolve loop carries a `sendDestination` descriptor (generalize `_beneficiaryIntents`). |
| `web/components/chat/cards/receipt` (tx-detail) | "Save this recipient" button (save-after-send). |

---

## Task 1: Contracts — `sendDestination` request + outcome pre-fill

**Files:**
- Modify: `packages/contracts/src/chat/chat.schemas.ts`
- Test: `packages/contracts/src/chat/chat.schemas.spec.ts`

**Interfaces:**
- Produces: `SendDestinationInputSchema` = `{ address: string; network: string; saveAsBeneficiary?: boolean; label?: string }`; `ChatMessageRequest` gains optional `sendDestination` (xor `beneficiaryId`); `needs_beneficiary` outcome gains optional `prefillAddress: string`, `allowRawSend: boolean`.

- [ ] **Step 1: Write the failing tests** (append to `chat.schemas.spec.ts`)

```ts
import {
  ChatMessageRequestSchema,
  AgentTurnOutcomeSchema,
} from './chat.schemas'

describe('ChatMessageRequestSchema — sendDestination', () => {
  it('accepts a raw sendDestination', () => {
    const r = ChatMessageRequestSchema.parse({
      text: 'send 50 USDT',
      sendDestination: { address: 'TXYZ1234567890', network: 'TRON', saveAsBeneficiary: true, label: 'Mum' },
    })
    expect(r.sendDestination?.address).toBe('TXYZ1234567890')
  })

  it('rejects both beneficiaryId AND sendDestination in one request', () => {
    expect(() =>
      ChatMessageRequestSchema.parse({
        text: 'send 50 USDT',
        beneficiaryId: '11111111-1111-1111-1111-111111111111',
        sendDestination: { address: 'TXYZ', network: 'TRON' },
      }),
    ).toThrow()
  })
})

describe('needs_beneficiary outcome — raw send affordance', () => {
  it('carries prefillAddress + allowRawSend', () => {
    const o = AgentTurnOutcomeSchema.parse({
      kind: 'needs_beneficiary',
      beneficiaryType: 'crypto_address',
      prefillAddress: 'TXYZ1234567890',
      allowRawSend: true,
    })
    expect(o).toMatchObject({ prefillAddress: 'TXYZ1234567890', allowRawSend: true })
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @handshake-agent/contracts test -- chat.schemas`
Expected: FAIL (`sendDestination`/`prefillAddress` not in schema; xor refine absent).

- [ ] **Step 3: Implement** — in `chat.schemas.ts`, add `NetworkSchema` to the `../common` import (line 7), then:

```ts
// after the imports
export const SendDestinationInputSchema = z.object({
  // On-chain address — pattern re-validated server-side against the network.
  address: z.string().min(1).max(120),
  network: NetworkSchema,
  // Persist this address as a saved beneficiary as part of this send.
  saveAsBeneficiary: z.boolean().optional(),
  label: z.string().min(1).max(60).optional(),
})
export type SendDestinationInput = z.infer<typeof SendDestinationInputSchema>
```

Replace `ChatMessageRequestSchema` (lines 10-15):

```ts
export const ChatMessageRequestSchema = z
  .object({
    text: z.string().min(1).max(1000),
    // Optional: pre-selected saved beneficiary (skip the lookup step).
    beneficiaryId: z.string().uuid().optional(),
    // Optional: a USER-SUPPLIED raw destination (§3.1 — never model output),
    // captured in the send-to-address card / Flow. Mutually exclusive with
    // beneficiaryId; the engine re-validates the address before any send.
    sendDestination: SendDestinationInputSchema.optional(),
  })
  .refine((d) => !(d.beneficiaryId && d.sendDestination), {
    message: 'Provide either beneficiaryId or sendDestination, not both.',
  })
export type ChatMessageRequest = z.infer<typeof ChatMessageRequestSchema>
```

In the `needs_beneficiary` branch (lines 45-53) add two optional fields after `note`:

```ts
    note: z.string().optional(),
    /** Edge-parsed address from the user's own message, to pre-fill the card. */
    prefillAddress: z.string().optional(),
    /** When true, the card offers a raw-address send path (crypto only). */
    allowRawSend: z.boolean().optional(),
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @handshake-agent/contracts test -- chat.schemas`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/chat/chat.schemas.ts packages/contracts/src/chat/chat.schemas.spec.ts
git commit -m "feat(contracts): add sendDestination + raw-send card fields to chat schemas"
```

---

## Task 2: Engine — `SendDestination` descriptor + `createSendProposal` raw branch

**Files:**
- Create: `api/src/modules/transactions/domain/invalid-send-address.error.ts`
- Modify: `api/src/modules/transactions/application/proposal.service.ts` (`CreateSendProposalInput` ~106-112; `createSendProposal` 633-873)
- Test: `api/src/modules/transactions/application/proposal.service.spec.ts`

**Interfaces:**
- Consumes: `AssetRegistry.validateAddress(network, address): boolean` (`asset-registry.ts:641`).
- Produces:
  ```ts
  export type SendDestination =
    | { kind: 'saved_beneficiary'; beneficiaryId: string }
    | { kind: 'raw_address'; address: string; network: string; save?: { label?: string } };
  ```
  `CreateSendProposalInput.destination: SendDestination` (replaces `beneficiaryId: string`). Proposal `parameters` gains `destinationKind: 'saved_beneficiary' | 'raw_address'`, nullable `beneficiaryId`, and optional `saveAsBeneficiary: 'true'` + `saveLabel`.

- [ ] **Step 1: Write the failing tests** (add to `proposal.service.spec.ts`, mirroring the existing send tests' fixtures)

```ts
describe('createSendProposal — raw_address destination', () => {
  it('creates a proposal to a user-supplied raw address (no beneficiary lookup)', async () => {
    // assetRegistry.validateAddress → true; ledger balance sufficient; kycGate passes.
    const out = await service.createSendProposal({
      userId,
      intent: { action: 'send_crypto', asset: 'USDT', cryptoAmount: '5', network: 'TRON' },
      destination: { kind: 'raw_address', address: 'TValidAddr000000000001', network: 'TRON' },
    })
    expect(out.confirmation.toAddressMasked).toMatch(/^TValid.*0001$/)
    expect(out.confirmation.beneficiaryLabel).toBeUndefined()
    expect(beneficiaryService.getById).not.toHaveBeenCalled()
  })

  it('rejects an invalid raw address with InvalidSendAddressError (not a 5xx)', async () => {
    assetRegistry.validateAddress.mockReturnValue(false)
    await expect(
      service.createSendProposal({
        userId,
        intent: { action: 'send_crypto', asset: 'USDT', cryptoAmount: '5', network: 'TRON' },
        destination: { kind: 'raw_address', address: 'not-an-address', network: 'TRON' },
      }),
    ).rejects.toBeInstanceOf(InvalidSendAddressError)
  })

  it('runs the self-send guard on a raw address (own wallet address → SelfSendError)', async () => {
    await expect(
      service.createSendProposal({
        userId,
        intent: { action: 'send_crypto', asset: 'USDT', cryptoAmount: '5', network: 'TRON' },
        destination: { kind: 'raw_address', address: wallet.address, network: 'TRON' },
      }),
    ).rejects.toBeInstanceOf(SelfSendError)
  })

  it('screens the raw address for sanctions (blocked → SanctionsBlockedError)', async () => {
    complianceService.screenSendDestination.mockResolvedValue({ passed: false, reason: 'ofac', complianceEventId: 'e1' })
    await expect(
      service.createSendProposal({
        userId,
        intent: { action: 'send_crypto', asset: 'USDT', cryptoAmount: '5', network: 'TRON' },
        destination: { kind: 'raw_address', address: 'TSanctioned00000000001', network: 'TRON' },
      }),
    ).rejects.toBeInstanceOf(SanctionsBlockedError)
  })

  it('does NOT apply first-use cooling-off to a raw send', async () => {
    // No beneficiary record → cooling-off cannot even be read; proposal succeeds.
    const out = await service.createSendProposal({
      userId,
      intent: { action: 'send_crypto', asset: 'USDT', cryptoAmount: '5', network: 'TRON' },
      destination: { kind: 'raw_address', address: 'TValidAddr000000000002', network: 'TRON' },
    })
    expect(out.proposalId).toBeDefined()
  })

  it('persists destinationKind=raw_address + null beneficiaryId + save flag', async () => {
    await service.createSendProposal({
      userId,
      intent: { action: 'send_crypto', asset: 'USDT', cryptoAmount: '5', network: 'TRON' },
      destination: { kind: 'raw_address', address: 'TValidAddr000000000003', network: 'TRON', save: { label: 'Mum' } },
    })
    expect(proposalRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        parameters: expect.objectContaining({
          destinationKind: 'raw_address',
          toAddress: 'TValidAddr000000000003',
          beneficiaryId: null,
          saveAsBeneficiary: 'true',
          saveLabel: 'Mum',
        }),
      }),
    )
  })
})

describe('createSendProposal — saved_beneficiary destination (unchanged behaviour)', () => {
  it('still resolves the address from the saved beneficiary + applies cooling-off', async () => {
    const out = await service.createSendProposal({
      userId,
      intent: { action: 'send_crypto', asset: 'USDT', cryptoAmount: '5', network: 'TRON' },
      destination: { kind: 'saved_beneficiary', beneficiaryId },
    })
    expect(beneficiaryService.getById).toHaveBeenCalledWith(userId, beneficiaryId)
    expect(out.confirmation.beneficiaryLabel).toBeDefined()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @handshake-agent/api test -- proposal.service`
Expected: FAIL (`destination` not accepted; `InvalidSendAddressError` undefined).

- [ ] **Step 3a: Create the domain error** (`api/src/modules/transactions/domain/invalid-send-address.error.ts`)

```ts
/**
 * Raised when a user-supplied raw send address fails the network's pattern
 * validation. Maps to a clean in-chat clarification (never a 5xx), mirroring
 * the other proposal-builder rejections.
 */
export class InvalidSendAddressError extends Error {
  readonly code = 'INVALID_SEND_ADDRESS';
  constructor(
    readonly address: string,
    readonly network: string,
  ) {
    super(`Invalid ${network} address: ${address}`);
    this.name = 'InvalidSendAddressError';
  }
}
```

- [ ] **Step 3b: Change the input type** (`proposal.service.ts` 106-112)

```ts
export type SendDestination =
  | { kind: 'saved_beneficiary'; beneficiaryId: string }
  | { kind: 'raw_address'; address: string; network: string; save?: { label?: string } };
  // reserved for Spec 2 (do NOT implement now):
  // | { kind: 'internal_user'; recipientUserId: string; displayHandle: string };

export interface CreateSendProposalInput {
  userId: string;
  conversationId?: string;
  intent: SendCryptoIntent;
  /** Where to send: a saved beneficiary or a user-supplied raw address (§3.1). */
  destination: SendDestination;
}
```

- [ ] **Step 3c: Refactor the destination resolution in `createSendProposal`** — replace the destructure at line 636 (`const { userId, conversationId, intent, beneficiaryId } = input;` → drop `beneficiaryId`, add `destination`) and replace the beneficiary block (lines 750-797) with a branch that derives `toAddress`/`beneficiaryLabel` and runs cooling-off ONLY for the saved kind. Guards at 767-812 (validateAddress, self-send, sanctions) stay but move to operate on the resolved `toAddress`:

```ts
    // 5. Resolve the destination address (saved beneficiary OR user-supplied raw).
    let toAddress: string;
    let beneficiaryLabel: string | undefined;
    let beneficiaryIdForParams: string | null = null;
    let saveAsBeneficiary = false;
    let saveLabel: string | undefined;

    if (input.destination.kind === 'saved_beneficiary') {
      beneficiaryIdForParams = input.destination.beneficiaryId;
      const beneficiary = await this.beneficiaryService.getById(
        userId,
        input.destination.beneficiaryId,
      );
      if (beneficiary === null) {
        throw new BeneficiaryNotFoundError(input.destination.beneficiaryId);
      }
      if (beneficiary.type !== 'crypto_address') {
        throw new BeneficiaryWrongTypeError(
          input.destination.beneficiaryId,
          'crypto_address',
          beneficiary.type,
        );
      }
      toAddress = beneficiary.cryptoAddress!;
      beneficiaryLabel = beneficiary.label || undefined;
      // First-use cooling-off (IDN-08) — SAVED destinations only.
      if (
        beneficiary.firstUseLockedUntil !== null &&
        beneficiary.firstUseLockedUntil > now
      ) {
        throw new BeneficiaryCoolingOffError(
          input.destination.beneficiaryId,
          beneficiary.firstUseLockedUntil,
        );
      }
    } else {
      // raw_address — the address originated from a user-confirmed field (§3.1).
      toAddress = input.destination.address;
      saveAsBeneficiary = input.destination.save !== undefined;
      saveLabel = input.destination.save?.label;
    }

    // 5a. Address pattern validation — primary check for the raw branch,
    // defensive re-check for the saved branch.
    if (!this.assetRegistry.validateAddress(intent.network, toAddress)) {
      throw new InvalidSendAddressError(toAddress, intent.network);
    }

    // 5b. Self-send guard (finding #5) — sending to the user's OWN address.
    if (toAddress.toLowerCase() === wallet.address.toLowerCase()) {
      throw new SelfSendError();
    }

    // 7. Sanctions screening on the resolved address — BEFORE persisting.
    const screeningResult = await this.complianceService.screenSendDestination({
      userId,
      address: toAddress,
      network: intent.network,
    });
    if (!screeningResult.passed) {
      throw new SanctionsBlockedError(
        toAddress,
        screeningResult.reason,
        screeningResult.complianceEventId,
        screeningResult.complianceEventId,
      );
    }
```

Update the `parameters` blob (lines 829-839) to carry the new fields:

```ts
    const parameters: Record<string, unknown> = {
      asset: intent.asset,
      cryptoAmount: intent.cryptoAmount,
      network: intent.network,
      networkFeeCrypto,
      totalDebit,
      destinationKind: input.destination.kind,
      beneficiaryId: beneficiaryIdForParams,
      walletId: wallet.id,
      toAddress,
      requiresTravelRule,
      ...(saveAsBeneficiary ? { saveAsBeneficiary: 'true', saveLabel: saveLabel ?? '' } : {}),
    };
```

Import `InvalidSendAddressError` at the top of `proposal.service.ts`.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @handshake-agent/api test -- proposal.service`
Expected: PASS (both raw + saved describe blocks).

- [ ] **Step 5: Commit**

```bash
git add api/src/modules/transactions/domain/invalid-send-address.error.ts api/src/modules/transactions/application/proposal.service.ts api/src/modules/transactions/application/proposal.service.spec.ts
git commit -m "feat(api): accept a user-supplied raw address in createSendProposal"
```

---

## Task 3: Engine — execution guard relax + save-on-success

**Files:**
- Modify: `api/src/modules/transactions/application/execution.service.ts` (send params 1293-1322; post-settlement)
- Test: `api/src/modules/transactions/application/execution.service.spec.ts`

**Interfaces:**
- Consumes: `params.destinationKind`, `params.beneficiaryId` (nullable), `params.toAddress`, `params.saveAsBeneficiary`, `params.saveLabel` from Task 2.
- Consumes: `beneficiaryService.addCryptoAddress({ userId, address, network, asset, label })` (`beneficiary.service.ts:278`) — the persist path (PIN/step-up already satisfied by the send's execute auth).

- [ ] **Step 1: Write the failing tests**

```ts
describe('executeSend — raw address', () => {
  it('executes a raw-address send with no beneficiaryId (guard no longer requires it)', async () => {
    // proposal.parameters: { destinationKind: 'raw_address', beneficiaryId: null, toAddress: 'TRaw…', walletId, network, … }
    await expect(service.execute(proposalId, execCtx)).resolves.toBeDefined()
    expect(walletProvider.withdraw).toHaveBeenCalledWith(expect.objectContaining({ toAddress: 'TRawExecAddr0000000001' }))
  })

  it('still rejects a proposal missing toAddress', async () => {
    // parameters.toAddress = '' → ProposalNotExecutableError
    await expect(service.execute(proposalIdNoAddr, execCtx)).rejects.toThrow(/missing toAddress/)
  })

  it('persists the beneficiary on success when saveAsBeneficiary is set (no second PIN)', async () => {
    // parameters.saveAsBeneficiary = 'true', saveLabel = 'Mum'
    await service.execute(proposalIdSave, execCtx)
    expect(beneficiaryService.addCryptoAddress).toHaveBeenCalledWith(
      expect.objectContaining({ userId, address: 'TRawExecAddr0000000002', label: 'Mum' }),
    )
  })

  it('does NOT persist when saveAsBeneficiary is absent', async () => {
    await service.execute(proposalIdNoSave, execCtx)
    expect(beneficiaryService.addCryptoAddress).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @handshake-agent/api test -- execution.service`
Expected: FAIL (guard still requires beneficiaryId; no save side-effect).

- [ ] **Step 3: Implement** — replace the guard block (`execution.service.ts` 1300-1322):

```ts
    const beneficiaryId = params.beneficiaryId || null;
    const walletId = params.walletId;
    const toAddress = params.toAddress ?? '';
    const network = params.network;
    if (!network) {
      throw new ProposalNotExecutableError('proposal parameters missing network');
    }
    const requiresTravelRule = params.requiresTravelRule === 'true';

    // A raw-address send carries no beneficiaryId — require the destination
    // ADDRESS instead (the on-chain withdraw target), not the beneficiary.
    if (!toAddress) {
      throw new ProposalNotExecutableError('proposal parameters missing toAddress');
    }
    if (!walletId) {
      throw new ProposalNotExecutableError('proposal parameters missing walletId');
    }
```

After the successful on-chain withdraw (end of the send settlement, ~line 1636, after the tx is queued/recorded), add the save side-effect:

```ts
    // Save-before-send: persist the raw destination as a saved beneficiary now
    // that the send's PIN + device-bound step-up have authorized it (§3.3 —
    // no second PIN; the send auth is at least as strong as add-on step-up).
    // Cooling-off on the new record governs FUTURE reuse only, not this send.
    if (params.saveAsBeneficiary === 'true') {
      try {
        await this.beneficiaryService.addCryptoAddress({
          userId: proposal.userId,
          address: toAddress,
          network,
          asset,
          label: params.saveLabel || toAddress.slice(0, 8),
        });
      } catch (err) {
        // A failed save must NOT fail the (already-settled) send. Log + move on.
        this.logger.warn(
          { errorName: err instanceof Error ? err.name : 'unknown', proposalId: proposal.id },
          'save-after-send-authorization failed; send already settled',
        );
      }
    }
```

Ensure `execution.service.ts` injects `beneficiaryService` (add to the constructor via its port if not already present) and a `logger`.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @handshake-agent/api test -- execution.service`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/src/modules/transactions/application/execution.service.ts api/src/modules/transactions/application/execution.service.spec.ts
git commit -m "feat(api): execute raw-address sends + persist saved beneficiary on success"
```

---

## Task 4: Chat — `resolveSendDestination` (descriptor, no-misroute, edge parser)

**Files:**
- Modify: `api/src/modules/chat/application/web-chat.service.ts` (`resolvePayoutBeneficiary` 673-761 → add crypto descriptor return + edge parser; keep the bank path)
- Test: `api/src/modules/chat/application/web-chat.service.spec.ts`

**Interfaces:**
- Consumes: `AssetRegistry.inferNetworkForAddress(address): string | null` (`asset-registry.ts:656`), `AssetRegistry.validateAddress`.
- Produces: a crypto-destination resolver returning
  ```ts
  | { resolved: true; destination: SendDestination }
  | { resolved: false; outcome: AgentTurnOutcome; summaryText: string }
  ```
  and a helper `parseAddressFromText(text: string): { address: string; network: string } | null`.

- [ ] **Step 1: Write the failing tests**

```ts
describe('resolveSendDestination (crypto)', () => {
  it('returns a raw_address descriptor when the request carries sendDestination', async () => {
    const r = await service.resolveSendDestination(userId, {
      sendDestination: { address: 'TValidAddr0000000001', network: 'TRON', saveAsBeneficiary: true, label: 'Mum' },
    }, /*recipientNickname*/ undefined, /*messageText*/ 'send 50 USDT to TValidAddr0000000001')
    expect(r).toEqual({ resolved: true, destination: { kind: 'raw_address', address: 'TValidAddr0000000001', network: 'TRON', save: { label: 'Mum' } } })
  })

  it('a raw-address paste with NO saved match returns needs_beneficiary(allowRawSend, prefillAddress) — NEVER the default', async () => {
    beneficiaryService.getDefault.mockResolvedValue({ id: 'default-ben' }) // user HAS a default
    assetRegistry.inferNetworkForAddress.mockReturnValue('TRON')
    const r = await service.resolveSendDestination(userId, {}, undefined, 'send 50 USDT to TPastedAddr0000001')
    expect(r).toMatchObject({
      resolved: false,
      outcome: { kind: 'needs_beneficiary', beneficiaryType: 'crypto_address', allowRawSend: true, prefillAddress: 'TPastedAddr0000001' },
    })
    expect(beneficiaryService.getDefault).not.toHaveBeenCalled()
  })

  it('an explicit beneficiaryId still resolves to a saved_beneficiary descriptor', async () => {
    const r = await service.resolveSendDestination(userId, { beneficiaryId: 'ben-1' }, undefined, 'send 50')
    expect(r).toEqual({ resolved: true, destination: { kind: 'saved_beneficiary', beneficiaryId: 'ben-1' } })
  })

  it('a bare "send 50 USDT" (no address, no nickname, no id) offers the card, not the silent default', async () => {
    const r = await service.resolveSendDestination(userId, {}, undefined, 'send 50 USDT')
    expect(r).toMatchObject({ resolved: false, outcome: { kind: 'needs_beneficiary', allowRawSend: true } })
    expect(r.outcome).not.toHaveProperty('prefillAddress')
  })

  it('a matching nickname resolves to a saved_beneficiary (unchanged) ', async () => {
    beneficiaryService.resolveByNickname.mockResolvedValue([{ id: 'ben-mum' }])
    const r = await service.resolveSendDestination(userId, {}, 'mum', 'send 50 USDT to mum')
    expect(r).toEqual({ resolved: true, destination: { kind: 'saved_beneficiary', beneficiaryId: 'ben-mum' } })
  })
})

describe('parseAddressFromText', () => {
  it('extracts a TRON address token and its network', () => {
    expect(service.parseAddressFromText('send 50 USDT to TValidAddr0000000001 now'))
      .toEqual({ address: 'TValidAddr0000000001', network: 'TRON' })
  })
  it('returns null when no address-shaped token is present', () => {
    expect(service.parseAddressFromText('send 50 USDT to mum')).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @handshake-agent/api test -- web-chat.service`
Expected: FAIL (`resolveSendDestination`/`parseAddressFromText` undefined).

- [ ] **Step 3: Implement** — add `parseAddressFromText` (deterministic, uses the registry, NOT the model) and `resolveSendDestination` for crypto. Keep `resolvePayoutBeneficiary` for the bank/sell path (unchanged). `parseAddressFromText` tokenizes on whitespace and asks the registry to classify each token:

```ts
  /**
   * Deterministic edge parser (§3.1 — NOT the model): scans the user's OWN
   * message for an address-shaped token and classifies its network via the
   * registry. Used only to pre-fill the user-confirmed card + to force the
   * card instead of the default beneficiary; the engine re-validates.
   */
  parseAddressFromText(text: string): { address: string; network: string } | null {
    for (const token of text.split(/\s+/)) {
      if (token.length < 20) continue; // skip words; addresses are long
      const network = this.assetRegistry.inferNetworkForAddress(token);
      if (network) return { address: token, network };
    }
    return null;
  }

  /**
   * Resolve a CRYPTO send destination to a discriminated descriptor. Precedence:
   *   1. explicit sendDestination (user-confirmed raw address) → raw_address
   *   2. explicit beneficiaryId → saved_beneficiary
   *   3. recipientNickname → saved_beneficiary (0→card, >1→choose)
   *   4. an address parsed from the message text → needs_beneficiary(prefill)
   *   5. otherwise → needs_beneficiary(allowRawSend) — NEVER the default (§3.1).
   */
  async resolveSendDestination(
    userId: string,
    req: { beneficiaryId?: string; sendDestination?: SendDestinationInput },
    recipientNickname: string | undefined,
    messageText: string,
  ): Promise<
    | { resolved: true; destination: SendDestination }
    | { resolved: false; outcome: AgentTurnOutcome; summaryText: string }
  > {
    if (req.sendDestination) {
      const d = req.sendDestination;
      return {
        resolved: true,
        destination: {
          kind: 'raw_address',
          address: d.address,
          network: d.network,
          ...(d.saveAsBeneficiary ? { save: { label: d.label } } : {}),
        },
      };
    }
    if (req.beneficiaryId) {
      return { resolved: true, destination: { kind: 'saved_beneficiary', beneficiaryId: req.beneficiaryId } };
    }
    if (recipientNickname) {
      const matches = await this.beneficiaryService.resolveByNickname(userId, 'crypto_address', recipientNickname);
      if (matches.length === 1) {
        return { resolved: true, destination: { kind: 'saved_beneficiary', beneficiaryId: matches[0].id } };
      }
      if (matches.length > 1) {
        return {
          resolved: false,
          outcome: {
            kind: 'choose_beneficiary',
            beneficiaryType: 'crypto_address',
            nickname: recipientNickname,
            candidates: matches.map((m) => ({ id: m.id, label: m.label, detail: maskBeneficiaryDetail(m) })),
          },
          summaryText: `You have ${matches.length} saved recipients called '${recipientNickname}'. Which one did you mean?`,
        };
      }
      // 0 matches — offer the card WITH raw send, never the default.
      const note = `No saved recipient called '${recipientNickname}'. Send to an address or add one.`;
      return {
        resolved: false,
        outcome: { kind: 'needs_beneficiary', beneficiaryType: 'crypto_address', note, allowRawSend: true },
        summaryText: note,
      };
    }
    // No explicit destination in the request — offer the card. Pre-fill from a
    // pasted address if present. NEVER fall through to the default beneficiary.
    const parsed = this.parseAddressFromText(messageText);
    return {
      resolved: false,
      outcome: {
        kind: 'needs_beneficiary',
        beneficiaryType: 'crypto_address',
        allowRawSend: true,
        ...(parsed ? { prefillAddress: parsed.address } : {}),
      },
      summaryText: 'Where would you like to send it? Pick a saved recipient or paste an address.',
    };
  }
```

Import `SendDestination` from `proposal.service.ts` and `SendDestinationInput` from contracts.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @handshake-agent/api test -- web-chat.service`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/src/modules/chat/application/web-chat.service.ts api/src/modules/chat/application/web-chat.service.spec.ts
git commit -m "feat(api): resolveSendDestination — raw-address descriptor + no default misroute"
```

---

## Task 5: Chat — wire the send dispatch to the descriptor

**Files:**
- Modify: `api/src/modules/chat/application/web-chat.service.ts` (send_crypto case 358-400; the `handleMessage` request type must carry `sendDestination` + `messageText`)
- Test: `api/src/modules/chat/application/web-chat.service.spec.ts`

**Interfaces:**
- Consumes: `resolveSendDestination` (Task 4), `createSendProposal({ userId, intent, destination })` (Task 2).

- [ ] **Step 1: Write the failing test**

```ts
it('send_crypto with a sendDestination creates a raw-address proposal', async () => {
  fakeAgentPort.run.mockResolvedValue({ action: 'send_crypto', asset: 'USDT', cryptoAmount: '5', network: 'TRON' })
  proposalService.createSendProposal.mockResolvedValue({ proposalId: 'p1', confirmation: { toAddressMasked: 'TRaw…0001' } })
  const res = await service.handleMessage({
    userId, text: 'send 5 USDT to TRawAddr0000000001',
    sendDestination: { address: 'TRawAddr0000000001', network: 'TRON' },
  })
  expect(proposalService.createSendProposal).toHaveBeenCalledWith(
    expect.objectContaining({ destination: { kind: 'raw_address', address: 'TRawAddr0000000001', network: 'TRON' } }),
  )
  expect(res.outcome).toMatchObject({ kind: 'proposal', txType: 'send' })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @handshake-agent/api test -- web-chat.service`
Expected: FAIL.

- [ ] **Step 3: Implement** — thread `sendDestination` + the raw message text through `handleMessage` and rewrite the `send_crypto` case (358-400):

```ts
      case 'send_crypto': {
        if (!this.meetsCapability(user, 'crypto.send')) {
          outcome = { kind: 'needs_kyc' };
          summaryText = 'KYC required';
          break;
        }
        const sendResolution = await this.resolveSendDestination(
          userId,
          { beneficiaryId: input.beneficiaryId, sendDestination: input.sendDestination },
          intent.recipientNickname,
          input.text,
        );
        if (!sendResolution.resolved) {
          outcome = sendResolution.outcome;
          summaryText = sendResolution.summaryText;
          break;
        }
        try {
          const { proposalId: snp, confirmation: snc } =
            await this.proposalService.createSendProposal({
              userId,
              intent,
              destination: sendResolution.destination,
            });
          outcome = { kind: 'proposal', txType: 'send', proposalId: snp, confirmation: snc };
          summaryText = 'Your send proposal is ready. Please review and confirm.';
        } catch (sendErr) {
          const clarification = this.proposalErrorClarification(sendErr);
          if (clarification === null) throw sendErr;
          outcome = { kind: 'clarification', text: clarification };
          summaryText = clarification;
        }
        break;
      }
```

Add `InvalidSendAddressError` to the `proposalErrorClarification` mapping (a clean "that doesn't look like a valid TRON address" message). Add `sendDestination?: SendDestinationInput` to the `handleMessage` input type and the controller DTO (`ChatMessageRequestSchema` already carries it — Task 1). Ensure the controller passes `input.text` through (it already receives `text`).

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @handshake-agent/api test -- web-chat.service`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/src/modules/chat/application/web-chat.service.ts api/src/modules/chat/application/web-chat.service.spec.ts
git commit -m "feat(api): dispatch send_crypto through the destination descriptor"
```

---

## Task 6: api e2e — raw-address send vertical (Testcontainers)

**Files:**
- Create: `api/test/send-raw-address.e2e-spec.ts` (bootstrap copied from `api/test/web-chat.e2e-spec.ts`)

**Interfaces:** consumes the full HTTP surface (`POST /chat/messages`, authorize/execute), with the LLM + wallet + payment providers faked exactly as in `web-chat.e2e-spec.ts`.

- [ ] **Step 1: Write the failing tests** (after copying the `web-chat.e2e-spec.ts` beforeAll/afterAll bootstrap verbatim)

```ts
it('sends to a raw address end-to-end (no saved beneficiary) — 200, never 500', async () => {
  const { accessToken } = await mintTier1User(app, { email: `raw_${Date.now()}@test.com`, pin: '1357' })
  await prisma.user.update({ where: { /* userId */ }, data: { kycTier: 'tier_2' } }) // crypto.send is tier_2
  fakeLlmProvider.extractIntent.mockResolvedValueOnce({ action: 'send_crypto', asset: 'USDT', cryptoAmount: '2', network: 'TRON' })
  const res = await request(app.getHttpServer())
    .post('/chat/messages')
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ text: 'send 2 USDT to TRawE2eAddr0000000001', sendDestination: { address: 'TRawE2eAddr0000000001', network: 'TRON' } })
    .expect(200)
  expect((res.body as { outcome: { kind: string; txType?: string } }).outcome).toMatchObject({ kind: 'proposal', txType: 'send' })
})

it('a raw-address paste with NO explicit sendDestination + a default beneficiary → needs_beneficiary card, NOT the default (misroute regression)', async () => {
  // seed a default crypto beneficiary for the user, then:
  fakeLlmProvider.extractIntent.mockResolvedValueOnce({ action: 'send_crypto', asset: 'USDT', cryptoAmount: '2', network: 'TRON' })
  const res = await request(app.getHttpServer())
    .post('/chat/messages').set('Authorization', `Bearer ${accessToken}`)
    .send({ text: 'send 2 USDT to TSomeOtherAddr00000001' })
    .expect(200)
  const body = res.body as { outcome: { kind: string; allowRawSend?: boolean; prefillAddress?: string } }
  expect(body.outcome.kind).toBe('needs_beneficiary')
  expect(body.outcome.allowRawSend).toBe(true)
  expect(body.outcome.prefillAddress).toBe('TSomeOtherAddr00000001')
})

it('save-before persists a beneficiary once the send executes', async () => {
  // drive proposal → authorize → execute with sendDestination.saveAsBeneficiary=true,
  // then assert prisma.beneficiary has a crypto_address row for the user.
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @handshake-agent/api test:e2e -- send-raw-address`
Expected: FAIL until Tasks 1-5 are merged (run after them).

- [ ] **Step 3:** No new production code — this task validates Tasks 1-5 end-to-end. If it surfaces a gap, fix in the owning task.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @handshake-agent/api test:e2e -- send-raw-address`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add api/test/send-raw-address.e2e-spec.ts
git commit -m "test(api): e2e for raw-address send + misroute regression + save-before"
```

---

## Task 7: Agent prompt — raw-address paste yields send_crypto

**Files:**
- Modify: `api/src/modules/agent/infrastructure/anthropic-llm.provider.ts:161` (prompt rule 12)

**Interfaces:** none (prompt text). Verified by the Task 6 e2e (which stubs the model) plus manual live check.

- [ ] **Step 1: Read the current rule 12** at `anthropic-llm.provider.ts:161`.

- [ ] **Step 2: Rewrite the last sentence** so a raw-address paste yields `send_crypto` with asset+amount and NO `recipientNickname` (never `action:"none"`), while keeping the hard §3.1 rule that the model must not put the address into any field:

```
12. ... When the user pastes a raw crypto address or bank account number as the
    destination, DO extract the asset and amount and return action "send_crypto"
    with NO recipientNickname — but you MUST NOT copy the address/account number
    into any field. The server resolves the destination from the user's message
    and a confirmed form field; you only capture what to send, never where.
```

- [ ] **Step 3: Verify** — run the api unit suite (no behavioural test asserts prompt text, so this is a smoke check):

Run: `pnpm --filter @handshake-agent/api typecheck`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add api/src/modules/agent/infrastructure/anthropic-llm.provider.ts
git commit -m "feat(api): prompt — a raw-address paste yields send_crypto, not a dead-end"
```

---

## Task 8: Web — `add-crypto-form` "send" mode (prefill + save toggle, no PIN)

**Files:**
- Modify: `web/components/chat/cards/needs-beneficiary/add-crypto-form.tsx`
- Modify: `web/components/chat/cards/needs-beneficiary-card.tsx`; `web/types/components.ts` (`NeedsBeneficiaryView`/`NeedsBeneficiaryCardProps`); `web/types/chat.ts` (`BeneficiaryFormProps`)
- Test: `web/components/chat/cards/needs-beneficiary/add-crypto-form.test.tsx`

**Interfaces:**
- Produces: `AddCryptoForm` gains props `{ mode?: 'add' | 'send'; prefillAddress?: string; onSend?: (d: { address: string; network: string; saveAsBeneficiary: boolean; label?: string }) => void }`. In `send` mode: no PIN field; a "Save this recipient for next time" toggle; submit calls `onSend` (not the add mutation).
- Consumes (parent): `NeedsBeneficiaryCardProps` gains `prefillAddress?`, `allowRawSend?`, and `onSendRaw?: (d, messageId) => void`.

- [ ] **Step 1: Write the failing tests**

```tsx
it('send mode: prefilled address, no PIN, save toggle drives onSend', async () => {
  const onSend = vi.fn()
  render(<AddCryptoForm mode="send" prefillAddress="TPrefill0000000001" onResolve={vi.fn()} onSend={onSend} />)
  expect(screen.getByLabelText(/USDT address/i)).toHaveValue('TPrefill0000000001')
  expect(screen.queryByLabelText(/Transaction PIN/i)).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('checkbox', { name: /save this recipient/i }))
  await userEvent.type(screen.getByLabelText(/Label/i), 'Mum')
  await userEvent.click(screen.getByRole('button', { name: /send/i }))
  expect(onSend).toHaveBeenCalledWith({ address: 'TPrefill0000000001', network: 'TRON', saveAsBeneficiary: true, label: 'Mum' })
})

it('add mode is unchanged (PIN present, save mutation)', () => {
  render(<AddCryptoForm onResolve={vi.fn()} />)
  expect(screen.getByLabelText(/Transaction PIN/i)).toBeInTheDocument()
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && pnpm exec vitest run components/chat/cards/needs-beneficiary/add-crypto-form.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement** the `send` mode branch in `AddCryptoForm` (keep the existing `add` mode intact): a lightweight local form (address prefilled + editable, a `saveAsBeneficiary` checkbox, a conditional label field, submit button "Send"). No `useAddCryptoAddress`, no PIN. Update `NeedsBeneficiaryCard` to render `<AddCryptoForm mode="send" prefillAddress={prefillAddress} onSend={(d) => onSendRaw?.(d, messageId)} onResolve={resolve} />` when `allowRawSend` is set, and thread the new props + types.

- [ ] **Step 4: Run to verify it passes**

Run: `cd web && pnpm exec vitest run components/chat/cards/needs-beneficiary`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/components/chat/cards/needs-beneficiary web/types/components.ts web/types/chat.ts
git commit -m "feat(web): send-to-address mode on the crypto beneficiary card"
```

---

## Task 9: Web — chat-store resolve loop carries the sendDestination descriptor

**Files:**
- Modify: `web/lib/store/chat-store.ts` (`sendToAgent` 429-489; `resolveBeneficiary` 582-591; add `resolveSendRaw`; `_beneficiaryIntents` 150)
- Modify: `web/lib/api/*chat*` client so the POST body can carry `sendDestination`
- Test: `web/lib/store/chat-store.test.ts`

**Interfaces:**
- Consumes: `AddCryptoForm.onSend` payload (Task 8).
- Produces: `sendToAgent(surface, text, opts?: { beneficiaryId?: string; sendDestination?: SendDestinationInput })`; `resolveSendRaw(surface, dest: SendDestinationInput, messageId?: string)`.

- [ ] **Step 1: Write the failing test**

```ts
it('resolveSendRaw re-sends the bound intent with a sendDestination', async () => {
  // seed a needs_beneficiary card bound to "send 50 USDT to TRaw…"
  const post = vi.fn().mockResolvedValue(receiveOutcomeStub)
  // …
  await store.resolveSendRaw('web', { address: 'TRaw0000000001', network: 'TRON', saveAsBeneficiary: false }, cardMessageId)
  expect(post).toHaveBeenCalledWith(expect.objectContaining({
    text: 'send 50 USDT to TRaw0000000001',
    sendDestination: { address: 'TRaw0000000001', network: 'TRON', saveAsBeneficiary: false },
  }))
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && pnpm exec vitest run lib/store/chat-store.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** — generalize `sendToAgent` to accept an options object (keep a back-compat overload for `beneficiaryId`), pass `sendDestination` into the POST body, and add `resolveSendRaw` mirroring `resolveBeneficiary` (look up `_beneficiaryIntents[messageId]` → re-send with `sendDestination`). Update the axios chat client to include `sendDestination` when present.

- [ ] **Step 4: Run to verify it passes**

Run: `cd web && pnpm exec vitest run lib/store/chat-store.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/lib/store/chat-store.ts web/lib/api
git commit -m "feat(web): resolve loop sends a raw destination through the chat store"
```

---

## Task 10: Web — "Save this recipient" on the receipt (save-after-send)

**Files:**
- Modify: `web/components/chat/cards/receipt-card.tsx` (the chat receipt card) — add the button when the completed tx is a send to a raw (unsaved) address
- Reference: `web/components/shared/transaction-detail-body.tsx` (renders `counterparty` = the destination address)
- Test: `web/components/chat/cards/receipt-card.test.tsx`

**Interfaces:**
- Consumes: `useAddCryptoAddress` (`web/lib/query/beneficiaries`) — the standard PIN-gated add path.

- [ ] **Step 1: Write the failing test** — the send receipt for a raw (unsaved) send shows a "Save this recipient" button that opens the standard add-crypto form (with PIN); a receipt for a send to a saved beneficiary does not.

- [ ] **Step 2: Run to verify it fails.** Run: `cd web && pnpm exec vitest run <receipt test path>` → FAIL.

- [ ] **Step 3: Implement** — render the button only when the receipt has a raw destination and no beneficiary label; on click, open the existing `AddCryptoForm` (`add` mode, PIN) pre-filled with the counterparty address.

- [ ] **Step 4: Run to verify it passes.** Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/components/chat
git commit -m "feat(web): save a raw recipient from the send receipt"
```

---

## Task 11: WhatsApp — raw-address Flow → createSendProposal raw branch

**Files:**
- Modify: `api/src/modules/whatsapp/presentation/whatsapp-flow.controller.ts` (add a raw-address entry screen handler alongside `handleBeneficiarySelect` 415+)
- Test: `api/src/modules/whatsapp/presentation/whatsapp-flow.controller.spec.ts`

**Interfaces:**
- Consumes: `createSendProposal({ userId, intent, destination: { kind: 'raw_address', address, network, save? } })` (Task 2); the E2E-encrypted Flow payload (address entered in-Flow; §3.5, never plaintext chat).

- [ ] **Step 1: Write the failing test** — a `send_to_address` data_exchange action with a Flow-supplied `{ address, network, saveAsBeneficiary }` calls `createSendProposal` with a `raw_address` descriptor and returns the itemized confirmation screen; an invalid address returns an ERROR screen (not a 5xx).

- [ ] **Step 2: Run to verify it fails.** Run: `pnpm --filter @handshake-agent/api test -- whatsapp-flow.controller` → FAIL.

- [ ] **Step 3: Implement** `handleSendToAddress(userId, data)` mirroring `handleBeneficiarySelect`: read `address`/`network`/`saveAsBeneficiary` from the decrypted Flow `data`, build the `raw_address` descriptor, call `createSendProposal`, map `InvalidSendAddressError`/`SanctionsBlockedError`/`SelfSendError` to ERROR screens. Register the action in the Flow router.

- [ ] **Step 4: Run to verify it passes.** Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/src/modules/whatsapp/presentation/whatsapp-flow.controller.ts api/src/modules/whatsapp/presentation/whatsapp-flow.controller.spec.ts
git commit -m "feat(api): WhatsApp Flow send-to-raw-address routes to the engine raw branch"
```

---

## Task 12: Full-gate sweep + visual verification

**Files:** none (verification).

- [ ] **Step 1:** `pnpm lint && pnpm typecheck && pnpm test && pnpm depcruise` — all green.
- [ ] **Step 2:** `pnpm --filter @handshake-agent/api test:e2e -- send-raw-address web-chat` — green (Docker Postgres + Redis :6379).
- [ ] **Step 3:** Visual verify (web/CLAUDE.md runbook): log in as `qa.fulltest@example.com` (bump to tier_2 for `crypto.send`), type `send 5 USDT to <a valid TRON testnet address>`, confirm the card pre-fills the address, toggle "save", complete PIN, and confirm the proposal + receipt render. Screenshot.
- [ ] **Step 4: Commit** any fixes surfaced, then hand off for the final whole-branch review.

---

## Notes for the implementer

- **Do NOT touch `SendCryptoIntentSchema`** — the model never carries an address (§3.1). The address only ever enters via `sendDestination` (client) or the WhatsApp Flow field.
- **The saved-beneficiary path must stay byte-for-byte equivalent** — every existing send test (unit + `send-vertical.e2e-spec.ts`) must still pass. Task 2's saved branch is a refactor, not a behaviour change.
- **`proposalErrorClarification`** already maps `SanctionsBlockedError`/`SelfSendError`/`InsufficientBalanceError`/cooling-off/dust; add `InvalidSendAddressError` there so a bad raw address is a clarification, never a 5xx.
- **Spec 2 (deferred):** the `internal_user` descriptor variant, PayID minting, the public-nickname registry, and the internal ledger-transfer settlement branch are a separate spec — the descriptor and resolver shapes here reserve their slot but implement nothing.
