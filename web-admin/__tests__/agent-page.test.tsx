/**
 * AgentPage + ConversationLogDetail tests.
 *
 *  4. The config card renders the modelId + the read-only system prompt.
 *  5. Opening a conversation renders its messages with their NLU intents.
 *
 * The api layer is mocked — no server.
 */
import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type {
  AgentConfigView,
  ConversationLogDetail,
  ConversationLogListResponse,
} from "@handshake-agent/contracts"

import { AgentPage } from "@/components/admin/agent-page"

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

const DETAIL: ConversationLogDetail = {
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
  it("renders the modelId and the read-only system prompt", async () => {
    renderPage()

    expect(await screen.findByText("claude-opus-4-8")).toBeInTheDocument()
    expect(
      screen.getByText(/You are the Handshake agent\./i)
    ).toBeInTheDocument()
    // The system-prompt section is present and marked read-only.
    expect(screen.getByText(/system prompt/i)).toBeInTheDocument()
    expect(screen.getByText(/read-only/i)).toBeInTheDocument()
  })

  it("renders a conversation's messages with their NLU intents", async () => {
    const user = userEvent.setup()
    renderPage()

    // Open the conversation drawer.
    await user.click(
      await screen.findByLabelText(/open conversation cc111111/i)
    )

    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(1))

    // Message text + the intent badge are rendered.
    expect(await screen.findByText("Buy 50 USDT")).toBeInTheDocument()
    expect(screen.getByText(/intent: crypto\.buy/i)).toBeInTheDocument()
    // Reply rendered too.
    expect(screen.getByText("Here's your buy quote.")).toBeInTheDocument()
  })
})
