# Voice Notes (web + WhatsApp) + Incoming Multimedia (WhatsApp) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users send voice notes on both surfaces (transcribed → existing agent path) and let WhatsApp understand incoming audio/image/document media (audio → transcript; image/document → extract a wallet address or bank details → save a beneficiary).

**Architecture:** A new shared `api/src/modules/media/` module exposes two mock-first ports — `ITranscriptionPort` (speech→text) and `IDocumentExtractionPort` (image/doc→structured candidate). The web app gets a `MediaRecorder` composer affordance + `POST /chat/voice` that transcribes then runs the unchanged `WebChatService`. WhatsApp gets a Graph media-download client + an ingest service that resolves media to text/extraction and routes through the existing `ConversationService.handleInbound`. The model still only proposes; the engine still disposes (§3.1).

**Tech Stack:** NestJS 11 (`@nestjs/platform-express` + multer `FileInterceptor`), `@nestjs/axios` HttpService, `@langchain/anthropic` (vision), Next.js 16 / React 19 (`MediaRecorder`), `nestjs-zod` + `@handshake-agent/contracts`, Jest unit + supertest e2e (Testcontainers Postgres), Vitest + RTL, `zod@^3.25.x`.

## Global Constraints

- **§3.1 model proposes / engine disposes:** transcription + extraction produce only text/candidates; no STT/LLM output moves money. Sends/sells always require proposal → itemized confirmation → PIN/step-up.
- **§3.2 agent/media have no DB:** the `media` module imports **no** `@prisma/client`; only `infrastructure` repositories do. `pnpm depcruise` must stay green.
- **§3.3 server-side gates:** voice reuses `WebChatService`'s per-intent KYC gate; extracted wallet/bank data is validated server-side (registry address validation / name-enquiry) before any save; WhatsApp media routes through `requireActiveUser` (KYC handoff for unlinked senders).
- **§3.5 WhatsApp:** only the official Cloud API + Graph media API + existing Flows. No crypto commerce object. **Never log media bytes or access tokens.**
- **§3.6 no shortcuts:** real adapters fully implemented; mock adapters are the deliberate default-active binding, documented by an env flag (mirrors `KYC_MOCK_MODE`/`MockKycProvider`).
- **§7 config:** secrets/infra → env (`*_MOCK_MODE`, `*_API_KEY`, `*_BASE_URL`, `*_MODEL`); static tunables (upload/media size caps, mime allowlist) → JSON defaults. **Nothing tunable is hardcoded.**
- **§8 contracts:** every FE⇄BE⇄adapter shape (`DocumentExtractionResult`, `VoiceChatResponse`, inbound events) is defined once in `@handshake-agent/contracts`; `zod` pinned `^3.25.32`; api DTOs wrap schemas with `createZodDto`.
- **No audio persistence:** bytes live in memory only; transcribe-and-discard. No object storage. `inputModality` DB column is **out of scope** (deferred) — provenance is reflected in the FE call path and the `VoiceChatResponse.transcript`, not a new column.
- **TDD, Conventional Commits, one coherent change per commit.** After each task run `pnpm --filter @handshake-agent/<pkg> typecheck`. **Do NOT run `pnpm lint`** (it is `eslint --fix`); if you must lint, run bare `pnpm --filter @handshake-agent/api exec eslint <files>` (no `--fix`). Run the **full** gate (`typecheck` + `test` + `test:e2e` + `depcruise`, all packages) at the end of each phase — a new injectable can break `AppModule` boot without failing its own narrow test.
- **Live dev (manual checks only):** API `PORT=3001 pnpm --filter @handshake-agent/api dev`; web via preview tooling. Postgres `handshake-agent-db` :5544, Redis `handshake-agent-redis` :6379 already up. Restart the ts-node API after backend changes (no watch).

## Canonical types & signatures (every task aligns to these)

**Contracts** (`packages/contracts/src/...`):

```ts
// media/extraction.ts
type DocumentExtractionResult =
  | { kind: "crypto_address"; address: string; network?: string }
  | {
      kind: "bank_account";
      accountNumber: string;
      bankName?: string;
      bankCode?: string;
    }
  | { kind: "none" };

// chat/chat.schemas.ts
type VoiceChatResponse = WebChatResponse & { transcript: string };

// whatsapp/inbound.ts
type InboundCommon = {
  externalMessageId: string;
  from: string;
  phoneNumberId: string;
  waName: string | undefined;
  timestamp: string;
};
type InboundEvent =
  | (InboundCommon & { kind: "text"; text: string })
  | (InboundCommon & {
      kind: "audio";
      mediaId: string;
      mimeType: string;
      voice: boolean;
    })
  | (InboundCommon & { kind: "image"; mediaId: string; mimeType: string })
  | (InboundCommon & {
      kind: "document";
      mediaId: string;
      mimeType: string;
      filename?: string;
    });
function extractInboundEvents(payload: WhatsAppInbound): InboundEvent[];
function extractTextMessages(payload: WhatsAppInbound): InboundTextMessage[]; // unchanged signature, re-expressed
```

**Media ports** (`api/src/modules/media/application/ports/`):

```ts
const TRANSCRIPTION_PORT: symbol;
interface ITranscriptionPort {
  transcribe(input: {
    bytes: Buffer;
    mimeType: string;
    filename?: string;
  }): Promise<{ text: string }>;
}
const DOCUMENT_EXTRACTION_PORT: symbol;
interface IDocumentExtractionPort {
  extract(input: {
    bytes: Buffer;
    mimeType: string;
  }): Promise<DocumentExtractionResult>;
}
```

**WhatsApp media port** (`api/src/modules/whatsapp/application/ports/whatsapp-media.port.ts`):

```ts
const WHATSAPP_MEDIA_CLIENT: symbol;
interface IWhatsAppMediaClient {
  download(mediaId: string): Promise<{ bytes: Buffer; mimeType: string }>;
}
```

**Inbound DTO extension** (`api/src/modules/whatsapp/application/ports/inbound-handler.port.ts`):

```ts
type InboundMessage = {
  /* existing fields */
  inputModality?: "text" | "voice";
  extraction?: DocumentExtractionResult;
};
```

**Ingest service** (`api/src/modules/whatsapp/application/whatsapp-inbound.service.ts`):

```ts
class WhatsAppInboundService {
  ingest(payload: WhatsAppInbound): Promise<void>;
}
```

**AssetRegistry helpers** (`api/src/core/catalog/asset-registry.ts`):

```ts
inferNetworkForAddress(address: string): string | null      // first network whose addressPattern matches
defaultAssetForNetwork(networkId: string): string | null    // a crypto asset valid on that network
```

**Frontend** (`web/`):

```ts
// hooks/use-voice-recorder.ts
type RecorderStatus = 'idle' | 'recording' | 'unsupported' | 'denied'
function useVoiceRecorder(): {
  status: RecorderStatus; seconds: number;
  start(): Promise<void>; stop(): Promise<Blob | null>; cancel(): void;
}
// lib/api/chat.ts
function sendVoiceNote(blob: Blob): Promise<VoiceChatResponse>
// lib/store/chat-store.ts
function applyOutcome(outcome: AgentTurnOutcome, nextId: () => string): { messages: ChatMessage[]; pendingProposalId?: string }
// ChatState additions:
sendVoiceToAgent(surface: ChatSurface, blob: Blob): Promise<void>
```

---

# PHASE 1 — Contracts

### Task 1: `DocumentExtractionResultSchema` + `VoiceChatResponseSchema`

**Files:**

- Create: `packages/contracts/src/media/extraction.ts`
- Create: `packages/contracts/src/media/index.ts`
- Create: `packages/contracts/src/media/extraction.spec.ts`
- Modify: `packages/contracts/src/chat/chat.schemas.ts` (append `VoiceChatResponseSchema`)
- Modify: `packages/contracts/src/chat/chat.schemas.spec.ts` (add a case)
- Modify: `packages/contracts/src/index.ts` (export `./media`)
- Modify: `packages/contracts/package.json` (add `"./media"` subpath export, mirroring existing subpaths)

**Interfaces:**

- Produces: `DocumentExtractionResultSchema`, `DocumentExtractionResult`, `VoiceChatResponseSchema`, `VoiceChatResponse`.

- [ ] **Step 1: Write the failing test** — `packages/contracts/src/media/extraction.spec.ts`

```ts
import { DocumentExtractionResultSchema } from "./extraction";

describe("DocumentExtractionResultSchema", () => {
  it("accepts a crypto_address result", () => {
    const r = DocumentExtractionResultSchema.parse({
      kind: "crypto_address",
      address: "TXYZ1234567890abcdefghijklmnopqrst",
      network: "tron",
    });
    expect(r.kind).toBe("crypto_address");
  });

  it("accepts a bank_account result with only an account number", () => {
    const r = DocumentExtractionResultSchema.parse({
      kind: "bank_account",
      accountNumber: "0123456789",
    });
    expect(r).toMatchObject({
      kind: "bank_account",
      accountNumber: "0123456789",
    });
  });

  it("accepts a none result", () => {
    expect(DocumentExtractionResultSchema.parse({ kind: "none" }).kind).toBe(
      "none",
    );
  });

  it("rejects an unknown kind", () => {
    expect(() =>
      DocumentExtractionResultSchema.parse({ kind: "passport" }),
    ).toThrow();
  });

  it("rejects crypto_address without an address", () => {
    expect(() =>
      DocumentExtractionResultSchema.parse({ kind: "crypto_address" }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run it — expect FAIL** (module not found)

Run: `pnpm --filter @handshake-agent/contracts test -- extraction`
Expected: FAIL (`Cannot find module './extraction'`).

- [ ] **Step 3: Implement `packages/contracts/src/media/extraction.ts`**

```ts
import { z } from "zod";

/**
 * Structured candidate extracted from an incoming image/document.
 *
 * SACROSANCT (§3.1): this is a *candidate* the vision model proposes — never a
 * value that moves money. The application layer validates it (address pattern /
 * bank name-enquiry) before persisting a beneficiary, and any send/sell still
 * requires the full proposal → confirmation → PIN path.
 */
export const DocumentExtractionResultSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("crypto_address"),
    address: z.string().min(1),
    /** Network id (e.g. 'tron'); optional — inferred server-side when absent. */
    network: z.string().min(1).optional(),
  }),
  z.object({
    kind: z.literal("bank_account"),
    accountNumber: z.string().min(1),
    bankName: z.string().min(1).optional(),
    bankCode: z.string().min(1).optional(),
  }),
  z.object({ kind: z.literal("none") }),
]);

export type DocumentExtractionResult = z.infer<
  typeof DocumentExtractionResultSchema
>;
```

- [ ] **Step 4: Implement `packages/contracts/src/media/index.ts`**

```ts
export * from "./extraction";
```

- [ ] **Step 5: Append `VoiceChatResponseSchema` to `chat/chat.schemas.ts`** (after `WebChatResponseSchema`)

```ts
// Voice-note chat response — the web POST /chat/voice envelope. Identical to the
// text response plus the transcript the STT produced (shown as the user's bubble).
export const VoiceChatResponseSchema = WebChatResponseSchema.extend({
  transcript: z.string(),
});
export type VoiceChatResponse = z.infer<typeof VoiceChatResponseSchema>;
```

Add a parse test in `chat.schemas.spec.ts`:

```ts
import { VoiceChatResponseSchema } from "./chat.schemas";

