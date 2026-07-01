/**
 * AgentPage + ConversationLogDetail tests.
 *
 *  4. The config card renders the modelId on a read-only ("read-mostly")
 *     guardrails surface with the read-only system-prompt section.
 *  5. Opening a conversation renders its messages with their NLU intents.
 *
 * The operator-console re-skin split these across two components: AgentPage owns
 * the read-only config cards; the conversation drawer (messages + validated NLU
 * intents) lives in ConversationLogDetail, driven directly here.
 *
 * The api layer is mocked — no server.
 */
import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type {
  AgentConfigView,
  ConversationLogDetail as ConversationLogDetailView,
  ConversationLogListResponse,
} from "@handshake-agent/contracts"

import { AgentPage } from "@/components/admin/agent-page"
import { ConversationLogDetail } from "@/components/admin/conversation-log-detail"

// ─── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock("@/lib/api/agent", () => ({
  getAgentConfig: vi.fn(),
  listConversations: vi.fn(),
  getConversation: vi.fn(),
}))

import {
  getAgentConfig,
  listConversations,
  getConversation,
} from "@/lib/api/agent"

const mockConfig = vi.mocked(getAgentConfig)
const mockList = vi.mocked(listConversations)
const mockGet = vi.mocked(getConversation)

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const CONFIG: AgentConfigView = {
  modelId: "claude-opus-4-8",
  enabled: true,
  systemPromptPreview: "You are the Handshake agent. You never move money.",
}

const CONVERSATIONS: ConversationLogListResponse = {
  items: [
    {
      id: "cc111111-1111-1111-1111-111111111111",
      userId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      contactId: null,
      language: "en",
      status: "active",
      lastMessageAt: "2026-01-01T00:00:00.000Z",
      createdAt: "2026-01-01T00:00:00.000Z",
    },
  ],
  nextCursor: null,
}

const DETAIL: ConversationLogDetailView = {
  id: "cc111111-1111-1111-1111-111111111111",
  userId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  contactId: null,
  language: "en",
  status: "active",
  messages: [
    {
      id: "mm111111-1111-1111-1111-111111111111",
      text: "Buy 50 USDT",
      processingStatus: "processed",
      receivedAt: "2026-01-01T00:00:00.000Z",
      intent: { action: "crypto.buy", confidence: 0.92 },
    },
  ],
  replies: [
    {
      id: "rr111111-1111-1111-1111-111111111111",
      text: "Here's your buy quote.",
      status: "sent",
      sentAt: "2026-01-01T00:00:01.000Z",
    },
  ],
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <AgentPage />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  mockConfig.mockReset()
  mockList.mockReset()
  mockGet.mockReset()
  mockConfig.mockResolvedValue(CONFIG)
  mockList.mockResolvedValue(CONVERSATIONS)
  mockGet.mockResolvedValue(DETAIL)
})

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("AgentPage", () => {
  it("renders the modelId on the read-only config surface", async () => {
    renderPage()

    // The resolved model id renders on the config card.
    expect(await screen.findByText("claude-opus-4-8")).toBeInTheDocument()
    // The config surface is read-only ("read-mostly" guardrails), never editable.
    expect(screen.getByText(/read-mostly/i)).toBeInTheDocument()
    // The system-prompt section is present; changes route through maker-checker
    // (it is never edited in place — the read-only posture of §3.1).
    expect(screen.getByText(/system-prompt versions/i)).toBeInTheDocument()
    expect(screen.getByText(/change = maker-checker/i)).toBeInTheDocument()
  })

  it("renders a conversation's messages with their NLU intents", async () => {
    // The conversation drawer moved into ConversationLogDetail during the
    // re-skin; opening it with a conversation id fetches + renders the log.
    render(
      <QueryClientProvider
        client={
          new QueryClient({
            defaultOptions: {
              queries: { retry: false },
              mutations: { retry: false },
            },
          })
        }
      >
        <ConversationLogDetail
          conversationId={DETAIL.id}
          onOpenChange={() => {}}
        />
      </QueryClientProvider>
    )

    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(1))

    // Message text + the intent badge are rendered.
    expect(await screen.findByText("Buy 50 USDT")).toBeInTheDocument()
    expect(screen.getByText(/intent: crypto\.buy/i)).toBeInTheDocument()
    // Reply rendered too.
    expect(screen.getByText("Here's your buy quote.")).toBeInTheDocument()
  })
})
