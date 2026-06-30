# Voice Notes (web + WhatsApp) + Incoming Multimedia (WhatsApp) — Design

> Status: **approved** (2026-06-29) · Branch: `feat/web-agent-vertical`
> Read order: root [`CLAUDE.md`](../../../CLAUDE.md) → [`api/CLAUDE.md`](../../../api/CLAUDE.md) → [`web/CLAUDE.md`](../../../web/CLAUDE.md) → [`packages/contracts/CLAUDE.md`](../../../packages/contracts/CLAUDE.md) → this spec.

## 1. Goal

Let users talk to the Handshake Agent with **voice notes on both surfaces** (web app + WhatsApp),
and let WhatsApp **understand incoming multimedia** (voice/audio, image, document). Voice is
transcribed to text and routed through the **exact same agent + engine path** that text already uses
— the model still only proposes, the deterministic engine still disposes (§3.1). Incoming images and
documents on WhatsApp are **content-extracted** to detect a crypto wallet address (→ payout address /
send) or bank-account details (→ bank beneficiary).

This adds three capabilities the repo does not have:

1. **Speech-to-text** behind a port, with a mock-first adapter (active in all tests) and a real
   OpenAI-compatible Whisper adapter (vendor-swappable by base URL).
2. **Web voice notes** — a `MediaRecorder` affordance in the chat composer + a JWT `POST /chat/voice`
   endpoint that transcribes then runs the existing `WebChatService`.
3. **WhatsApp inbound multimedia** — Graph media download + audio transcription routed through
   `ConversationService.handleInbound`, plus **document/image content-extraction** (Claude vision)
   routed to save a beneficiary.

### Non-goals (explicitly deferred)

- **No audio persistence.** Audio is held in memory, transcribed, and discarded; only the transcript
  is stored (as the message text, tagged `inputModality: 'voice'`). No object storage is introduced.
- **No realtime/streaming transcription.** Single request/response per voice note.
- **No in-thread KYC document capture.** KYC stays a web-modal handoff (the prior binding decision).
  An image is treated as a _beneficiary/payout capture_, never as a KYC ID upload.
- **No new crypto send/sell flows.** Extracted wallet/bank data only ever **saves a beneficiary**;
  the actual money move still goes through the existing proposal → confirmation → PIN/step-up path.
- **Voice replies (TTS).** Out of scope; all agent replies remain text/cards.

## 2. Baseline (what already exists)

- **Web chat:** `POST /chat/messages` (JWT) → `WebChatService.handleMessage({ userId, text, beneficiaryId })`
  → `IAgentPort.run(text)` → `AgentTurnOutcome` union. Persists message/intent/reply via repo ports.
- **WhatsApp inbound:** `WhatsAppWebhookController.receive` parses `WhatsAppInboundSchema`, runs
  `extractTextMessages` (which **silently skips** audio/image/document — `whatsapp/inbound.ts:131`),
  maps via `toInboundMessage`, and calls `IInboundHandler.handleInbound` (= `ConversationService`).
- **`ConversationService.handleInbound(InboundMessage)`** owns the full inbound lifecycle: dedup by
  `externalMessageId`, identity resolution, conversation upsert, message/intent/reply persistence,
  `requireActiveUser` KYC-handoff guard, intent routing, reply dispatch, and ack-safe error handling.
- **Mock-provider pattern:** `MockKycProvider` / `MockEmailProvider` are bound via `useClass` in their
  module and documented by an env flag (`KYC_MOCK_MODE`, `SANCTIONS_MOCK_MODE`, default `'true'`).
  Real adapters are a later port swap. Base-URL-configurable HTTP clients
  (`BLOCKRADAR_BASE_URL`, `FLUTTERWAVE_BASE_URL`, `WHATSAPP_GRAPH_BASE_URL`) keep adapters testable.
- **Beneficiaries:** `BeneficiaryService.addCryptoAddress(input)` validates the address against the
  network pattern via `AssetRegistry.validateAddress` and applies a **first-use cooling-off lock**
  (`firstUseLockedUntil`); `addBankAccount(input)` requires a `bankCode` and resolves the holder name
  via `INameEnquiry.resolve` (throws `NameEnquiryFailedError` on a bad account). There is **no
  bank-name → bank-code directory** in the repo today.
- **AssetRegistry:** networks carry an `addressPattern` regex; `validateAddress(networkId, address)`
  exists. There is **no** "infer network from an address" helper yet.