it("VoiceChatResponseSchema requires a transcript on top of the chat envelope", () => {
  const base = {
    reply: { text: "ok" },
    outcome: { kind: "clarification", text: "hi" },
    conversationId: "11111111-1111-1111-1111-111111111111",
    messageId: "22222222-2222-2222-2222-222222222222",
  };
  expect(() => VoiceChatResponseSchema.parse(base)).toThrow();
  expect(
    VoiceChatResponseSchema.parse({ ...base, transcript: "buy usdt" })
      .transcript,
  ).toBe("buy usdt");
});
```

- [ ] **Step 6: Wire exports** — in `packages/contracts/src/index.ts` add `export * from './media'`. In `packages/contracts/package.json` add a `"./media": "./src/media/index.ts"` entry under `exports` (copy the exact shape of the existing `"./chat"`/`"./dto"` entries).

- [ ] **Step 7: Run tests — expect PASS**

Run: `pnpm --filter @handshake-agent/contracts test`
Expected: PASS (all suites).

- [ ] **Step 8: Typecheck + commit**

```bash
pnpm --filter @handshake-agent/contracts typecheck
git add packages/contracts
git commit -m "feat(contracts): document-extraction + voice-chat-response schemas"
```

---

### Task 2: `extractInboundEvents` (widened inbound media schema)

**Files:**

- Modify: `packages/contracts/src/whatsapp/inbound.ts`
- Modify: `packages/contracts/src/whatsapp/inbound.spec.ts` (if present) or create it

**Interfaces:**

- Produces: `InboundEvent` (union), `extractInboundEvents(payload)`. `extractTextMessages` keeps its existing signature/behavior.
- Consumes: existing `WhatsAppInboundSchema`, `InboundTextMessage`.

- [ ] **Step 1: Write the failing test** (append to the inbound spec; create the file if missing)

```ts
import {
  WhatsAppInboundSchema,
  extractInboundEvents,
  extractTextMessages,
} from "./inbound";

const envelope = (message: Record<string, unknown>) => ({
  object: "whatsapp_business_account",
  entry: [
    {
      id: "E1",
      changes: [
        {
          field: "messages",
          value: {
            messaging_product: "whatsapp",
            metadata: {
              display_phone_number: "15550",
              phone_number_id: "PNID1",
            },
            contacts: [{ profile: { name: "Ada" }, wa_id: "23480" }],
            messages: [
              { from: "23480", id: "wamid.X", timestamp: "1700", ...message },
            ],
          },
        },
      ],
    },
  ],
});

