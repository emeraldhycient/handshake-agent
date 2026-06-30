import {
  AgentConfigViewSchema,
  ConversationLogDetailSchema,
  ConversationLogItemSchema,
  ConversationLogListResponseSchema,
  ConversationLogMessageSchema,
  ConversationLogReplySchema,
} from "./agent.dto";

describe("AgentConfigViewSchema", () => {
  it("parses a well-formed agent config view", () => {
    const view = {
      modelId: "claude-opus-4-8",
      enabled: true,
      systemPromptPreview: "You are a financial intent extractor...",
    };
    expect(AgentConfigViewSchema.parse(view)).toEqual(view);
  });

  it("requires enabled to be a boolean", () => {
    expect(() =>
      AgentConfigViewSchema.parse({
        modelId: "claude-opus-4-8",
        enabled: "true",
        systemPromptPreview: "x",
      }),
    ).toThrow();
  });

  it("does not model any apiKey field (the API key never crosses this boundary)", () => {
    expect(Object.keys(AgentConfigViewSchema.shape)).toEqual([
      "modelId",
      "enabled",
      "systemPromptPreview",
    ]);
  });
});

describe("ConversationLogItemSchema", () => {
  const item = {
    id: "11111111-1111-1111-1111-111111111111",
    userId: "22222222-2222-2222-2222-222222222222",
    contactId: null,
    language: "en",
    status: "active",
    lastMessageAt: "2026-06-30T00:00:00.000Z",
    createdAt: "2026-06-30T00:00:00.000Z",
  };

  it("parses a well-formed log item", () => {
    expect(ConversationLogItemSchema.parse(item)).toEqual(item);
  });

  it("allows null userId / contactId / lastMessageAt", () => {
    expect(
      ConversationLogItemSchema.parse({
        ...item,
        userId: null,
        contactId: "33333333-3333-3333-3333-333333333333",
        lastMessageAt: null,
      }),
    ).toBeTruthy();
  });

  it("requires id to be a uuid", () => {
    expect(() =>
      ConversationLogItemSchema.parse({ ...item, id: "nope" }),
    ).toThrow();
  });
});

describe("ConversationLogListResponseSchema", () => {
  it("parses an empty list with a null cursor", () => {
    expect(
      ConversationLogListResponseSchema.parse({ items: [], nextCursor: null }),
    ).toEqual({ items: [], nextCursor: null });
  });
});

describe("ConversationLogMessageSchema", () => {
  const message = {
    id: "11111111-1111-1111-1111-111111111111",
    text: "buy 5000 naira of usdt",
    processingStatus: "processed",
    receivedAt: "2026-06-30T00:00:00.000Z",
    intent: { action: "buy_crypto", confidence: 0.91 },
  };

  it("parses a message with an intent", () => {
    expect(ConversationLogMessageSchema.parse(message)).toEqual(message);
  });

  it("allows a null intent and a null confidence", () => {
    expect(
      ConversationLogMessageSchema.parse({ ...message, intent: null }),
    ).toBeTruthy();
    expect(
      ConversationLogMessageSchema.parse({
        ...message,
        intent: { action: "none", confidence: null },
      }),
    ).toBeTruthy();
  });
});

describe("ConversationLogReplySchema", () => {
  it("parses a reply with a null sentAt", () => {
    expect(
      ConversationLogReplySchema.parse({
        id: "11111111-1111-1111-1111-111111111111",
        text: "Here is your quote",
        status: "created",
        sentAt: null,
      }),
    ).toBeTruthy();
  });
});

describe("ConversationLogDetailSchema", () => {
  it("parses a detail aggregate with messages + replies", () => {
    const detail = {
      id: "11111111-1111-1111-1111-111111111111",
      userId: null,
      contactId: "33333333-3333-3333-3333-333333333333",
      language: "en",
      status: "active",
      messages: [
        {
          id: "44444444-4444-4444-4444-444444444444",
          text: "hi",
          processingStatus: "processed",
          receivedAt: "2026-06-30T00:00:00.000Z",
          intent: { action: "none", confidence: null },
        },
      ],
      replies: [
        {
          id: "55555555-5555-5555-5555-555555555555",
          text: "Hello!",
          status: "created",
          sentAt: null,
        },
      ],
    };
    expect(ConversationLogDetailSchema.parse(detail)).toEqual(detail);
  });
});