- **Outbound WhatsApp:** `CloudApiSender` (`IWhatsAppSender`) sends text/template/cta_url/flow but has
  **no media-download** method. Graph base URL / version / phone-number-id / access token live in env.
- **Frontend:** `ChatComposer` renders a **decorative** mic SVG (`chat-composer.tsx:77`) and a `+`
  attachment glyph. Parents `chat-rail.tsx` (desktop `"d"`) and `mobile-shell.tsx` (mobile `"m"`) call
  `store.sendToAgent(surface, text)`. `chat-store.sendToAgent` posts via `lib/api/chat.ts` →
  `/chat/messages` and maps `outcome` → chat messages. One axios instance with Idempotency-Key + Bearer
  interceptors. The agent LLM uses `@langchain/anthropic` (`ChatAnthropic`) already.
- **Platform:** `@nestjs/platform-express` is installed (so `FileInterceptor`/multer is available);
  `main.ts` creates a Nest Express app with `rawBody: true`.

## 3. New shared `media` module (api)

A new feature module `api/src/modules/media/` hosting two independent capabilities, each a port with a
mock-first adapter (the only active adapter in tests) and a real adapter selected by an env flag —
exactly mirroring `KYC_MOCK_MODE`/`MockKycProvider`.

```
modules/media/
├── application/ports/
│   ├── transcription.port.ts          # TRANSCRIPTION_PORT, ITranscriptionPort
│   └── document-extraction.port.ts     # DOCUMENT_EXTRACTION_PORT, IDocumentExtractionPort
├── infrastructure/
│   ├── mock-transcription.provider.ts            # active by default
│   ├── openai-compatible-transcription.provider.ts
│   ├── mock-document-extraction.provider.ts      # active by default
│   └── anthropic-vision-extraction.provider.ts
└── media.module.ts                     # binds + exports both ports
```

### 3.1 `ITranscriptionPort`

```ts
export const TRANSCRIPTION_PORT = Symbol("TRANSCRIPTION_PORT");
export interface TranscribeInput {
  bytes: Buffer;
  mimeType: string;
  filename?: string;
}
export interface TranscriptionResult {
  text: string;
}
export interface ITranscriptionPort {
  transcribe(input: TranscribeInput): Promise<TranscriptionResult>;
}
```

- **`MockTranscriptionProvider`** (active when `TRANSCRIPTION_MOCK_MODE !== 'false'`): returns a
  **deterministic** transcript (a fixed canned phrase, e.g. `"buy 50000 naira of USDT"` is too leading;
  use a neutral sentinel like `"[voice note transcript]"` for unit/e2e, and let tests inject the exact
  string they assert on by overriding the provider). No network. No randomness.
- **`OpenAiCompatibleTranscriptionProvider`** (active when `TRANSCRIPTION_MOCK_MODE === 'false'`):
  multipart `POST {TRANSCRIPTION_BASE_URL}/audio/transcriptions` with `file` + `model`, `Authorization:
Bearer {TRANSCRIPTION_API_KEY}`, parses `{ text }`. Base URL defaults to OpenAI; the **same adapter**
  works with Groq (`whisper-large-v3-turbo`) or a self-hosted Whisper server by changing the base URL.
  Uses `HttpService` (injected) so unit tests mock it without network.

### 3.2 `IDocumentExtractionPort`

```ts
export const DOCUMENT_EXTRACTION_PORT = Symbol("DOCUMENT_EXTRACTION_PORT");
export interface ExtractInput {
  bytes: Buffer;
  mimeType: string;
}
// DocumentExtractionResult is defined ONCE in @handshake-agent/contracts (see §4).
export interface IDocumentExtractionPort {
  extract(input: ExtractInput): Promise<DocumentExtractionResult>;
}
```

- **`MockDocumentExtractionProvider`** (active when `MEDIA_EXTRACTION_MOCK_MODE !== 'false'`): returns a
  deterministic `{ kind: 'none' }` by default; tests override the binding to return `crypto_address` /
  `bank_account` fixtures.
- **`AnthropicVisionExtractionProvider`** (active when `MEDIA_EXTRACTION_MOCK_MODE === 'false'`): uses
  `ChatAnthropic` (already a dependency) with an image content block + `withStructuredOutput(
DocumentExtractionResultSchema)` over `MEDIA_EXTRACTION_MODEL` (default `claude-opus-4-8`) and the
  existing `ANTHROPIC_API_KEY`. The model **only proposes a candidate** — it never moves money, and its
  output is validated server-side before any persistence (§3.1/§3.3). The prompt instructs: "Extract any
  crypto wallet address or Nigerian bank-account details visible; if neither, return kind=none. Do not
  guess." Documents (PDF) are passed as a document content block where supported; otherwise treated as
  `kind: 'none'` with a logged note (MVP — no separate OCR vendor).

