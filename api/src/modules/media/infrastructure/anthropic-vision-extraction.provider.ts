import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
// ESM-under-CJS: always use `import` for @langchain packages (tsc downlevels to require).
// Never hand-write require() — see root CLAUDE.md §6.
import { ChatAnthropic } from '@langchain/anthropic';
import {
  DocumentExtractionResultSchema,
  type DocumentExtractionResult,
} from '@handshake-agent/contracts';

import type {
  ExtractInput,
  IDocumentExtractionPort,
} from '../application/ports/document-extraction.port';

const SYSTEM_PROMPT =
  'You extract payment destination details from an image or document. Return ' +
  'kind="crypto_address" with the wallet address (and network if obvious: tron/ethereum/...) ' +
  'when a single crypto wallet address is visible; kind="bank_account" with the account number ' +
  '(and bank name/code if shown) when Nigerian bank-account details are visible; otherwise ' +
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
    const apiKey = this.config.get<string>('ANTHROPIC_API_KEY') ?? '';
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not configured');
    const model =
      this.config.get<string>('MEDIA_EXTRACTION_MODEL') ?? 'claude-opus-4-8';
    const llm = new ChatAnthropic({ apiKey, model, temperature: 0 });
    return llm.withStructuredOutput(DocumentExtractionResultSchema);
  }

  async extract(input: ExtractInput): Promise<DocumentExtractionResult> {
    const model = this.structuredModel();
    const base64 = input.bytes.toString('base64');
    // External-SDK boundary: vision content-block shape is `any` at the LangChain
    // message level — cast to avoid TS fighting withStructuredOutput's message type (§13.4).
    const messages: unknown = [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'Extract the payment destination from this media.',
          },
          {
            type: 'image_url',
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
