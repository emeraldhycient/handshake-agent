/**
 * AgentPage + ConversationLogDetail tests.
 *
 *  - The config card renders the modelId + enablement on a read-only
 *    ("read-mostly") guardrails surface, plus the guardrail rows from
 *    useAgentInsights() (incl. the config-tunable max-tool-calls).
 *  - The other three cards (prompt version, tool registry, 24h usage) render REAL
 *    insights data — the tool registry from the real intent-action set, and 24h
 *    usage as measurable COUNTS (never fabricated tokens/cost, §3.6).
 *  - Opening a conversation renders its messages with their NLU intents.
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
  AgentInsightsView,
  ConversationLogDetail as ConversationLogDetailView,
  ConversationLogListResponse,
} from "@handshake-agent/contracts"

import { AgentPage } from "@/components/admin/agent-page"
import { ConversationLogDetail } from "@/components/admin/conversation-log-detail"

// ─── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock("@/lib/api/agent", () => ({
  getAgentConfig: vi.fn(),
  getAgentInsights: vi.fn(),
  listConversations: vi.fn(),
  getConversation: vi.fn(),
}))

import {
  getAgentConfig,
  getAgentInsights,
  listConversations,
  getConversation,
} from "@/lib/api/agent"

const mockConfig = vi.mocked(getAgentConfig)
const mockInsights = vi.mocked(getAgentInsights)
const mockList = vi.mocked(listConversations)
const mockGet = vi.mocked(getConversation)

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const CONFIG: AgentConfigView = {
  modelId: "claude-opus-4-8",
  enabled: true,
  systemPromptPreview: "You are the Handshake agent. You never move money.",
}

const INSIGHTS: AgentInsightsView = {
  guardrails: [
    { label: "Structured output", value: "IntentSchema (enforced)" },
    { label: "Checkpointer", value: "none (extractable)" },
    { label: "PIN + step-up", value: "required to execute" },
    { label: "Max tool calls / turn", value: "1" },
  ],
  tools: [
    { name: "check_balance", kind: "read" },
    { name: "query_transactions", kind: "read" },
    { name: "buy_crypto", kind: "write" },
    { name: "send_crypto", kind: "write" },
  ],
  promptVersion: { label: "live", status: "live", promptChars: 812 },
  usage24h: {
    conversations: 12,
    inboundMessages: 44,
    outboundReplies: 41,
    windowHours: 24,
  },
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
  mockInsights.mockReset()
  mockList.mockReset()
  mockGet.mockReset()
  mockConfig.mockResolvedValue(CONFIG)
  mockInsights.mockResolvedValue(INSIGHTS)
  mockList.mockResolvedValue(CONVERSATIONS)
  mockGet.mockResolvedValue(DETAIL)
})

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("AgentPage", () => {
  it("renders the real modelId + enablement + guardrails on the read-only surface", async () => {
    renderPage()

    // The resolved model id (from useAgentConfig) renders on the config card.
    expect(await screen.findByText("claude-opus-4-8")).toBeInTheDocument()
    // The resolved enablement flag renders as its own guardrail row.
    expect(screen.getByText("Agent enabled")).toBeInTheDocument()
    expect(screen.getByText("yes")).toBeInTheDocument()
    // The guardrail rows (from useAgentInsights) render — incl. the config-tunable
    // max-tool-calls value, NOT a hardcoded "6".
    expect(screen.getByText("Max tool calls / turn")).toBeInTheDocument()
    expect(screen.getByText("IntentSchema (enforced)")).toBeInTheDocument()
    // Both clients were actually called (real data, not the old mock consts).
    expect(mockConfig).toHaveBeenCalledTimes(1)
    expect(mockInsights).toHaveBeenCalled()
    // The config surface is read-only ("read-mostly"), never editable.
    expect(screen.getByText(/read-mostly/i)).toBeInTheDocument()
  })

  it("renders the live prompt version with the char fingerprint (read-only)", async () => {
    renderPage()

    expect(await screen.findByText(/system-prompt versions/i)).toBeInTheDocument()
    // The single live version + its char fingerprint render (no version store yet).
    expect(await screen.findByText(/812 chars/i)).toBeInTheDocument()
    expect(screen.getByText(/· live/i)).toBeInTheDocument()
  })

  it("renders the tool registry from the real intent-action set with read/write chips", async () => {
    renderPage()

    // Real tool names render.
    expect(await screen.findByText("check_balance")).toBeInTheDocument()
    expect(screen.getByText("buy_crypto")).toBeInTheDocument()
    // Both kinds render as chips (read = data, write = proposal-only).
    expect(screen.getAllByText("read").length).toBeGreaterThan(0)
    expect(screen.getAllByText("write").length).toBeGreaterThan(0)
  })

  it("renders REAL 24h usage COUNTS and never fabricates tokens/cost", async () => {
    renderPage()

    // The measurable counts render (conversations / inbound / outbound).
    expect(await screen.findByText("Conversations")).toBeInTheDocument()
    expect(screen.getByText("12")).toBeInTheDocument()
    expect(screen.getByText("Inbound messages")).toBeInTheDocument()
    expect(screen.getByText("44")).toBeInTheDocument()
    expect(screen.getByText("Outbound replies")).toBeInTheDocument()
    expect(screen.getByText("41")).toBeInTheDocument()
    // No fabricated token/cost rows survive.
    expect(screen.queryByText(/input tokens/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/est\. cost/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/\$48\.20/)).not.toBeInTheDocument()
  })

  it("shows a loading placeholder before the config resolves, then the data", async () => {
    // Hold the config promise open so the loading branch is observable.
    let resolveConfig: (v: AgentConfigView) => void = () => {}
    mockConfig.mockReturnValue(
      new Promise<AgentConfigView>((resolve) => {
        resolveConfig = resolve
      })
    )

    const { container } = renderPage()

    // Loading branch: the card body is a busy skeleton region, no model id yet.
    expect(container.querySelector('[aria-busy="true"]')).toBeInTheDocument()
    expect(screen.queryByText("claude-opus-4-8")).not.toBeInTheDocument()

    // Resolve → data branch replaces the skeleton with the real model id.
    resolveConfig(CONFIG)
    expect(await screen.findByText("claude-opus-4-8")).toBeInTheDocument()
    expect(
      container.querySelector('[aria-busy="true"]')
    ).not.toBeInTheDocument()
  })

  it("renders an inline error with a retry affordance when the config fails", async () => {
    mockConfig.mockRejectedValue(new Error("boom"))

    renderPage()

    // Error branch: a tokened inline error + a Retry affordance (still no model id).
    expect(
      await screen.findByText(/couldn't load agent config/i)
    ).toBeInTheDocument()
    expect(
      screen.getAllByRole("button", { name: /retry/i }).length
    ).toBeGreaterThan(0)
    expect(screen.queryByText("claude-opus-4-8")).not.toBeInTheDocument()
  })

  it("surfaces disabled enablement faithfully (never fabricated)", async () => {
    mockConfig.mockResolvedValue({ ...CONFIG, enabled: false })

    renderPage()

    expect(await screen.findByText("Agent enabled")).toBeInTheDocument()
    expect(screen.getByText("no")).toBeInTheDocument()
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