### 3.3 Module wiring

`MediaModule` binds each token by reading the flag from `ConfigService` in a `useFactory`, exports both
tokens. `ChatModule` imports it (transcription); `WhatsAppModule`/conversations wiring imports it (both).
`depcruise` stays green: ports live in `application`, the `ChatAnthropic`/HTTP usage lives in
`infrastructure`, and no `@prisma/client` appears anywhere in this module.

## 4. Contracts (`@handshake-agent/contracts`)

- **`whatsapp/inbound.ts`** — widen `InboundMessageSchema` to carry the media sub-objects Meta sends:
  `audio?: { id, mime_type, voice? }`, `image?: { id, mime_type, sha256? }`,
  `document?: { id, mime_type, filename?, sha256? }`. Add:

  ```ts
  export type InboundEvent =
    | { kind: 'text'; ...common; text: string }
    | { kind: 'audio'; ...common; mediaId: string; mimeType: string }
    | { kind: 'image'; ...common; mediaId: string; mimeType: string }
    | { kind: 'document'; ...common; mediaId: string; mimeType: string; filename?: string }
  export function extractInboundEvents(payload: WhatsAppInbound): InboundEvent[]
  ```

  `common` = `{ externalMessageId, from, phoneNumberId, waName, timestamp }`. `extractTextMessages` is
  re-expressed as `extractInboundEvents(...).filter(e => e.kind === 'text')` to preserve existing
  behavior and tests. Unknown/unsupported `type` values are skipped (permissive, as today).

- **`chat/chat.schemas.ts`** — `VoiceChatResponseSchema = WebChatResponseSchema.extend({ transcript:
z.string() })`; `export type VoiceChatResponse`.

- **New `media/` contracts** (`packages/contracts/src/media/extraction.ts`, exported from the barrel and
  a `/media` subpath):

  ```ts
  export const DocumentExtractionResultSchema = z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("crypto_address"),
      address: z.string(),
      network: z.string().optional(),
    }),
    z.object({
      kind: z.literal("bank_account"),
      accountNumber: z.string(),
      bankName: z.string().optional(),
      bankCode: z.string().optional(),
    }),
    z.object({ kind: z.literal("none") }),
  ]);
  export type DocumentExtractionResult = z.infer<
    typeof DocumentExtractionResultSchema
  >;
  ```

  This single schema is the structured-output contract shared by the mock adapter, the Anthropic-vision
  adapter (`withStructuredOutput`), and the tests — never redefined (§8).

## 5. Web voice notes

### 5.1 Backend — `POST /chat/voice` (JWT)

A new route on the chat controller (or a sibling `VoiceChatController` in the chat module):

1. `@UseGuards(JwtAuthGuard)` + `@UseInterceptors(FileInterceptor('audio', { limits: { fileSize:
<config> } }))` (memory storage — bytes in `file.buffer`, never written to disk).
2. Validate **presence**, **mime allowlist** (`audio/webm`, `audio/mp4`, `audio/mpeg`, `audio/ogg`,
   `audio/wav`), and **size cap** — all from the JSON-config layer `media.voice.{maxUploadBytes,
allowedMimeTypes}` (tunable per §7; no hardcoded limits). Reject with 400/413 on violation.
3. `const { text } = await transcription.transcribe({ bytes: file.buffer, mimeType: file.mimetype,
filename: file.originalname })`.
4. `const res = await this.chatService.handleMessage({ userId, text })` — **unchanged** money path; the
   transcript becomes the persisted message text (`rawUserText = text`, `inputModality: 'voice'`).
5. Return `VoiceChatResponseSchema.parse({ ...res, transcript: text })`.

No extra money-gate is needed: every money-moving branch inside `WebChatService` already re-checks
`kycStatus` server-side (§3.3). The voice endpoint only adds a transcription step in front of the same
service. An empty transcript short-circuits to a `clarification` outcome (handled by `handleMessage`'s
`none`/empty path — verify and, if needed, guard with a "I couldn't hear anything" clarification before
calling the agent).