describe("extractInboundEvents", () => {
  it("maps a text message to a text event", () => {
    const p = WhatsAppInboundSchema.parse(
      envelope({ type: "text", text: { body: "hi" } }),
    );
    expect(extractInboundEvents(p)).toEqual([
      expect.objectContaining({
        kind: "text",
        text: "hi",
        from: "23480",
        externalMessageId: "wamid.X",
        waName: "Ada",
      }),
    ]);
  });

  it("maps an audio/voice message to an audio event", () => {
    const p = WhatsAppInboundSchema.parse(
      envelope({
        type: "audio",
        audio: { id: "MID1", mime_type: "audio/ogg", voice: true },
      }),
    );
    expect(extractInboundEvents(p)).toEqual([
      expect.objectContaining({
        kind: "audio",
        mediaId: "MID1",
        mimeType: "audio/ogg",
        voice: true,
      }),
    ]);
  });

  it("maps image and document messages", () => {
    const img = WhatsAppInboundSchema.parse(
      envelope({
        type: "image",
        image: { id: "IMG1", mime_type: "image/jpeg" },
      }),
    );
    expect(extractInboundEvents(img)[0]).toMatchObject({
      kind: "image",
      mediaId: "IMG1",
      mimeType: "image/jpeg",
    });
    const doc = WhatsAppInboundSchema.parse(
      envelope({
        type: "document",
        document: {
          id: "DOC1",
          mime_type: "application/pdf",
          filename: "statement.pdf",
        },
      }),
    );
    expect(extractInboundEvents(doc)[0]).toMatchObject({
      kind: "document",
      mediaId: "DOC1",
      mimeType: "application/pdf",
      filename: "statement.pdf",
    });
  });

  it("skips unknown types and status-only payloads", () => {
    const p = WhatsAppInboundSchema.parse(
      envelope({ type: "reaction", reaction: { emoji: "👍" } }),
    );
    expect(extractInboundEvents(p)).toEqual([]);
  });

  it("extractTextMessages still returns only text (parity)", () => {
    const p = WhatsAppInboundSchema.parse(
      envelope({ type: "audio", audio: { id: "M", mime_type: "audio/ogg" } }),
    );
    expect(extractTextMessages(p)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it — expect FAIL** (`extractInboundEvents` not exported)

Run: `pnpm --filter @handshake-agent/contracts test -- inbound`
Expected: FAIL.

- [ ] **Step 3: Widen `InboundMessageSchema`** in `inbound.ts` — add optional media sub-objects (keep `passthrough`-style tolerance; unknown types still allowed):

```ts
const InboundMessageSchema = z.object({
  from: z.string(),
  id: z.string(),
  timestamp: z.string(),
  type: z.string(),
  text: z.object({ body: z.string() }).optional(),
  audio: z
    .object({
      id: z.string(),
      mime_type: z.string(),
      voice: z.boolean().optional(),
    })
    .optional(),
  image: z
    .object({
      id: z.string(),
      mime_type: z.string(),
      sha256: z.string().optional(),
    })
    .optional(),
  document: z
    .object({
      id: z.string(),
      mime_type: z.string(),
      filename: z.string().optional(),
      sha256: z.string().optional(),
    })
    .optional(),
});
```

- [ ] **Step 4: Add the event union + extractor** (after `InboundTextMessage`/`extractTextMessages`)

```ts
export type InboundCommon = {
  externalMessageId: string;
  from: string;
  phoneNumberId: string;
  waName: string | undefined;
  timestamp: string;
};

export type InboundEvent =
  | (InboundCommon & { kind: "text"; text: string })
  | (InboundCommon & {
      kind: "audio";
      mediaId: string;
      mimeType: string;
      voice: boolean;
    })
  | (InboundCommon & { kind: "image"; mediaId: string; mimeType: string })
  | (InboundCommon & {
      kind: "document";
      mediaId: string;
      mimeType: string;
      filename?: string;
    });

/**
 * Walks a parsed payload and returns one InboundEvent per supported message.
 * Supported kinds: text, audio (incl. voice notes), image, document. Status
 * updates and unknown/unsupported types are skipped.
 */
export function extractInboundEvents(payload: WhatsAppInbound): InboundEvent[] {
  const out: InboundEvent[] = [];
  for (const entry of payload.entry) {
    for (const change of entry.changes) {
      const { value } = change;
      if (!value.messages) continue;
      const nameByWaId: Record<string, string> = {};
      for (const c of value.contacts ?? [])
        nameByWaId[c.wa_id] = c.profile.name;

      for (const m of value.messages) {
        const common: InboundCommon = {
          externalMessageId: m.id,
          from: m.from,
          phoneNumberId: value.metadata.phone_number_id,
          waName: nameByWaId[m.from],
          timestamp: m.timestamp,
        };
        if (m.type === "text" && m.text?.body)
          out.push({ ...common, kind: "text", text: m.text.body });
        else if (m.type === "audio" && m.audio)
          out.push({
            ...common,
            kind: "audio",
            mediaId: m.audio.id,
            mimeType: m.audio.mime_type,
            voice: m.audio.voice ?? false,
          });
        else if (m.type === "image" && m.image)
          out.push({
            ...common,
            kind: "image",
            mediaId: m.image.id,
            mimeType: m.image.mime_type,
          });
        else if (m.type === "document" && m.document)
          out.push({
            ...common,
            kind: "document",
            mediaId: m.document.id,
            mimeType: m.document.mime_type,
            filename: m.document.filename,
          });
      }
    }
  }
  return out;
}
```

- [ ] **Step 5: Re-express `extractTextMessages` over the new extractor** (keeps its exact return type)

```ts
export function extractTextMessages(
  payload: WhatsAppInbound,
): InboundTextMessage[] {
  return extractInboundEvents(payload)
    .filter(
      (e): e is InboundCommon & { kind: "text"; text: string } =>
        e.kind === "text",
    )
    .map((e) => ({
      externalMessageId: e.externalMessageId,
      from: e.from,
      phoneNumberId: e.phoneNumberId,
      waName: e.waName,
      text: e.text,
      timestamp: e.timestamp,
    }));
}
```

- [ ] **Step 6: Run tests — expect PASS** (new + existing inbound tests, and the webhook contract spec)

Run: `pnpm --filter @handshake-agent/contracts test`
Expected: PASS.

- [ ] **Step 7: Typecheck + commit**

```bash
pnpm --filter @handshake-agent/contracts typecheck
git add packages/contracts/src/whatsapp
git commit -m "feat(contracts): extractInboundEvents for audio/image/document inbound"
```

---

# PHASE 2 — Shared `media` module (api)

> All files live under `api/src/modules/media/`. Ports in `application/`, adapters in `infrastructure/`. No `@prisma/client` anywhere in this module.

### Task 3: `ITranscriptionPort` + `MockTranscriptionProvider`

**Files:**

- Create: `api/src/modules/media/application/ports/transcription.port.ts`
- Create: `api/src/modules/media/infrastructure/mock-transcription.provider.ts`
- Create: `api/src/modules/media/infrastructure/mock-transcription.provider.spec.ts`

**Interfaces:**

- Produces: `TRANSCRIPTION_PORT`, `ITranscriptionPort`, `MockTranscriptionProvider`.

- [ ] **Step 1: Write the failing test** — `mock-transcription.provider.spec.ts`

```ts
import { MockTranscriptionProvider } from "./mock-transcription.provider";

describe("MockTranscriptionProvider", () => {
  it("returns a deterministic non-empty transcript without touching the network", async () => {
    const provider = new MockTranscriptionProvider();
    const a = await provider.transcribe({
      bytes: Buffer.from("x"),
      mimeType: "audio/ogg",
    });
    const b = await provider.transcribe({
      bytes: Buffer.from("y"),
      mimeType: "audio/webm",
    });
    expect(a.text).toBe("[voice note transcript]");
    expect(b.text).toBe(a.text); // deterministic
  });
});
```

- [ ] **Step 2: Run — expect FAIL.** `pnpm --filter @handshake-agent/api test -- mock-transcription` → FAIL.

- [ ] **Step 3: Implement the port** — `transcription.port.ts`

```ts
/**
 * Speech-to-text port. The dev mock returns a canned transcript; a real provider
 * (OpenAI-compatible Whisper) is a port swap — application code never imports the
 * concrete adapter. Mirrors the EMAIL_PROVIDER / KYC_PROVIDER pattern.
 */
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

- [ ] **Step 4: Implement the mock** — `mock-transcription.provider.ts`

```ts
import { Injectable, Logger } from "@nestjs/common";

import type {
  ITranscriptionPort,
  TranscribeInput,
  TranscriptionResult,
} from "../application/ports/transcription.port";

/** Dev/test transcription provider — returns a fixed transcript, no network. */
@Injectable()
export class MockTranscriptionProvider implements ITranscriptionPort {
  private readonly logger = new Logger(MockTranscriptionProvider.name);

  transcribe(input: TranscribeInput): Promise<TranscriptionResult> {
    // Never log bytes (§3.5). Log only size + mime for observability.
    this.logger.log(`[mock-stt] ${input.bytes.length}B ${input.mimeType}`);
    return Promise.resolve({ text: "[voice note transcript]" });
  }
}
```

- [ ] **Step 5: Run — expect PASS.** `pnpm --filter @handshake-agent/api test -- mock-transcription` → PASS.

- [ ] **Step 6: Commit**

```bash
git add api/src/modules/media/application/ports/transcription.port.ts api/src/modules/media/infrastructure/mock-transcription.provider.ts api/src/modules/media/infrastructure/mock-transcription.provider.spec.ts
git commit -m "feat(api): transcription port + mock provider"
```

---

### Task 4: `OpenAiCompatibleTranscriptionProvider` (real adapter)

**Files:**

- Create: `api/src/modules/media/infrastructure/openai-compatible-transcription.provider.ts`
- Create: `api/src/modules/media/infrastructure/openai-compatible-transcription.provider.spec.ts`

**Interfaces:**

- Consumes: `ITranscriptionPort`, `HttpService` (`@nestjs/axios`), `ConfigService`.
- Produces: `OpenAiCompatibleTranscriptionProvider`.

- [ ] **Step 1: Write the failing test** — mock `HttpService.post` and assert URL + multipart + parsing.

```ts
import { of } from "rxjs";
import { OpenAiCompatibleTranscriptionProvider } from "./openai-compatible-transcription.provider";

function makeConfig(overrides: Record<string, string> = {}) {
  const values: Record<string, string> = {
    TRANSCRIPTION_BASE_URL: "https://api.openai.com/v1",
    TRANSCRIPTION_API_KEY: "sk-test",
    TRANSCRIPTION_MODEL: "whisper-1",
    ...overrides,
  };
  return {
    get: (k: string) => values[k],
  } as unknown as import("@nestjs/config").ConfigService;
}

describe("OpenAiCompatibleTranscriptionProvider", () => {
  it("posts multipart to {base}/audio/transcriptions and returns the text", async () => {
    const post = jest
      .fn()
      .mockReturnValue(of({ data: { text: "buy 50000 naira of usdt" } }));
    const http = { post } as unknown as import("@nestjs/axios").HttpService;
    const provider = new OpenAiCompatibleTranscriptionProvider(
      http,
      makeConfig(),
    );

    const res = await provider.transcribe({
      bytes: Buffer.from("audio"),
      mimeType: "audio/ogg",
      filename: "note.ogg",
    });

    expect(res.text).toBe("buy 50000 naira of usdt");
    const [url, , config] = post.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/audio/transcriptions");
    expect((config.headers as Record<string, string>).Authorization).toBe(
      "Bearer sk-test",
    );
  });

  it("throws a clean error when the API key is missing", async () => {
    const http = {
      post: jest.fn(),
    } as unknown as import("@nestjs/axios").HttpService;
    const provider = new OpenAiCompatibleTranscriptionProvider(
      http,
      makeConfig({ TRANSCRIPTION_API_KEY: "" }),
    );
    await expect(
      provider.transcribe({ bytes: Buffer.from("a"), mimeType: "audio/ogg" }),
    ).rejects.toThrow(/TRANSCRIPTION_API_KEY/);
  });
});
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement** — `openai-compatible-transcription.provider.ts`

```ts
import { Injectable } from "@nestjs/common";
import { HttpService } from "@nestjs/axios";
import { ConfigService } from "@nestjs/config";
import { firstValueFrom } from "rxjs";

import type {
  ITranscriptionPort,
  TranscribeInput,
  TranscriptionResult,
} from "../application/ports/transcription.port";

interface TranscriptionApiResponse {
  text: string;
}

/**
 * Real STT adapter for any OpenAI-compatible /audio/transcriptions endpoint
 * (OpenAI Whisper, Groq whisper-large-v3, self-hosted whisper.cpp servers).
 * Vendor is swapped by changing TRANSCRIPTION_BASE_URL — same multipart contract.
 */
@Injectable()
export class OpenAiCompatibleTranscriptionProvider implements ITranscriptionPort {
  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  async transcribe(input: TranscribeInput): Promise<TranscriptionResult> {
    const apiKey = this.config.get<string>("TRANSCRIPTION_API_KEY") ?? "";
    if (!apiKey) {
      throw new Error("TRANSCRIPTION_API_KEY is not configured");
    }
    const base =
      this.config.get<string>("TRANSCRIPTION_BASE_URL") ??
      "https://api.openai.com/v1";
    const model = this.config.get<string>("TRANSCRIPTION_MODEL") ?? "whisper-1";

    // Node 18+ global FormData/Blob; axios serializes them as multipart.
    const form = new FormData();
    form.append("model", model);
    form.append(
      "file",
      new Blob([input.bytes], { type: input.mimeType }),
      input.filename ?? "audio",
    );

    const response = await firstValueFrom(
      this.http.post<TranscriptionApiResponse>(
        `${base}/audio/transcriptions`,
        form,
        {
          headers: { Authorization: `Bearer ${apiKey}` },
        },
      ),
    );
    return { text: response.data.text ?? "" };
  }
}
```

- [ ] **Step 4: Run — expect PASS.**

- [ ] **Step 5: Commit**

```bash
git add api/src/modules/media/infrastructure/openai-compatible-transcription.provider.ts api/src/modules/media/infrastructure/openai-compatible-transcription.provider.spec.ts
git commit -m "feat(api): OpenAI-compatible Whisper transcription adapter"
```

---

### Task 5: `IDocumentExtractionPort` + `MockDocumentExtractionProvider`

**Files:**

- Create: `api/src/modules/media/application/ports/document-extraction.port.ts`
- Create: `api/src/modules/media/infrastructure/mock-document-extraction.provider.ts`
- Create: `api/src/modules/media/infrastructure/mock-document-extraction.provider.spec.ts`

**Interfaces:**

- Produces: `DOCUMENT_EXTRACTION_PORT`, `IDocumentExtractionPort`, `MockDocumentExtractionProvider`.
- Consumes: `DocumentExtractionResult` from `@handshake-agent/contracts`.

- [ ] **Step 1: Failing test** — mock returns `{ kind: 'none' }` by default.

```ts
import { MockDocumentExtractionProvider } from "./mock-document-extraction.provider";

describe("MockDocumentExtractionProvider", () => {
  it("returns kind=none by default, no network", async () => {
    const provider = new MockDocumentExtractionProvider();
    const r = await provider.extract({
      bytes: Buffer.from("img"),
      mimeType: "image/jpeg",
    });
    expect(r).toEqual({ kind: "none" });
  });
});
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement the port** — `document-extraction.port.ts`

```ts
import type { DocumentExtractionResult } from "@handshake-agent/contracts";

/**
 * Image/document content-extraction port. Returns a *candidate* (crypto address /
 * bank details / none) the application validates before any persistence (§3.1).
 * Dev mock returns 'none'; the real adapter uses Claude vision (a port swap).
 */
export const DOCUMENT_EXTRACTION_PORT = Symbol("DOCUMENT_EXTRACTION_PORT");

export interface ExtractInput {
  bytes: Buffer;
  mimeType: string;
}
export interface IDocumentExtractionPort {
  extract(input: ExtractInput): Promise<DocumentExtractionResult>;
}
```

- [ ] **Step 4: Implement the mock** — `mock-document-extraction.provider.ts`

```ts
import { Injectable, Logger } from "@nestjs/common";
import type { DocumentExtractionResult } from "@handshake-agent/contracts";

import type {
  ExtractInput,
  IDocumentExtractionPort,
} from "../application/ports/document-extraction.port";

/** Dev/test extraction — returns 'none'; tests override the binding for fixtures. */
@Injectable()
export class MockDocumentExtractionProvider implements IDocumentExtractionPort {
  private readonly logger = new Logger(MockDocumentExtractionProvider.name);

  extract(input: ExtractInput): Promise<DocumentExtractionResult> {
    this.logger.log(`[mock-extract] ${input.bytes.length}B ${input.mimeType}`);
    return Promise.resolve({ kind: "none" });
  }
}
```

- [ ] **Step 5: Run — expect PASS.**

- [ ] **Step 6: Commit**

```bash
git add api/src/modules/media/application/ports/document-extraction.port.ts api/src/modules/media/infrastructure/mock-document-extraction.provider.ts api/src/modules/media/infrastructure/mock-document-extraction.provider.spec.ts
git commit -m "feat(api): document-extraction port + mock provider"
```

---

### Task 6: `AnthropicVisionExtractionProvider` (real adapter)

**Files:**

- Create: `api/src/modules/media/infrastructure/anthropic-vision-extraction.provider.ts`
- Create: `api/src/modules/media/infrastructure/anthropic-vision-extraction.provider.spec.ts`

**Interfaces:**

- Consumes: `ConfigService`, `@langchain/anthropic` `ChatAnthropic`, `DocumentExtractionResultSchema`.
- Produces: `AnthropicVisionExtractionProvider`.

> Pattern reference: the existing `LlmProvider` adapter in `agent/infrastructure` shows how `ChatAnthropic` + `withStructuredOutput` is constructed and how it's mocked in tests (inject the model via a protected factory method so the spec can stub it). Mirror that structure so the spec needs no network.

- [ ] **Step 1: Failing test** — stub the structured model; assert it forwards the parsed result and builds an image content block.

```ts
import { AnthropicVisionExtractionProvider } from "./anthropic-vision-extraction.provider";

function makeConfig() {
  const values: Record<string, string> = {
    ANTHROPIC_API_KEY: "sk-ant",
    MEDIA_EXTRACTION_MODEL: "claude-opus-4-8",
  };
  return {
    get: (k: string) => values[k],
  } as unknown as import("@nestjs/config").ConfigService;
}

describe("AnthropicVisionExtractionProvider", () => {
  it("returns the structured result the model produces", async () => {
    const invoke = jest.fn().mockResolvedValue({
      kind: "crypto_address",
      address: "TXYZ1234567890abcdefghijklmnopqrst",
      network: "tron",
    });
    const provider = new AnthropicVisionExtractionProvider(makeConfig());
    // Override the protected model factory to avoid any network / real SDK call.
    (
      provider as unknown as {
        structuredModel: () => { invoke: typeof invoke };
      }
    ).structuredModel = () => ({ invoke });

    const r = await provider.extract({
      bytes: Buffer.from("img"),
      mimeType: "image/jpeg",
    });
    expect(r).toMatchObject({ kind: "crypto_address", network: "tron" });
    // Asserts an image content block carrying base64 was sent.
    const message = invoke.mock.calls[0][0];
    expect(JSON.stringify(message)).toContain("image_url");
  });

  it("throws when ANTHROPIC_API_KEY is missing", async () => {
    const cfg = {
      get: (k: string) => (k === "ANTHROPIC_API_KEY" ? "" : "m"),
    } as unknown as import("@nestjs/config").ConfigService;
    const provider = new AnthropicVisionExtractionProvider(cfg);
    await expect(
      provider.extract({ bytes: Buffer.from("a"), mimeType: "image/jpeg" }),
    ).rejects.toThrow(/ANTHROPIC_API_KEY/);
  });
});
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement** — `anthropic-vision-extraction.provider.ts`

```ts
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ChatAnthropic } from "@langchain/anthropic";
import {
  DocumentExtractionResultSchema,
  type DocumentExtractionResult,
} from "@handshake-agent/contracts";

import type {
  ExtractInput,
  IDocumentExtractionPort,
} from "../application/ports/document-extraction.port";

const SYSTEM_PROMPT =
  "You extract payment destination details from an image or document. Return " +
  'kind="crypto_address" with the wallet address (and network if obvious: tron/ethereum/...) ' +
  'when a single crypto wallet address is visible; kind="bank_account" with the account number ' +
  "(and bank name/code if shown) when Nigerian bank-account details are visible; otherwise " +
  'kind="none". Never guess or invent values you cannot read.';

/**
 * Real extraction adapter — Claude vision with structured output. The model only
 * PROPOSES a candidate (§3.1); the application validates it before persistence.
 */
@Injectable()
export class AnthropicVisionExtractionProvider implements IDocumentExtractionPort {
  constructor(private readonly config: ConfigService) {}

  /** Overridable in tests so no network/SDK call happens. */
  protected structuredModel(): {
    invoke(messages: unknown): Promise<DocumentExtractionResult>;
  } {
    const apiKey = this.config.get<string>("ANTHROPIC_API_KEY") ?? "";
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not configured");
    const model =
      this.config.get<string>("MEDIA_EXTRACTION_MODEL") ?? "claude-opus-4-8";
    const llm = new ChatAnthropic({ apiKey, model, temperature: 0 });
    return llm.withStructuredOutput(
      DocumentExtractionResultSchema,
    ) as unknown as {
      invoke(messages: unknown): Promise<DocumentExtractionResult>;
    };
  }

  async extract(input: ExtractInput): Promise<DocumentExtractionResult> {
    const model = this.structuredModel();
    const base64 = input.bytes.toString("base64");
    const messages = [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "Extract the payment destination from this media.",
          },
          {
            type: "image_url",
            image_url: { url: `data:${input.mimeType};base64,${base64}` },
          },
        ],
      },
    ];
    const result = await model.invoke(messages);
    // Defensive: validate the model output against the schema before returning.
    return DocumentExtractionResultSchema.parse(result);
  }
}
```

> Note for the implementer: confirm the exact `ChatAnthropic` constructor option name for the key against the installed `@langchain/anthropic@1.5.0` (the existing `agent/infrastructure` LlmProvider adapter is the source of truth — copy its option names verbatim). If vision content-block typing fights `withStructuredOutput`, cast the message array to `any` with a one-line boundary comment (§13.4) — this is an external-SDK boundary.

- [ ] **Step 4: Run — expect PASS.**

- [ ] **Step 5: Commit**

```bash
git add api/src/modules/media/infrastructure/anthropic-vision-extraction.provider.ts api/src/modules/media/infrastructure/anthropic-vision-extraction.provider.spec.ts
git commit -m "feat(api): Claude-vision document-extraction adapter"
```

---

### Task 7: env additions + `MediaModule` (flag-gated bindings)

**Files:**

- Modify: `api/src/core/config/env.schema.ts`
- Create: `api/src/modules/media/media.module.ts`
- Create: `api/src/modules/media/media.module.spec.ts`
- Modify: `api/.env.example`

**Interfaces:**

- Produces: `MediaModule` exporting `TRANSCRIPTION_PORT` + `DOCUMENT_EXTRACTION_PORT`.

- [ ] **Step 1: Add env keys** to `env.schema.ts` (inside `envSchema`, near the KYC/sanctions flags):

```ts
  // --- Media (speech-to-text + document extraction) ---
  // Mock adapters are the only active ones until real keys are provided (mirror KYC_MOCK_MODE).
  TRANSCRIPTION_MOCK_MODE: z.enum(['true', 'false']).default('true'),
  TRANSCRIPTION_API_KEY: z.string().optional().default(''),
  TRANSCRIPTION_BASE_URL: z.string().url().default('https://api.openai.com/v1'),
  TRANSCRIPTION_MODEL: z.string().min(1).default('whisper-1'),
  MEDIA_EXTRACTION_MOCK_MODE: z.enum(['true', 'false']).default('true'),
  // Vision extraction reuses ANTHROPIC_API_KEY; only the model id is separate.
  MEDIA_EXTRACTION_MODEL: z.string().min(1).default('claude-opus-4-8'),
```

- [ ] **Step 2: Failing test** — `media.module.spec.ts`: bind defaults to mocks; flipping flags binds the real adapters.

```ts
import { Test } from "@nestjs/testing";
import { ConfigModule } from "@nestjs/config";
import { HttpModule } from "@nestjs/axios";
import { MediaModule } from "./media.module";
import { TRANSCRIPTION_PORT } from "./application/ports/transcription.port";
import { DOCUMENT_EXTRACTION_PORT } from "./application/ports/document-extraction.port";
import { MockTranscriptionProvider } from "./infrastructure/mock-transcription.provider";
import { OpenAiCompatibleTranscriptionProvider } from "./infrastructure/openai-compatible-transcription.provider";
import { MockDocumentExtractionProvider } from "./infrastructure/mock-document-extraction.provider";

async function moduleWith(env: Record<string, string>) {
  return Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        isGlobal: true,
        ignoreEnvFile: true,
        load: [() => env],
      }),
      HttpModule,
      MediaModule,
    ],
  }).compile();
}

describe("MediaModule bindings", () => {
  it("binds mock adapters by default", async () => {
    const ref = await moduleWith({});
    expect(ref.get(TRANSCRIPTION_PORT)).toBeInstanceOf(
      MockTranscriptionProvider,
    );
    expect(ref.get(DOCUMENT_EXTRACTION_PORT)).toBeInstanceOf(
      MockDocumentExtractionProvider,
    );
  });

  it("binds the real transcription adapter when TRANSCRIPTION_MOCK_MODE=false", async () => {
    const ref = await moduleWith({ TRANSCRIPTION_MOCK_MODE: "false" });
    expect(ref.get(TRANSCRIPTION_PORT)).toBeInstanceOf(
      OpenAiCompatibleTranscriptionProvider,
    );
  });
});
```

- [ ] **Step 3: Run — expect FAIL.**

- [ ] **Step 4: Implement** — `media.module.ts` (factory bindings read the flag from `ConfigService`)

```ts
import { Module } from "@nestjs/common";
import { HttpModule } from "@nestjs/axios";
import { ConfigService } from "@nestjs/config";

import { TRANSCRIPTION_PORT } from "./application/ports/transcription.port";
import { DOCUMENT_EXTRACTION_PORT } from "./application/ports/document-extraction.port";
import { MockTranscriptionProvider } from "./infrastructure/mock-transcription.provider";
import { OpenAiCompatibleTranscriptionProvider } from "./infrastructure/openai-compatible-transcription.provider";
import { MockDocumentExtractionProvider } from "./infrastructure/mock-document-extraction.provider";
import { AnthropicVisionExtractionProvider } from "./infrastructure/anthropic-vision-extraction.provider";

/**
 * Shared media-intelligence module: speech-to-text + document extraction.
 * Mock adapters are active by default; real adapters bind when *_MOCK_MODE='false'
 * (mirrors IdentityModule's KYC_PROVIDER binding). Exports both ports.
 */
@Module({
  imports: [HttpModule],
  providers: [
    MockTranscriptionProvider,
    OpenAiCompatibleTranscriptionProvider,
    MockDocumentExtractionProvider,
    AnthropicVisionExtractionProvider,
    {
      provide: TRANSCRIPTION_PORT,
      inject: [
        ConfigService,
        MockTranscriptionProvider,
        OpenAiCompatibleTranscriptionProvider,
      ],
      useFactory: (
        config: ConfigService,
        mock: MockTranscriptionProvider,
        real: OpenAiCompatibleTranscriptionProvider,
      ) =>
        config.get<string>("TRANSCRIPTION_MOCK_MODE") === "false" ? real : mock,
    },
    {
      provide: DOCUMENT_EXTRACTION_PORT,
      inject: [
        ConfigService,
        MockDocumentExtractionProvider,
        AnthropicVisionExtractionProvider,
      ],
      useFactory: (
        config: ConfigService,
        mock: MockDocumentExtractionProvider,
        real: AnthropicVisionExtractionProvider,
      ) =>
        config.get<string>("MEDIA_EXTRACTION_MOCK_MODE") === "false"
          ? real
          : mock,
    },
  ],
  exports: [TRANSCRIPTION_PORT, DOCUMENT_EXTRACTION_PORT],
})
export class MediaModule {}
```

- [ ] **Step 5: Update `.env.example`** — add the six keys with their defaults under a `# --- Media ---` heading (commented, mirroring the KYC block).

- [ ] **Step 6: Run — expect PASS.** `pnpm --filter @handshake-agent/api test -- media.module` → PASS.

- [ ] **Step 7: Typecheck + depcruise + commit**

```bash
pnpm --filter @handshake-agent/api typecheck
pnpm depcruise
git add api/src/modules/media api/src/core/config/env.schema.ts api/.env.example
git commit -m "feat(api): MediaModule with flag-gated STT + extraction bindings"
```

---

# PHASE 3 — Web voice (backend)

### Task 8: JSON config defaults for media limits

**Files:**

- Modify: the JSON defaults file (`api/config/defaults/*.json` — find the one loaded by `configuration.ts`) to add a `media` block.
- Modify/locate: the typed accessor (`configuration.ts`) if it strongly types config; add `media` there.
- Test: extend the relevant config spec if one exists; otherwise assert in the voice-controller test (Task 9).

**Interfaces:**

- Produces config keys: `media.voice.maxUploadBytes` (number), `media.voice.allowedMimeTypes` (string[]), `media.whatsapp.maxMediaBytes` (number).

- [ ] **Step 1:** Inspect `api/src/core/config/` to find the JSON defaults + loader. Add:

```jsonc
// in the committed defaults JSON
"media": {
  "voice": {
    "maxUploadBytes": 15000000,
    "allowedMimeTypes": ["audio/webm", "audio/mp4", "audio/mpeg", "audio/ogg", "audio/wav"]
  },
  "whatsapp": { "maxMediaBytes": 25000000 }
}
```

- [ ] **Step 2:** If `configuration.ts` defines a typed shape, extend it to include `media`. Run `pnpm --filter @handshake-agent/api typecheck` — expect PASS.

- [ ] **Step 3: Commit**

```bash
git add api/config api/src/core/config
git commit -m "feat(api): media voice/whatsapp size + mime config defaults"
```

---

### Task 9: `POST /chat/voice` endpoint (transcribe → WebChatService)

**Files:**

- Modify: `api/src/modules/chat/presentation/chat.controller.ts` (add the `voice` route) OR create `voice-chat.controller.ts` in the same module (prefer a sibling controller to keep each file focused).
- Create: `api/src/modules/chat/presentation/voice-chat.controller.ts`
- Modify: `api/src/modules/chat/chat.module.ts` (register controller; import `MediaModule`)
- Create: `api/test/web-voice.e2e-spec.ts`

**Interfaces:**

- Consumes: `TRANSCRIPTION_PORT` (`ITranscriptionPort`), `WebChatService.handleMessage`, `JwtAuthGuard`, `CurrentUser`, config `media.voice.*`.
- Produces: `POST /chat/voice` → `VoiceChatResponse`.

- [ ] **Step 1: Write the failing e2e** — `api/test/web-voice.e2e-spec.ts` (mirror the existing `web-buy`/web-chat e2e harness: boot the app against Testcontainers Postgres, seed a verified user, get a JWT). Override `TRANSCRIPTION_PORT` with a stub returning a known transcript so the agent receives deterministic text. Key assertions:

```ts
// ...bootstrap app with Testcontainers Postgres, seed a verified user, obtain accessToken...
// Override transcription so the transcript is deterministic:
//   .overrideProvider(TRANSCRIPTION_PORT).useValue({ transcribe: async () => ({ text: 'where do I receive USDT?' }) })
// And override the agent port to map that text → receive outcome (reuse the web-chat e2e's agent stub).

it("POST /chat/voice transcribes audio and returns the agent outcome + transcript", async () => {
  const res = await request(app.getHttpServer())
    .post("/chat/voice")
    .set("Authorization", `Bearer ${accessToken}`)
    .attach("audio", Buffer.from("fake-audio-bytes"), {
      filename: "note.ogg",
      contentType: "audio/ogg",
    })
    .expect(200);

  expect(res.body.transcript).toBe("where do I receive USDT?");
  expect(res.body.outcome.kind).toBe("receive");
  expect(res.body.conversationId).toBeDefined();
});

it("rejects an unsupported mime type with 400/415", async () => {
  await request(app.getHttpServer())
    .post("/chat/voice")
    .set("Authorization", `Bearer ${accessToken}`)
    .attach("audio", Buffer.from("x"), {
      filename: "a.txt",
      contentType: "text/plain",
    })
    .expect((r) => {
      if (![400, 415].includes(r.status))
        throw new Error(`expected 400/415, got ${r.status}`);
    });
});

it("rejects an unauthenticated request with 401", async () => {
  await request(app.getHttpServer())
    .post("/chat/voice")
    .attach("audio", Buffer.from("x"), {
      filename: "a.ogg",
      contentType: "audio/ogg",
    })
    .expect(401);
});
```

- [ ] **Step 2: Run — expect FAIL** (route 404). `pnpm --filter @handshake-agent/api test:e2e -- web-voice` → FAIL.

- [ ] **Step 3: Implement the controller** — `voice-chat.controller.ts`

```ts
import {
  BadRequestException,
  Controller,
  HttpCode,
  Inject,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ConfigService } from "@nestjs/config";
import type { VoiceChatResponse } from "@handshake-agent/contracts";

import {
  JwtAuthGuard,
  type AuthenticatedUser,
} from "../../auth/presentation/jwt-auth.guard";
import { CurrentUser } from "../../auth/presentation/current-user.decorator";
import { WebChatService } from "../application/web-chat.service";
import {
  TRANSCRIPTION_PORT,
  type ITranscriptionPort,
} from "../../media/application/ports/transcription.port";

/** Multer in-memory file shape (no disk write). */
interface UploadedAudio {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size: number;
}

@Controller("chat")
@UseGuards(JwtAuthGuard)
export class VoiceChatController {
  constructor(
    private readonly chatService: WebChatService,
    @Inject(TRANSCRIPTION_PORT)
    private readonly transcription: ITranscriptionPort,
    private readonly config: ConfigService,
  ) {}

  @Post("voice")
  @HttpCode(200)
  @UseInterceptors(FileInterceptor("audio"))
  async sendVoice(
    @UploadedFile() file: UploadedAudio | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<VoiceChatResponse> {
    if (!file) throw new BadRequestException("Missing audio file");

    const allowed =
      this.config.get<string[]>("media.voice.allowedMimeTypes") ?? [];
    const maxBytes = this.config.get<number>("media.voice.maxUploadBytes") ?? 0;
    if (!allowed.includes(file.mimetype)) {
      throw new BadRequestException(`Unsupported audio type: ${file.mimetype}`);
    }
    if (maxBytes > 0 && file.size > maxBytes) {
      throw new BadRequestException("Audio file too large");
    }

    const { text } = await this.transcription.transcribe({
      bytes: file.buffer,
      mimeType: file.mimetype,
      filename: file.originalname,
    });

    const trimmed = text.trim();
    if (!trimmed) {
      // Empty transcript → don't run the agent on nothing; return a clarification.
      return {
        reply: { text: "I couldn't hear anything — please try again." },
        outcome: {
          kind: "clarification",
          text: "I couldn't hear anything — please try again.",
        },
        conversationId: (
          await this.chatService.handleMessage({
            userId: user.userId,
            text: "...",
          })
        ).conversationId,
        messageId: "00000000-0000-0000-0000-000000000000",
        transcript: "",
      } as VoiceChatResponse;
    }

    const res = await this.chatService.handleMessage({
      userId: user.userId,
      text: trimmed,
    });
    return { ...res, transcript: trimmed };
  }
}
```

> **Empty-transcript simplification:** the snippet above is awkward (it calls `handleMessage('...')` just to get a conversationId). Prefer instead: add a tiny guard that, on empty transcript, returns a `clarification` envelope **without** fabricating ids by having `WebChatService` expose a `clarificationResponse(userId, text)` helper, OR simply run `handleMessage({ userId, text: '(unintelligible audio)' })` so the existing `none` path produces a real clarification + ids. **Choose the latter** (one line, no new helper): `const res = await this.chatService.handleMessage({ userId, text: trimmed || '(unintelligible audio)' }); return { ...res, transcript: trimmed }`. Replace the empty-transcript block with this.

- [ ] **Step 4: Register + wire** — in `chat.module.ts` add `VoiceChatController` to `controllers` and import `MediaModule`.

- [ ] **Step 5: Run e2e — expect PASS.** `pnpm --filter @handshake-agent/api test:e2e -- web-voice` → PASS.

- [ ] **Step 6: Typecheck + depcruise + commit**

```bash
pnpm --filter @handshake-agent/api typecheck && pnpm depcruise
git add api/src/modules/chat api/test/web-voice.e2e-spec.ts
git commit -m "feat(api): POST /chat/voice — transcribe then run the agent"
```

---

# PHASE 4 — Web voice (frontend)

### Task 10: `useVoiceRecorder` hook

**Files:**

- Create: `web/hooks/use-voice-recorder.ts`
- Create: `web/hooks/use-voice-recorder.test.ts`
- Modify: `web/types/components.ts` (or `web/types/hooks.ts`) for `RecorderStatus`/return type if you centralize it.

**Interfaces:**

- Produces: `useVoiceRecorder()` returning `{ status, seconds, start, stop, cancel }`.

- [ ] **Step 1: Failing test** — mock `navigator.mediaDevices.getUserMedia` + a fake `MediaRecorder`.

```ts
import { renderHook, act } from "@testing-library/react";
import { useVoiceRecorder } from "./use-voice-recorder";

class FakeRecorder {
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  state = "inactive";
  constructor(
    public stream: unknown,
    public opts?: unknown,
  ) {}
  start() {
    this.state = "recording";
  }
  stop() {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob(["abc"], { type: "audio/webm" }) });
    this.onstop?.();
  }
}

beforeEach(() => {
  (globalThis as unknown as { MediaRecorder: unknown }).MediaRecorder =
    FakeRecorder as unknown;
  (
    FakeRecorder as unknown as { isTypeSupported: () => boolean }
  ).isTypeSupported = () => true;
  Object.defineProperty(globalThis.navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: jest
        .fn()
        .mockResolvedValue({ getTracks: () => [{ stop: jest.fn() }] }),
    },
  });
});

it("records and returns a Blob on stop", async () => {
  const { result } = renderHook(() => useVoiceRecorder());
  await act(async () => {
    await result.current.start();
  });
  expect(result.current.status).toBe("recording");
  let blob: Blob | null = null;
  await act(async () => {
    blob = await result.current.stop();
  });
  expect(blob).toBeInstanceOf(Blob);
  expect(result.current.status).toBe("idle");
});

it("reports denied when getUserMedia rejects", async () => {
  (
    globalThis.navigator.mediaDevices.getUserMedia as jest.Mock
  ).mockRejectedValueOnce(new Error("denied"));
  const { result } = renderHook(() => useVoiceRecorder());
  await act(async () => {
    await result.current.start();
  });
  expect(result.current.status).toBe("denied");
});
```

> Note: this repo's web tests run under **Vitest** — use `vi.fn()`/`vi.mock` instead of `jest.*` and import from `vitest`. Adapt the mocks accordingly; the structure is identical.

- [ ] **Step 2: Run — expect FAIL.** `pnpm --filter @handshake-agent/web test -- use-voice-recorder` → FAIL.

- [ ] **Step 3: Implement** — `use-voice-recorder.ts`

```ts
"use client";

import { useCallback, useRef, useState } from "react";

export type RecorderStatus = "idle" | "recording" | "unsupported" | "denied";

const PREFERRED_MIME = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return PREFERRED_MIME.find((m) => MediaRecorder.isTypeSupported(m));
}

export function useVoiceRecorder() {
  const [status, setStatus] = useState<RecorderStatus>(() =>
    typeof MediaRecorder === "undefined" ? "unsupported" : "idle",
  );
  const [seconds, setSeconds] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const cleanup = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    recorderRef.current = null;
    chunksRef.current = [];
    setSeconds(0);
  }, []);

  const start = useCallback(async () => {
    if (
      typeof MediaRecorder === "undefined" ||
      !navigator.mediaDevices?.getUserMedia
    ) {
      setStatus("unsupported");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mimeType = pickMimeType();
      const recorder = new MediaRecorder(
        stream,
        mimeType ? { mimeType } : undefined,
      );
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.start();
      recorderRef.current = recorder;
      setSeconds(0);
      timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
      setStatus("recording");
    } catch {
      cleanup();
      setStatus("denied");
    }
  }, [cleanup]);

  const stop = useCallback((): Promise<Blob | null> => {
    const recorder = recorderRef.current;
    if (!recorder) {
      setStatus("idle");
      return Promise.resolve(null);
    }
    return new Promise<Blob | null>((resolve) => {
      recorder.onstop = () => {
        const type = recorder.mimeType || "audio/webm";
        const blob = chunksRef.current.length
          ? new Blob(chunksRef.current, { type })
          : null;
        cleanup();
        setStatus("idle");
        resolve(blob);
      };
      recorder.stop();
    });
  }, [cleanup]);

  const cancel = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.onstop = null;
      recorder.stop();
    }
    cleanup();
    setStatus("idle");
  }, [cleanup]);

  return { status, seconds, start, stop, cancel };
}
```

- [ ] **Step 4: Run — expect PASS.**

- [ ] **Step 5: Commit**

```bash
git add web/hooks/use-voice-recorder.ts web/hooks/use-voice-recorder.test.ts web/types
git commit -m "feat(web): useVoiceRecorder MediaRecorder hook"
```

---

### Task 11: `sendVoiceNote` API client

**Files:**

- Modify: `web/lib/api/chat.ts` (add `sendVoiceNote`)
- Modify: `web/lib/api/chat.test.ts` (create if absent)

**Interfaces:**

- Consumes: the `api` axios instance, `VoiceChatResponseSchema`.
- Produces: `sendVoiceNote(blob: Blob): Promise<VoiceChatResponse>`.

- [ ] **Step 1: Failing test** — mock `api.post`, assert FormData posted to `/chat/voice` and response parsed.

```ts
import { vi, describe, it, expect } from "vitest";
vi.mock("./client", () => ({ api: { post: vi.fn() } }));
import { api } from "./client";
import { sendVoiceNote } from "./chat";

it("posts the blob as multipart and parses the response", async () => {
  (api.post as ReturnType<typeof vi.fn>).mockResolvedValue({
    data: {
      reply: { text: "ok" },
      outcome: { kind: "clarification", text: "hi" },
      conversationId: "11111111-1111-1111-1111-111111111111",
      messageId: "22222222-2222-2222-2222-222222222222",
      transcript: "hello",
    },
  });
  const res = await sendVoiceNote(new Blob(["x"], { type: "audio/webm" }));
  expect(res.transcript).toBe("hello");
  const [url, body] = (api.post as ReturnType<typeof vi.fn>).mock.calls[0];
  expect(url).toBe("/chat/voice");
  expect(body).toBeInstanceOf(FormData);
});
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement** — append to `web/lib/api/chat.ts`

```ts
import { VoiceChatResponseSchema } from "@handshake-agent/contracts";
import type { VoiceChatResponse } from "@handshake-agent/contracts";

/**
 * Uploads a recorded voice note to POST /chat/voice. Lets axios set the
 * multipart boundary (do not hand-set Content-Type). Response parsed via schema.
 */
export async function sendVoiceNote(blob: Blob): Promise<VoiceChatResponse> {
  const form = new FormData();
  // Filename extension hints the server mime; the Blob's type is authoritative.
  const ext = blob.type.includes("mp4")
    ? "mp4"
    : blob.type.includes("ogg")
      ? "ogg"
      : "webm";
  form.append("audio", blob, `voice-note.${ext}`);
  const { data } = await api.post("/chat/voice", form);
  return VoiceChatResponseSchema.parse(data);
}
```

- [ ] **Step 4: Run — expect PASS.**

- [ ] **Step 5: Commit**

```bash
git add web/lib/api/chat.ts web/lib/api/chat.test.ts
git commit -m "feat(web): sendVoiceNote multipart client"
```

---

### Task 12: `chat-store` — extract `applyOutcome`, add `sendVoiceToAgent`

**Files:**

- Modify: `web/lib/store/chat-store.ts`
- Modify: `web/lib/store/chat-store.test.ts`

**Interfaces:**

- Consumes: `sendVoiceNote` (default) injectable via a new `voiceApi` option; the existing `applyOutcome` logic.
- Produces: `applyOutcome(outcome, nextId)`, `ChatState.sendVoiceToAgent(surface, blob)`.

- [ ] **Step 1: Failing test** — inject a `voiceApi` returning a known transcript + a `proposal` outcome; assert a user bubble = transcript and an assistant quote message are appended.

```ts
it("sendVoiceToAgent appends the transcript as the user bubble + the outcome", async () => {
  const voiceApi = vi.fn().mockResolvedValue({
    reply: { text: "ok" },
    transcript: "buy 50000 naira of usdt",
    conversationId: "11111111-1111-1111-1111-111111111111",
    messageId: "22222222-2222-2222-2222-222222222222",
    outcome: {
      kind: "proposal",
      txType: "buy",
      proposalId: "33333333-3333-3333-3333-333333333333",
      confirmation: {
        /* a valid BuyProposalConfirmation fixture */
      } as never,
    },
  });
  const store = createChatStore({ schedule: (fn) => fn(), voiceApi });
  await store
    .getState()
    .sendVoiceToAgent("m", new Blob(["x"], { type: "audio/webm" }));
  const thread = store.getState().threads.m;
  const user = thread.find((m) => m.role === "user");
  expect(user?.text).toBe("buy 50000 naira of usdt");
  expect(thread.some((m) => m.kind === "quote")).toBe(true);
});
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Refactor `sendToAgent`'s outcome mapping into `applyOutcome`** (module-level pure function above `createChatStore`). Move the entire `if (outcome.kind === ...) { ... }` block (currently inside `sendToAgent`) into:

```ts
function applyOutcome(
  outcome: WebChatResponse["outcome"],
  nextId: () => string,
): { messages: ChatMessage[]; pendingProposalId?: string } {
  const messages: ChatMessage[] = [];
  let pendingProposalId: string | undefined;
  // ...exact same branch logic moved verbatim from sendToAgent, pushing into `messages`,
  // and setting `pendingProposalId = outcome.proposalId` in the proposal branch...
  return { messages, pendingProposalId };
}
```

Update `sendToAgent` to call `applyOutcome` and apply the result (append `messages`, `set({ pendingProposalId })` when present). Behavior must be identical — the existing `sendToAgent` tests must stay green.

- [ ] **Step 4: Add the `voiceApi` option + `sendVoiceToAgent`**

```ts
// in CreateChatStoreOptions:
voiceApi?: (blob: Blob) => Promise<VoiceChatResponse>

// in createChatStore:
const voiceApiFn = options.voiceApi ?? defaultSendVoiceNote   // import { sendVoiceNote as defaultSendVoiceNote }

// new action:
async sendVoiceToAgent(surface, blob) {
  set((s) => ({
    chips: { ...s.chips, [surface]: [] },
    typing: { ...s.typing, [surface]: true },
  }))
  try {
    const response = await voiceApiFn(blob)
    const userMsg: ChatMessage = { id: nextId(), role: "user", kind: "text", text: response.transcript }
    const { messages, pendingProposalId } = applyOutcome(response.outcome, nextId)
    set((s) => ({
      threads: { ...s.threads, [surface]: [...s.threads[surface], userMsg, ...messages] },
      typing: { ...s.typing, [surface]: false },
      chips: { ...s.chips, [surface]: startChips() },
      ...(pendingProposalId ? { pendingProposalId } : {}),
    }))
  } catch {
    const errMsg: ChatMessage = { id: nextId(), role: "assistant", kind: "text", text: "I'm having trouble reaching the assistant right now — please try again." }
    set((s) => ({
      threads: { ...s.threads, [surface]: [...s.threads[surface], errMsg] },
      typing: { ...s.typing, [surface]: false },
      chips: { ...s.chips, [surface]: startChips() },
    }))
  }
},
```

Add `sendVoiceToAgent(surface: ChatSurface, blob: Blob): Promise<void>` to the `ChatState` interface and import `VoiceChatResponse` + `sendVoiceNote`.

- [ ] **Step 5: Run — expect PASS** (new test + all existing chat-store tests).

- [ ] **Step 6: Commit**

```bash
git add web/lib/store/chat-store.ts web/lib/store/chat-store.test.ts
git commit -m "feat(web): chat-store sendVoiceToAgent + shared applyOutcome"
```

---

### Task 13: `ChatComposer` record affordance + parent wiring

**Files:**

- Modify: `web/types/components.ts` (`ChatComposerProps` additions)
- Modify: `web/components/chat/chat-composer.tsx`
- Modify: `web/components/chat/chat-composer.test.tsx`
- Modify: `web/components/desktop/chat-rail.tsx`
- Modify: `web/components/mobile/mobile-shell.tsx`

**Interfaces:**

- Consumes: `useVoiceRecorder`, `store.sendVoiceToAgent`.
- Produces: composer props `recording`, `recordSeconds`, `canRecord`, `onRecordStart`, `onRecordStop`, `onRecordCancel`.

- [ ] **Step 1: Failing test** — render the composer recording vs idle and assert controls.

```tsx
it("shows a record button when idle and a stop/timer while recording", () => {
  const base = {
    chips: [],
    value: "",
    onChange: () => {},
    onSubmit: () => {},
    onChip: () => {},
    density: "m" as const,
    canRecord: true,
    recordSeconds: 0,
    onRecordStart: vi.fn(),
    onRecordStop: vi.fn(),
    onRecordCancel: vi.fn(),
  };
  const { rerender, getByLabelText, queryByText } = render(
    <ChatComposer {...base} recording={false} />,
  );
  getByLabelText("Record voice note");
  rerender(<ChatComposer {...base} recording recordSeconds={3} />);
  getByLabelText("Stop recording");
  expect(queryByText("0:03")).toBeTruthy();
});
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Add props to `ChatComposerProps`** in `web/types/components.ts`:

```ts
recording: boolean
recordSeconds: number
canRecord: boolean
onRecordStart: () => void
onRecordStop: () => void
onRecordCancel: () => void
```

- [ ] **Step 4: Implement composer UI** — replace the decorative mic `<svg>` block with:

```tsx
{
  props.recording ? (
    <div className="flex items-center gap-2">
      <span className="text-xs tabular-nums text-danger">
        {Math.floor(props.recordSeconds / 60)}:
        {String(props.recordSeconds % 60).padStart(2, "0")}
      </span>
      <button
        type="button"
        aria-label="Cancel recording"
        onClick={props.onRecordCancel}
        className="text-muted-foreground"
      >
        ✕
      </button>
      <button
        type="button"
        aria-label="Stop recording"
        onClick={props.onRecordStop}
        className="text-danger"
      >
        {/* stop-square glyph */}
        <span className="block h-3 w-3 rounded-[2px] bg-danger" />
      </button>
    </div>
  ) : (
    props.canRecord && (
      <button
        type="button"
        aria-label="Record voice note"
        onClick={props.onRecordStart}
        className="shrink-0"
      >
        {/* existing mic glyph svg, now inside a button */}
      </button>
    )
  );
}
```

(Keep the existing mic SVG markup inside the idle `<button>`; preserve token classes; honor focus-visible.)

- [ ] **Step 5: Wire parents** — in both `chat-rail.tsx` and `mobile-shell.tsx`:

```tsx
const recorder = useVoiceRecorder()
// pass to <ChatComposer ... >:
recording={recorder.status === "recording"}
recordSeconds={recorder.seconds}
canRecord={recorder.status !== "unsupported"}
onRecordStart={() => void recorder.start()}
onRecordStop={async () => {
  const blob = await recorder.stop()
  if (blob) void state.sendVoiceToAgent(/* "d" or "m" */, blob)
}}
onRecordCancel={() => recorder.cancel()}
```

- [ ] **Step 6: Run web tests — expect PASS** (composer + any snapshot updates). `pnpm --filter @handshake-agent/web test` → PASS.

- [ ] **Step 7: Typecheck + commit**

```bash
pnpm --filter @handshake-agent/web typecheck
git add web/types/components.ts web/components/chat/chat-composer.tsx web/components/chat/chat-composer.test.tsx web/components/desktop/chat-rail.tsx web/components/mobile/mobile-shell.tsx
git commit -m "feat(web): voice-note record affordance in chat composer"
```

- [ ] **Step 8: Manual live check (no test substitute):** `PORT=3001 pnpm --filter @handshake-agent/api dev` + web preview; log in as a verified user; record "where do I receive USDT?"; confirm the transcript bubble + receive card render. Screenshot for the user.

---

# PHASE 5 — WhatsApp audio (download + transcribe + route)

### Task 14: `IWhatsAppMediaClient` + `CloudApiMediaClient`

**Files:**

- Create: `api/src/modules/whatsapp/application/ports/whatsapp-media.port.ts`
- Create: `api/src/modules/whatsapp/infrastructure/cloud-api.media-client.ts`
- Create: `api/src/modules/whatsapp/infrastructure/cloud-api.media-client.spec.ts`

**Interfaces:**

- Consumes: `HttpService`, `ConfigService<Env>`, config `media.whatsapp.maxMediaBytes`.
- Produces: `WHATSAPP_MEDIA_CLIENT`, `IWhatsAppMediaClient`, `CloudApiMediaClient`.

- [ ] **Step 1: Failing test** — mock the two-step Graph fetch (metadata → bytes).

```ts
import { of } from "rxjs";
import { CloudApiMediaClient } from "./cloud-api.media-client";

function makeConfig() {
  const v: Record<string, unknown> = {
    WHATSAPP_GRAPH_BASE_URL: "https://graph.facebook.com",
    WHATSAPP_GRAPH_VERSION: "v25.0",
    WHATSAPP_ACCESS_TOKEN: "TKN",
    "media.whatsapp.maxMediaBytes": 25000000,
  };
  return {
    get: (k: string) => v[k],
  } as unknown as import("@nestjs/config").ConfigService;
}

describe("CloudApiMediaClient", () => {
  it("resolves media id → url → bytes", async () => {
    const get = jest
      .fn()
      .mockReturnValueOnce(
        of({ data: { url: "https://lookaside/abc", mime_type: "audio/ogg" } }),
      )
      .mockReturnValueOnce(of({ data: Buffer.from("AUDIO") }));
    const http = { get } as unknown as import("@nestjs/axios").HttpService;
    const client = new CloudApiMediaClient(http, makeConfig());

    const res = await client.download("MID1");
    expect(res.mimeType).toBe("audio/ogg");
    expect(res.bytes.toString()).toBe("AUDIO");
    expect(get.mock.calls[0][0]).toBe("https://graph.facebook.com/v25.0/MID1");
    expect(
      (get.mock.calls[1][1].headers as Record<string, string>).Authorization,
    ).toBe("Bearer TKN");
  });

  it("rejects media larger than the cap", async () => {
    const big = Buffer.alloc(26000000);
    const get = jest
      .fn()
      .mockReturnValueOnce(
        of({ data: { url: "https://lookaside/x", mime_type: "image/jpeg" } }),
      )
      .mockReturnValueOnce(of({ data: big }));
    const client = new CloudApiMediaClient({ get } as never, makeConfig());
    await expect(client.download("X")).rejects.toThrow(/too large/i);
  });
});
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement the port** — `whatsapp-media.port.ts`

```ts
export const WHATSAPP_MEDIA_CLIENT = Symbol("WHATSAPP_MEDIA_CLIENT");

export interface DownloadedMedia {
  bytes: Buffer;
  mimeType: string;
}
export interface IWhatsAppMediaClient {
  /** Resolves a Cloud API media id to its raw bytes (two-step Graph fetch). */
  download(mediaId: string): Promise<DownloadedMedia>;
}
```

- [ ] **Step 4: Implement the adapter** — `cloud-api.media-client.ts`

```ts
import { Injectable } from "@nestjs/common";
import { HttpService } from "@nestjs/axios";
import { ConfigService } from "@nestjs/config";
import { firstValueFrom } from "rxjs";

import type { Env } from "../../../core/config/env.schema";
import type {
  DownloadedMedia,
  IWhatsAppMediaClient,
} from "../application/ports/whatsapp-media.port";

interface MediaMetadata {
  url: string;
  mime_type: string;
}

/** Downloads inbound media via the Graph media API. Never logs bytes/token (§3.5). */
@Injectable()
export class CloudApiMediaClient implements IWhatsAppMediaClient {
  private readonly metaBase: string;
  private readonly authHeader: string;
  private readonly maxBytes: number;

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService<Env, true>,
  ) {
    const base = this.config.get("WHATSAPP_GRAPH_BASE_URL", { infer: true });
    const version = this.config.get("WHATSAPP_GRAPH_VERSION", { infer: true });
    const token = this.config.get("WHATSAPP_ACCESS_TOKEN", { infer: true });
    this.metaBase = `${base}/${version}`;
    this.authHeader = `Bearer ${token}`;
    this.maxBytes =
      (this.config.get("media.whatsapp.maxMediaBytes" as never) as
        | number
        | undefined) ?? 25_000_000;
  }

  async download(mediaId: string): Promise<DownloadedMedia> {
    const meta = await firstValueFrom(
      this.http.get<MediaMetadata>(`${this.metaBase}/${mediaId}`, {
        headers: { Authorization: this.authHeader },
      }),
    );
    const { url, mime_type: mimeType } = meta.data;

    const file = await firstValueFrom(
      this.http.get<ArrayBuffer>(url, {
        headers: { Authorization: this.authHeader },
        responseType: "arraybuffer",
      }),
    );
    const bytes = Buffer.from(file.data as ArrayBuffer);
    if (bytes.length > this.maxBytes) {
      throw new Error(`Inbound media too large: ${bytes.length} bytes`);
    }
    return { bytes, mimeType };
  }
}
```

> Note: confirm how the existing config reads nested JSON keys (`media.whatsapp.maxMediaBytes`). If `ConfigService` is typed to `Env` only, read the JSON layer the same way other code reads `configuration.ts` values (e.g. a non-`infer` `get<number>('media.whatsapp.maxMediaBytes')`). Align with the pattern Task 8 established.

- [ ] **Step 5: Run — expect PASS.**

- [ ] **Step 6: Commit**

```bash
git add api/src/modules/whatsapp/application/ports/whatsapp-media.port.ts api/src/modules/whatsapp/infrastructure/cloud-api.media-client.ts api/src/modules/whatsapp/infrastructure/cloud-api.media-client.spec.ts
git commit -m "feat(api): WhatsApp Graph media-download client"
```

---

### Task 15: `InboundMessage` extension + `WhatsAppInboundService` (text + audio)

**Files:**

- Modify: `api/src/modules/whatsapp/application/ports/inbound-handler.port.ts` (add optional `inputModality`, `extraction`)
- Modify: `api/src/modules/whatsapp/application/whatsapp-inbound.mapper.ts` (accept an event; keep the existing text mapping)
- Create: `api/src/modules/whatsapp/application/whatsapp-inbound.service.ts`
- Create: `api/src/modules/whatsapp/application/whatsapp-inbound.service.spec.ts`
- Modify: `api/src/modules/whatsapp/presentation/whatsapp-webhook.controller.ts` (delegate to the service)
- Modify: `api/src/modules/whatsapp/whatsapp.module.ts` (provide `WHATSAPP_MEDIA_CLIENT`, `WhatsAppInboundService`; import `MediaModule`; the controller now injects the service)

**Interfaces:**

- Consumes: `extractInboundEvents`, `IWhatsAppMediaClient`, `ITranscriptionPort`, `IDocumentExtractionPort`, `IInboundHandler`, `IWhatsAppSender`.
- Produces: `WhatsAppInboundService.ingest(payload)`.

- [ ] **Step 1: Extend `InboundMessage`** (DTO) — add to the type:

```ts
  /** 'voice' when the text was produced by transcribing an audio message. */
  inputModality?: 'text' | 'voice';
  /** Present for image/document messages — a candidate to route (not money). */
  extraction?: import('@handshake-agent/contracts').DocumentExtractionResult;
```

Relax the `channel` field if needed so the mapper can still set `'whatsapp'`. Keep `text` required (image/doc events set a short placeholder text — see Task 18).

- [ ] **Step 2: Failing test** — `whatsapp-inbound.service.spec.ts`: a payload with a text + an audio message routes both to `handleInbound`, with the audio's text = the transcript.

```ts
import { WhatsAppInboundService } from "./whatsapp-inbound.service";

const handler = { handleInbound: jest.fn().mockResolvedValue(undefined) };
const media = {
  download: jest
    .fn()
    .mockResolvedValue({ bytes: Buffer.from("a"), mimeType: "audio/ogg" }),
};
const transcription = {
  transcribe: jest.fn().mockResolvedValue({ text: "buy usdt" }),
};
const extraction = { extract: jest.fn() };
const sender = {
  sendText: jest.fn().mockResolvedValue({ externalMessageId: "x" }),
};

const payload = (msgs: Record<string, unknown>[]) => ({
  object: "whatsapp_business_account",
  entry: [
    {
      id: "E",
      changes: [
        {
          field: "messages",
          value: {
            messaging_product: "whatsapp",
            metadata: { display_phone_number: "1", phone_number_id: "P" },
            contacts: [{ profile: { name: "Ada" }, wa_id: "234" }],
            messages: msgs.map((m, i) => ({
              from: "234",
              id: `wamid.${i}`,
              timestamp: "1",
              ...m,
            })),
          },
        },
      ],
    },
  ],
});

it("routes text directly and audio via transcription", async () => {
  const svc = new WhatsAppInboundService(
    handler as never,
    media as never,
    transcription as never,
    extraction as never,
    sender as never,
  );
  await svc.ingest(
    payload([
      { type: "text", text: { body: "hi" } },
      {
        type: "audio",
        audio: { id: "MID", mime_type: "audio/ogg", voice: true },
      },
    ]) as never,
  );

  expect(handler.handleInbound).toHaveBeenCalledTimes(2);
  const audioCall = handler.handleInbound.mock.calls.find(
    (c) => c[0].inputModality === "voice",
  );
  expect(audioCall?.[0].text).toBe("buy usdt");
  expect(media.download).toHaveBeenCalledWith("MID");
});

it("continues the batch and sends a fallback when transcription fails", async () => {
  transcription.transcribe.mockRejectedValueOnce(new Error("stt down"));
  const svc = new WhatsAppInboundService(
    handler as never,
    media as never,
    transcription as never,
    extraction as never,
    sender as never,
  );
  await svc.ingest(
    payload([
      { type: "audio", audio: { id: "M", mime_type: "audio/ogg" } },
    ]) as never,
  );
  expect(sender.sendText).toHaveBeenCalled(); // safe fallback
});
```

- [ ] **Step 3: Run — expect FAIL.**

- [ ] **Step 4: Implement `WhatsAppInboundService`** (image/document handled here too, producing an `extraction` InboundMessage — the routing of that extraction lives in ConversationService, Task 18)

```ts
import { Injectable, Inject, Logger } from "@nestjs/common";
import {
  extractInboundEvents,
  type InboundEvent,
} from "@handshake-agent/contracts";
import type { WhatsAppInbound } from "@handshake-agent/contracts";

import {
  INBOUND_HANDLER,
  type IInboundHandler,
  type InboundMessage,
} from "./ports/inbound-handler.port";
import {
  WHATSAPP_MEDIA_CLIENT,
  type IWhatsAppMediaClient,
} from "./ports/whatsapp-media.port";
import {
  WHATSAPP_SENDER,
  type IWhatsAppSender,
} from "./ports/whatsapp-sender.port";
import {
  TRANSCRIPTION_PORT,
  type ITranscriptionPort,
} from "../../media/application/ports/transcription.port";
import {
  DOCUMENT_EXTRACTION_PORT,
  type IDocumentExtractionPort,
} from "../../media/application/ports/document-extraction.port";

const SAFE_FALLBACK = "Sorry, I had trouble reading that — please try again.";

@Injectable()
export class WhatsAppInboundService {
  private readonly logger = new Logger(WhatsAppInboundService.name);

  constructor(
    @Inject(INBOUND_HANDLER) private readonly handler: IInboundHandler,
    @Inject(WHATSAPP_MEDIA_CLIENT) private readonly media: IWhatsAppMediaClient,
    @Inject(TRANSCRIPTION_PORT)
    private readonly transcription: ITranscriptionPort,
    @Inject(DOCUMENT_EXTRACTION_PORT)
    private readonly extraction: IDocumentExtractionPort,
    @Inject(WHATSAPP_SENDER) private readonly sender: IWhatsAppSender,
  ) {}

  async ingest(payload: WhatsAppInbound): Promise<void> {
    for (const event of extractInboundEvents(payload)) {
      try {
        const msg = await this.toInboundMessage(event);
        if (msg) await this.handler.handleInbound(msg);
      } catch (err) {
        this.logger.error(
          {
            err: err instanceof Error ? err.message : String(err),
            externalMessageId: event.externalMessageId,
            kind: event.kind,
          },
          "inbound media ingest failed — sending safe fallback",
        );
        await this.sender
          .sendText(event.from, SAFE_FALLBACK)
          .catch(() => undefined);
      }
    }
  }

  private base(event: InboundEvent): Omit<InboundMessage, "text"> {
    return {
      externalMessageId: event.externalMessageId,
      fromAddress: event.from,
      phoneNumberId: event.phoneNumberId,
      waName: event.waName,
      timestamp: event.timestamp,
      channel: "whatsapp",
    };
  }

  private async toInboundMessage(
    event: InboundEvent,
  ): Promise<InboundMessage | null> {
    if (event.kind === "text") {
      return { ...this.base(event), text: event.text };
    }
    if (event.kind === "audio") {
      const { bytes, mimeType } = await this.media.download(event.mediaId);
      const { text } = await this.transcription.transcribe({ bytes, mimeType });
      return { ...this.base(event), text, inputModality: "voice" };
    }
    // image | document → extract a candidate (no agent run downstream)
    const { bytes, mimeType } = await this.media.download(event.mediaId);
    const extraction = await this.extraction.extract({ bytes, mimeType });
    return { ...this.base(event), text: `[${event.kind}]`, extraction };
  }
}
```

- [ ] **Step 5: Run — expect PASS** (the image/doc branch is exercised more in Task 18; here just assert it calls `extract` + `handleInbound` with `extraction` set — add that assertion if useful).

- [ ] **Step 6: Delegate from the controller** — in `whatsapp-webhook.controller.ts` replace the `extractTextMessages` loop with:

```ts
// inject WhatsAppInboundService instead of (or in addition to) INBOUND_HANDLER
await this.inboundService.ingest(parsed.data).catch((err: unknown) => {
  this.logger.error({ err }, "ingest threw — acking 200 anyway");
});
return { status: "received" };
```

Update the controller constructor + `whatsapp.module.ts` providers: add `MediaModule` to imports, bind `WHATSAPP_MEDIA_CLIENT → CloudApiMediaClient`, provide `WhatsAppInboundService`. Keep `INBOUND_HANDLER → ConversationService` binding intact.

- [ ] **Step 7: Update the controller spec** — the existing `whatsapp-webhook.controller.spec.ts` asserts on `extractTextMessages`/handler calls; update it to assert `inboundService.ingest` is called with the parsed payload. Keep the signature-guard + schema-reject + always-200 tests.

- [ ] **Step 8: Run unit — expect PASS.** `pnpm --filter @handshake-agent/api test -- whatsapp` → PASS.

- [ ] **Step 9: Typecheck + depcruise + commit**

```bash
pnpm --filter @handshake-agent/api typecheck && pnpm depcruise
git add api/src/modules/whatsapp
git commit -m "feat(api): WhatsApp inbound ingest service (text + audio transcription)"
```

---

### Task 16: e2e — WhatsApp audio message → agent path

**Files:**

- Create: `api/test/whatsapp-voice.e2e-spec.ts` (mirror the existing WhatsApp webhook e2e harness)

- [ ] **Step 1: Failing e2e** — POST an `audio` webhook payload with a valid signature; override `WHATSAPP_MEDIA_CLIENT` + `TRANSCRIPTION_PORT` to return a known transcript ("where do I receive USDT?") and the agent stub to map it; assert a reply was dispatched (sender mock called) and an inbound message persisted.

```ts
// override: WHATSAPP_MEDIA_CLIENT.useValue({ download: async () => ({ bytes: Buffer.from('a'), mimeType: 'audio/ogg' }) })
//           TRANSCRIPTION_PORT.useValue({ transcribe: async () => ({ text: 'where do I receive USDT?' }) })
//           WHATSAPP_SENDER spy to capture sendText
it("transcribes an inbound voice note and routes it through the agent", async () => {
  await request(app.getHttpServer())
    .post("/whatsapp/webhook")
    .set("X-Hub-Signature-256", sign(bodyString))
    .send(audioPayload)
    .expect(200);
  // assert the sender produced a receive-address reply (or a KYC handoff for an unlinked sender)
  expect(senderSpy.sendText).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run — expect FAIL → implement nothing new (logic exists from Task 15); fix wiring/overrides until PASS.**

- [ ] **Step 3: Run — expect PASS.** `pnpm --filter @handshake-agent/api test:e2e -- whatsapp-voice` → PASS.

- [ ] **Step 4: Commit**

```bash
git add api/test/whatsapp-voice.e2e-spec.ts
git commit -m "test(api): e2e WhatsApp inbound voice note → agent"
```

---

# PHASE 6 — WhatsApp image/document → beneficiary

### Task 17: `AssetRegistry.inferNetworkForAddress` + `defaultAssetForNetwork`

**Files:**

- Modify: `api/src/core/catalog/asset-registry.ts`
- Modify: `api/src/core/catalog/asset-registry.spec.ts`

**Interfaces:**

- Produces: `inferNetworkForAddress(address): string | null`, `defaultAssetForNetwork(networkId): string | null`.

- [ ] **Step 1: Failing test** — using the seeded registry (TRON), a TRON-shaped address infers `tron`; gibberish infers `null`.

```ts
it("infers the network from an address pattern", () => {
  const registry = makeRegistry(); // however the existing spec constructs it
  const tronAddr = "T" + "X".repeat(33); // matches the seeded TRON addressPattern; adjust to the real pattern
  expect(registry.inferNetworkForAddress(tronAddr)).toBe("tron");
  expect(registry.inferNetworkForAddress("not-an-address")).toBeNull();
});

it("returns a default asset for a network", () => {
  const registry = makeRegistry();
  expect(registry.defaultAssetForNetwork("tron")).toBe("USDT");
  expect(registry.defaultAssetForNetwork("unknown")).toBeNull();
});
```

> The implementer must read the real seeded `addressPattern` for TRON in the config/registry and craft a matching sample address in the test (don't invent one blindly).

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement** (reuse the already-compiled patterns; no hardcoded network/asset literals):

```ts
/** First registered network whose addressPattern matches, else null. */
inferNetworkForAddress(address: string): string | null {
  for (const net of this.networks()) {
    if (new RegExp(net.addressPattern).test(address)) return net.id;
  }
  return null;
}

/** A crypto asset enabled on the given network (the network's default), else null. */
defaultAssetForNetwork(networkId: string): string | null {
  const asset = this.assets().find((a) => this.defaultNetworkFor(a.symbol) === networkId);
  return asset ? asset.symbol : null;
}
```

> Adjust `this.networks()`/`this.assets()`/field names to the registry's actual accessors (read the file first). If a precompiled pattern array already exists (the file builds RegExps in the constructor), reuse it instead of `new RegExp` per call.

- [ ] **Step 4: Run — expect PASS.**

- [ ] **Step 5: Commit**

```bash
git add api/src/core/catalog/asset-registry.ts api/src/core/catalog/asset-registry.spec.ts
git commit -m "feat(api): AssetRegistry network inference helpers"
```

---

### Task 18: `ConversationService.handleExtractedMedia` + routing

**Files:**

- Modify: `api/src/modules/conversations/application/conversation.service.ts`
- Modify: `api/src/modules/conversations/application/conversation.service.spec.ts`

**Interfaces:**

- Consumes: `msg.extraction`, `requireActiveUser`/`sendKycHandoff` (existing), `BeneficiaryService.addCryptoAddress`, `AssetRegistry.inferNetworkForAddress`/`defaultAssetForNetwork`, `IWhatsAppSender`.
- Produces: the `handleExtractedMedia` branch inside `handleInbound`.

- [ ] **Step 1: Failing unit tests** (add to the conversation.service spec; reuse its existing mock setup for repos/services):

```ts
it("saves an extracted crypto address as a beneficiary and confirms", async () => {
  // arrange: identity resolves to a verified user; beneficiaryService.addCryptoAddress resolves
  assetRegistry.inferNetworkForAddress.mockReturnValue("tron");
  assetRegistry.defaultAssetForNetwork.mockReturnValue("USDT");
  beneficiaryService.addCryptoAddress.mockResolvedValue({ id: "b1" });
  await service.handleInbound(
    makeMsg({ extraction: { kind: "crypto_address", address: "TXYZ..." } }),
  );
  expect(beneficiaryService.addCryptoAddress).toHaveBeenCalledWith(
    expect.objectContaining({ network: "tron", asset: "USDT" }),
  );
  expect(sender.sendText).toHaveBeenCalledWith(
    "234...",
    expect.stringMatching(/payout address/i),
  );
});

it("replies with a polite failure when the address is not a supported network", async () => {
  assetRegistry.inferNetworkForAddress.mockReturnValue(null);
  await service.handleInbound(
    makeMsg({ extraction: { kind: "crypto_address", address: "garbage" } }),
  );
  expect(beneficiaryService.addCryptoAddress).not.toHaveBeenCalled();
  expect(sender.sendText).toHaveBeenCalledWith(
    "234...",
    expect.stringMatching(/valid wallet/i),
  );
});

it("does not run the agent for an extraction message", async () => {
  await service.handleInbound(makeMsg({ extraction: { kind: "none" } }));
  expect(agentPort.run).not.toHaveBeenCalled();
  expect(sender.sendText).toHaveBeenCalledWith(
    "234...",
    expect.stringMatching(/couldn't find/i),
  );
});

it("sends the KYC handoff when an unlinked contact sends an image", async () => {
  // identity resolves to a Contact (not a user)
  await service.handleInbound(
    makeMsg({ extraction: { kind: "crypto_address", address: "TXYZ..." } }),
  );
  expect(sender.sendCtaUrl).toHaveBeenCalled(); // or the text fallback per existing sendKycHandoff
});

it("echoes bank details without auto-saving when no bankCode is present", async () => {
  await service.handleInbound(
    makeMsg({
      extraction: {
        kind: "bank_account",
        accountNumber: "0123456789",
        bankName: "GTBank",
      },
    }),
  );
  expect(beneficiaryService.addBankAccount).not.toHaveBeenCalled();
  expect(sender.sendText).toHaveBeenCalledWith(
    "234...",
    expect.stringMatching(/0123456789|account/i),
  );
});
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Branch in `handleInbound`** — after the message is persisted (Step 4 in the existing method) and before the agent runs, insert:

```ts
// Image/document path: a vision-extracted candidate (never an agent run, never a money move).
if (msg.extraction) {
  const replyText = await this.handleExtractedMedia(
    msg.extraction,
    identity,
    msg,
  );
  const reply = await this.replyRepo.create({
    conversationId: conversation.id,
    messageId: message.id,
    text: replyText,
    correlationId,
  });
  await this.sender.sendText(msg.fromAddress, replyText);
  await this.replyRepo.updateStatus(reply.id, "sent", { sentAt: new Date() });
  await this.messageRepo.updateStatus(message.id, "processed");
  return;
}
```

(Keep this inside the existing `try` so the catch still marks the message failed + sends the safe fallback.)

- [ ] **Step 4: Implement `handleExtractedMedia`**

```ts
private async handleExtractedMedia(
  extraction: DocumentExtractionResult,
  identity: ResolvedIdentity,
  msg: InboundMessage,
): Promise<string> {
  const guard = this.requireActiveUser(identity, msg.fromAddress);
  if ('needsKyc' in guard) return this.sendKycHandoff(guard.channelAddress);
  if ('needsReverify' in guard) return this.reverifyFallbackReply();
  if ('reply' in guard) return guard.reply;
  const { user } = guard;

  if (extraction.kind === 'crypto_address') {
    const network = extraction.network ?? this.assetRegistry.inferNetworkForAddress(extraction.address);
    if (!network) return 'I read an address but it does not look like a valid wallet for a network we support.';
    const asset = this.assetRegistry.defaultAssetForNetwork(network);
    if (!asset) return 'I read a wallet address but we do not support that network yet.';
    try {
      await this.beneficiaryService.addCryptoAddress({ userId: user.id, address: extraction.address, network, asset });
    } catch {
      return 'I read a wallet address but could not validate it. Please double-check and try again.';
    }
    const networkMeta = this.assetRegistry.network(network);
    const masked = this.maskAddress(extraction.address);
    return `Saved this wallet (${networkMeta.displayName}, ${masked}) as a payout address. Say "send 10 USDT to it" to send.`;
  }

  if (extraction.kind === 'bank_account') {
    if (extraction.bankCode) {
      try {
        const saved = await this.beneficiaryService.addBankAccount({ userId: user.id, accountNumber: extraction.accountNumber, bankCode: extraction.bankCode });
        return `Saved ${saved.accountName ?? 'your account'} (•••${extraction.accountNumber.slice(-4)}) as a payout account.`;
      } catch {
        return 'I read bank details but could not verify the account. Please add it from the payout-account form.';
      }
    }
    const bank = extraction.bankName ? ` at ${extraction.bankName}` : '';
    return `I read account •••${extraction.accountNumber.slice(-4)}${bank}. Add it as a payout account and I'll use it.`;
  }

  return "I couldn't find a wallet address or bank details in that image.";
}

private maskAddress(addr: string): string {
  return addr.length <= 10 ? addr : `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}
```

Add the `import type { DocumentExtractionResult } from '@handshake-agent/contracts'` and ensure `assetRegistry.network(...)`/`addCryptoAddress` input names match the real signatures (Task 17 + the BeneficiaryService `AddCryptoAddressInput`/`AddBankAccountInput` types). `addCryptoAddress` needs `{ userId, address, network, asset, label? }`; pass a sensible default `label` if required (e.g. `'From image'`).

- [ ] **Step 5: Run — expect PASS.** `pnpm --filter @handshake-agent/api test -- conversation.service` → PASS.

- [ ] **Step 6: Commit**

```bash
git add api/src/modules/conversations/application/conversation.service.ts api/src/modules/conversations/application/conversation.service.spec.ts
git commit -m "feat(api): route extracted image media to beneficiary save (wallet/bank)"
```

---

### Task 19: e2e — WhatsApp image → beneficiary saved

**Files:**

- Create: `api/test/whatsapp-image.e2e-spec.ts`

- [ ] **Step 1: Failing e2e** — override `WHATSAPP_MEDIA_CLIENT` + `DOCUMENT_EXTRACTION_PORT` (return `{ kind: 'crypto_address', address: <valid TRON addr> }`); seed a verified user linked to the sender's WhatsApp number; POST a signed `image` webhook payload; assert (a) a beneficiary row now exists for the user, (b) a confirmation reply was dispatched, (c) the agent port was NOT called. Add a second case: an **unverified/unlinked** sender → KYC handoff sent, no beneficiary saved.

- [ ] **Step 2: Run — expect FAIL → fix wiring/overrides until PASS.**

- [ ] **Step 3: Run — expect PASS.** `pnpm --filter @handshake-agent/api test:e2e -- whatsapp-image` → PASS.

- [ ] **Step 4: Commit**

```bash
git add api/test/whatsapp-image.e2e-spec.ts
git commit -m "test(api): e2e WhatsApp inbound image → beneficiary saved"
```

---

# PHASE 7 — Wiring, docs, final gate

### Task 20: docs + full-workspace gate

**Files:**

- Modify: `api/.env.example` (verify all six media keys are present with comments)
- Modify: `api/CLAUDE.md` and/or `web/CLAUDE.md` — a short note on the media module + voice endpoint + inbound multimedia (one paragraph each, mirroring existing module notes)
- Modify: `docs/superpowers/specs/2026-06-29-voice-notes-and-multimedia-design.md` — flip status note if you track completion

- [ ] **Step 1: Run the FULL gate** (root) and capture output:

```bash
pnpm --filter @handshake-agent/contracts test
pnpm --filter @handshake-agent/api typecheck && pnpm --filter @handshake-agent/api test
pnpm --filter @handshake-agent/api test:e2e
pnpm --filter @handshake-agent/web typecheck && pnpm --filter @handshake-agent/web test
pnpm depcruise
```

Expected: all green. (Do **not** run `pnpm lint` — it is `eslint --fix`.)

- [ ] **Step 2:** Fix any cross-module boot failures surfaced by the e2e/app-boot (e.g. a module that forgot to import `MediaModule`). Re-run the gate.

- [ ] **Step 3: Commit docs**

```bash
git add api/.env.example api/CLAUDE.md web/CLAUDE.md docs/superpowers
git commit -m "docs: media module + voice/multimedia notes; final gate green"
```

- [ ] **Step 4: Whole-branch review** — invoke `superpowers:requesting-code-review` (or the repo's `/code-review`) over the full diff, paying special attention to: §3.1 (no money from STT/vision output), §3.2 (depcruise — media imports no Prisma), no secrets/bytes in logs, and that the existing WhatsApp text + web text paths are unchanged.

---

## Self-review notes (author)

- **Spec coverage:** §3 media module → Tasks 3–7; §4 contracts → Tasks 1–2; §5 web voice → Tasks 8–13; §6 WhatsApp media → Tasks 14–19; §7 config/env → Tasks 7,8; §8 testing → folded into each task + Tasks 16,19,20; §9 invariants → Global Constraints + Task 20 review.
- **Deferred (explicit):** `inputModality` DB column dropped from MVP (carried only in the app-layer DTO/logs); bank auto-save only when `bankCode` is extracted (else echo-and-route); prefilled beneficiary Flow for bank is noted in the spec but implemented as the text fallback here (publishing the Flow JSON is an operator step) — if you want the prefill pass-through wired, extend `IWhatsAppSender.sendBeneficiaryFlow` with an optional `prefill` and add it in Task 18's bank branch behind the `WHATSAPP_FLOW_ID` check.
- **Type consistency:** `transcribe({bytes,mimeType,filename?})→{text}`, `extract({bytes,mimeType})→DocumentExtractionResult`, `download(mediaId)→{bytes,mimeType}`, `ingest(payload)→void`, `inferNetworkForAddress→string|null` are used identically across producer and consumer tasks.
- **Real-codebase confirmations the implementer must make (read before coding the task):** the JSON config loader path + nested-key read style (Tasks 8,15); the `ChatAnthropic` option names + structured-output mocking (Task 6, copy from `agent/infrastructure`); the WhatsApp webhook e2e harness + signature signing (Tasks 16,19); the `AddCryptoAddressInput`/`AddBankAccountInput` field names + `AssetRegistry` accessor names (Tasks 17,18); the web test runner is Vitest, not Jest (Tasks 10–13 — adapt `jest.*`→`vi.*`).