> **`inputModality` persistence:** the message repo `create(...)` input gains an optional
> `inputModality?: 'text' | 'voice'` (default `'text'`). This is a small additive column on the message
> model (Prisma migration). It drives a 🎤 affordance in the UI and is useful for audit. If the schema
> change is judged out of scope during planning, fall back to storing the transcript text only and drop
> the flag — the feature works either way.

### 5.2 Frontend

- **`web/hooks/use-voice-recorder.ts`** — encapsulates the browser `MediaRecorder` lifecycle (browser
  APIs belong in a hook, not a component, per web §arch):
  - `getUserMedia({ audio: true })`, pick a supported `mimeType` (prefer `audio/webm;codecs=opus`, fall
    back to `audio/mp4` for Safari), collect chunks, stop → produce a `Blob`.
  - Exposes `{ status: 'idle'|'recording'|'unsupported'|'denied', seconds, start(), stop(): Promise<Blob
| null>, cancel() }`. Tracks elapsed seconds via an interval. Releases the mic track on stop/cancel.
  - Feature-detect `MediaRecorder`/`navigator.mediaDevices`; surface `unsupported`/`denied` cleanly.
- **`web/lib/api/chat.ts`** — `sendVoiceNote(blob): Promise<VoiceChatResponse>`: builds `FormData`
  (`audio`), `POST /chat/voice` (let axios set the multipart boundary — do **not** hand-set
  Content-Type), parse the response with `VoiceChatResponseSchema`.
- **`chat-store.ts`** — new `sendVoiceToAgent(surface, blob)`: set typing-on → `sendVoiceNote(blob)` → on
  success append a **user bubble whose text is the transcript** + the assistant outcome messages. The
  large `outcome → ChatMessage[]` mapping currently inlined in `sendToAgent` is **extracted to a shared
  `applyOutcome(outcome, nextId)` helper** reused by both `sendToAgent` and `sendVoiceToAgent` (DRY —
  §13.2). Error branch mirrors the existing one (reachability fallback message). Inject a `voiceApi`
  option on `createChatStore` for testability (like the existing `chatApi`).
- **`ChatComposer`** stays presentational. The live mic SVG becomes a **record button** driven by new
  props (in `web/types/components.ts`): `recording: boolean`, `recordSeconds: number`, `canRecord:
boolean`, `onRecordStart()`, `onRecordStop()`, `onRecordCancel()`. Recording UI = a red dot + timer +
  Stop + Cancel; idle UI = the mic glyph (now interactive, `aria-label="Record voice note"`). When
  `canRecord` is false, the mic is hidden/disabled. Parents (`chat-rail`, `mobile-shell`) own
  `useVoiceRecorder` and wire `onRecordStop` → `await stop()` → `store.sendVoiceToAgent(surface, blob)`.
- **Accessibility:** visible focus, `aria-label`s, the recording state announced; honor existing
  composer styling tokens.

## 6. WhatsApp inbound multimedia

### 6.1 Media download client

`whatsapp/application/ports/whatsapp-media.port.ts`:

```ts
export const WHATSAPP_MEDIA_CLIENT = Symbol("WHATSAPP_MEDIA_CLIENT");
export interface DownloadedMedia {
  bytes: Buffer;
  mimeType: string;
}
export interface IWhatsAppMediaClient {
  download(mediaId: string): Promise<DownloadedMedia>;
}
```

`whatsapp/infrastructure/cloud-api.media-client.ts`: two-step Graph fetch — `GET
{base}/{version}/{mediaId}` → `{ url, mime_type }`, then `GET {url}` with `Authorization: Bearer
{token}` → bytes (`responseType: 'arraybuffer'`). Enforce a `media.whatsapp.maxMediaBytes` cap. Uses
`HttpService` (mockable). Never logs the bytes or the token (§ no secrets in logs).

### 6.2 Inbound ingest service (orchestration)

`whatsapp/application/whatsapp-inbound.service.ts` — the webhook controller delegates the parsed payload
here; the controller keeps only parse + always-200 ack. The service loops `extractInboundEvents`,
**per-event `try/catch`** (so one bad media item neither breaks the batch nor escapes the 200 ack), and
turns each event into an `InboundMessage` for the existing `IInboundHandler.handleInbound`:

- **text** → `toInboundMessage(event)` → `handleInbound`. (Unchanged behavior.)
- **audio** → `media.download(mediaId)` → `transcription.transcribe(...)` → `InboundMessage{ text:
transcript, inputModality: 'voice' }` → `handleInbound` (the agent runs on the transcript → full
  existing buy/sell/send/receive routing).
- **image / document** → `media.download(mediaId)` → `extraction.extract(...)` → `InboundMessage{
extraction: DocumentExtractionResult }` (no transcript; agent is **not** run) → `handleInbound`.

On a download/transcription/extraction failure, the service logs and sends a best-effort safe-fallback
text via `IWhatsAppSender` (mirrors `ConversationService`'s catch), then continues the loop.

> **Why route media through `handleInbound` rather than handle it in the ingest service:** dedup (by
> `externalMessageId`), identity resolution, message/reply persistence, the `requireActiveUser` KYC
> handoff, and ack-safe error handling all already live in `ConversationService.handleInbound`. Passing a
> resolved `InboundMessage` (transcript or extraction) keeps that single lifecycle authoritative and
> avoids duplicating it. The ingest service's only new responsibility is media → data resolution.

### 6.3 `InboundMessage` extension + `ConversationService` routing

`InboundMessage` (the `inbound-handler.port` DTO) gains two optional fields:
`inputModality?: 'text' | 'voice'` and `extraction?: DocumentExtractionResult`. `handleInbound` branches
**after** dedup + persist:

- If `msg.extraction` is present → `handleExtractedMedia(msg.extraction, identity, msg)` (no agent run).
- Else → run the agent on `msg.text` exactly as today (covers text + transcribed audio).

`handleExtractedMedia` (new private method, reuses `requireActiveUser` + `sendKycHandoff`):

- **Guard:** unlinked/unverified sender → KYC web-handoff CTA (a beneficiary cannot be saved without a
  linked user; reuse the existing path).
- **`crypto_address`** → `network = extraction.network ?? assetRegistry.inferNetworkForAddress(address)`
  (new registry helper — iterate `networks()`, return the first whose `addressPattern` matches, else
  `null`; no hardcoded network). If a network resolves → `BeneficiaryService.addCryptoAddress({ userId,
address, network, asset: registry.defaultAssetFor(network) })`. On success, reply: _"Saved this wallet
  (`<networkDisplay>`, `<maskedAddress>`) as a payout address. Say 'send 10 USDT to it' to send."_ On
  `InvalidAddressError` / no-network → polite _"I read an address but it doesn't look like a valid
  wallet for a network we support."_
  - **Safety (§3.1/§3.3):** the extracted address is a _candidate_ only. It is format-validated by the
    registry before persistence; saving a beneficiary moves **no** money; the eventual send still
    requires a proposal + itemized confirmation + PIN/step-up, and the new beneficiary carries the
    first-use cooling-off lock. No funds ever move as a result of receiving an image.
- **`bank_account`** → because there is no bank-name → code directory, MVP does **not** auto-save unless
  `extraction.bankCode` is present:
  - If `bankCode` present → `BeneficiaryService.addBankAccount({ userId, accountNumber, bankCode })`
    (name-enquiry resolves + verifies the holder; throws on bad data → caught → polite failure). On
    success reply with the masked account + resolved name.
  - Else → echo the candidate for confirmation and route into the existing beneficiary path: send the
    in-thread **beneficiary Flow pre-filled** (extend `IWhatsAppSender.sendBeneficiaryFlow` /
    `sendConfirmationFlow` data with an optional `prefill: { accountNumber }`) when `WHATSAPP_FLOW_ID`
    is set; otherwise a text fallback: _"I read account •••<last4> at <bankName>. Add it as a payout
    account and I'll use it."_ The user confirms the bank (→ code) inside the E2E Flow before any save.
- **`none`** → _"I couldn't find a wallet address or bank details in that image."_

All reply text goes through the existing reply-persist + `IWhatsAppSender.sendText`/Flow dispatch in
`handleInbound`, so dedup and audit are preserved for media too.

## 7. Configuration & env (layered, §7)

**Env (`api/.env.example` + `env.schema.ts`)** — secrets/infra, each `''`-tolerant at boot like
`ANTHROPIC_API_KEY`:

- `TRANSCRIPTION_MOCK_MODE` (`'true'|'false'`, default `'true'`)
- `TRANSCRIPTION_API_KEY` (secret; empty ok at boot, required by the real adapter when used)
- `TRANSCRIPTION_BASE_URL` (default `https://api.openai.com/v1`)
- `TRANSCRIPTION_MODEL` (default `whisper-1`)
- `MEDIA_EXTRACTION_MOCK_MODE` (`'true'|'false'`, default `'true'`)
- `MEDIA_EXTRACTION_MODEL` (default `claude-opus-4-8`; uses existing `ANTHROPIC_API_KEY`)

**JSON config defaults** (`api/config/defaults/*.json`, tunable; developer-set static values per §7):

- `media.voice.maxUploadBytes` (e.g. `15_000_000`), `media.voice.allowedMimeTypes` (array)
- `media.whatsapp.maxMediaBytes` (e.g. `25_000_000`)

## 8. Testing (strict TDD, §9)

- **Contracts:** `extractInboundEvents` over fixtures (text/audio/image/document/mixed/status-only);
  `extractTextMessages` parity; `VoiceChatResponseSchema`; `DocumentExtractionResultSchema` valid/invalid.
- **API unit:** `MockTranscriptionProvider`; `OpenAiCompatibleTranscriptionProvider` (HttpService
  mocked — asserts multipart fields + base URL); `MockDocumentExtractionProvider`;
  `AnthropicVisionExtractionProvider` (LLM mocked); `CloudApiMediaClient` (two-step fetch mocked,
  cap enforced); `WhatsAppInboundService` routing (each event kind); `ConversationService
.handleExtractedMedia` (crypto save / bank with+without code / none / KYC-guard); voice controller
  (mime+size validation, transcript→`handleMessage`); `AssetRegistry.inferNetworkForAddress`.
- **API e2e (Testcontainers Postgres, all providers mocked, no network):**
  - Web voice: multipart upload of a tiny audio buffer → mock transcript → `AgentTurnOutcome` + transcript.
  - WhatsApp webhook with an `audio` message → mock media + mock transcript → agent path.
  - WhatsApp webhook with an `image` message → mock extraction (`crypto_address`) → beneficiary saved
    - confirmation reply; and an unverified-sender image → KYC handoff (no save).
- **Web (Vitest + RTL):** `use-voice-recorder` (mock `MediaRecorder`/`getUserMedia`, denied/unsupported
  paths); `chat-store.sendVoiceToAgent` (injected mock `voiceApi`, transcript bubble + outcome mapping
  - error branch); `ChatComposer` record-state rendering (idle/recording/disabled) + a11y labels.
- **Gate:** `typecheck + unit + e2e + depcruise` green across `api`, `web`, `contracts`. Do **not** run
  `pnpm lint` (it is `eslint --fix`); verify with bare `eslint` / `turbo --dry` if needed.

## 9. Invariant checklist (must hold)

- **§3.1 model proposes / engine disposes:** transcription/extraction only produce _text/candidates_;
  no LLM/STT output moves money. Sends/sells still require proposal + confirmation + PIN/step-up.
- **§3.2 agent has no DB:** the `media` module and adapters import no `@prisma/client`; depcruise green.
- **§3.3 server-side gates:** voice reuses `WebChatService`'s per-intent KYC gate; extracted
  wallet/bank data is validated server-side (registry address validation / name-enquiry) before save;
  WhatsApp media routes through `requireActiveUser`.
- **§3.5 WhatsApp surface:** only the official Cloud API + Graph media API + existing Flows are used; no
  crypto commerce object; no secrets/bytes logged.
- **§3.6 no shortcuts:** real adapters are fully implemented (not stubs); mocks are the deliberate
  default-active adapter, documented by an env flag, exactly like the KYC/email mocks.

## 10. Phasing (one branch, one spec)

1. **Contracts** — `extractInboundEvents`, `VoiceChatResponseSchema`, `DocumentExtractionResultSchema` (+ tests).
2. **`media` module** — both ports, mock adapters (active), real adapters (OpenAI-compatible Whisper,
   Anthropic vision), env wiring (+ unit tests).
3. **Web voice — backend** — `POST /chat/voice`, config limits, `inputModality` (+ unit + e2e).
4. **Web voice — frontend** — `use-voice-recorder`, `sendVoiceNote`, `sendVoiceToAgent`/`applyOutcome`,
   `ChatComposer` record affordance + parents (+ tests).
5. **WhatsApp audio** — media client, `WhatsAppInboundService`, audio → transcript → `handleInbound`,
   controller delegation (+ unit + e2e).
6. **WhatsApp image/document** — `IDocumentExtractionPort` wiring, `handleExtractedMedia`,
   `inferNetworkForAddress`, beneficiary save/echo routing (+ unit + e2e).
7. **Docs/wiring** — `.env.example`, package `CLAUDE.md` notes if needed, final gate + whole-branch review.
