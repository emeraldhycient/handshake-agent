/**
 * WhatsAppPage test (design §6.20) — Phase 8 (F-mock-b) honest shape-gap wiring.
 *
 * The "Number & webhook health" card is WIRED to `useWhatsAppConfig()`
 * (GET /admin/whatsapp/config): the non-secret Cloud-API / Flows wiring ids +
 * secret-PRESENCE booleans come from the real config view. Secret VALUES never
 * cross the boundary (root CLAUDE.md §3.5) — presence rows read only "Set" /
 * "Not set". The api layer is mocked; no server.
 *
 * Phase 8: the fabricated Flows registry (WA_FLOWS), the fabricated live
 * conversation monitor (WA_CONVO), and the fabricated operational-health rows
 * (quality rating, messaging limit, webhook status, template rejections) have NO
 * read endpoint yet, so instead of showing invented data they now render HONEST
 * shape-gap notes.
 *
 * Tests:
 *  1. loading → data: skeletons first, then the real wiring ids + secret-presence
 *     labels resolve; never a plaintext secret; the Cloud-API note is shown.
 *  2. error: a tokened inline error with a Retry affordance renders on failure.
 *  3. The Flows card + conversation monitor render HONEST shape-gap notes (no invented
 *     "KYC verification" flow rows, no fabricated chat bubbles).
 */
import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { WhatsAppConfigView } from "@handshake-agent/contracts"

import { WhatsAppPage } from "@/components/admin/whatsapp-page"

// ─── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock("@/lib/api/whatsapp", () => ({
  getWhatsAppConfig: vi.fn(),
}))

import { getWhatsAppConfig } from "@/lib/api/whatsapp"

const mockConfig = vi.mocked(getWhatsAppConfig)

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const CONFIG: WhatsAppConfigView = {
  graphVersion: "v21.0",
  graphBaseUrl: "https://graph.facebook.com",
  phoneNumberId: "109920857462311",
  flowId: "flow_kyc_001",
  beneficiaryFlowId: "flow_ben_002",
  wabaId: "waba_778899",
  appId: "app_445566",
  hasAppSecret: true,
  hasFlowPrivateKey: true,
  hasVerifyToken: false,
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <WhatsAppPage />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  mockConfig.mockReset()
})

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("WhatsAppPage", () => {
  it("shows a loading skeleton then the real wiring ids + secret-presence", async () => {
    mockConfig.mockResolvedValue(CONFIG)
    renderPage()

    // Loading branch: the health rows render a busy skeleton before data resolves.
    expect(screen.getByText("Number & webhook health")).toBeInTheDocument()
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull()

    // Data branch: real non-secret wiring ids resolve from the config view.
    expect(await screen.findByText("109920857462311")).toBeInTheDocument()
    expect(screen.getByText("waba_778899")).toBeInTheDocument()
    expect(screen.getByText("app_445566")).toBeInTheDocument()
    expect(screen.getByText("v21.0")).toBeInTheDocument()

    // Secret-presence renders only "Set" / "Not set" — never a plaintext secret.
    expect(screen.getByText("Verify token")).toBeInTheDocument()
    expect(screen.getAllByText("Set").length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText("Not set")).toBeInTheDocument()

    // The "Official Cloud API only" success note closes the card (§3.5).
    expect(
      screen.getByText("Official Cloud API only · ban-risk: low")
    ).toBeInTheDocument()
  })

  it("renders no fabricated operational-health signals (shape-gap)", async () => {
    mockConfig.mockResolvedValue(CONFIG)
    renderPage()

    await screen.findByText("109920857462311")

    // The invented operational values are gone (no fabricated quality/limit rows).
    expect(screen.queryByText("GREEN · High")).not.toBeInTheDocument()
    expect(screen.queryByText("Tier 3 · 100K / 24h")).not.toBeInTheDocument()
  })

  it("renders a tokened inline error with a Retry affordance on failure", async () => {
    mockConfig.mockRejectedValue(new Error("boom"))
    renderPage()

    expect(
      await screen.findByText("Couldn't load WhatsApp config")
    ).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument()
  })

  it("renders honest shape-gap notes for the Flows registry and conversation monitor", async () => {
    mockConfig.mockResolvedValue(CONFIG)
    renderPage()

    await waitFor(() => expect(mockConfig).toHaveBeenCalled())

    // Flows card is present but shows an honest note — NOT invented flow rows.
    expect(screen.getByText("Flows (E2E encrypted)")).toBeInTheDocument()
    expect(screen.queryByText("KYC verification")).not.toBeInTheDocument()
    expect(screen.queryByText("Itemized confirmation")).not.toBeInTheDocument()

    // Conversation monitor is present but shows an honest note — NOT invented bubbles.
    expect(screen.getByText("Live conversation monitor")).toBeInTheDocument()
    expect(screen.queryByText("I want to buy 50 USDT")).not.toBeInTheDocument()

    // The Flows panel explains WHY it is empty (no read endpoint); the monitor
    // points at the real transcript surface (Agent console → Conversations).
    expect(
      screen.getAllByText(/no .*read endpoint/i).length
    ).toBeGreaterThanOrEqual(1)
    const agentLink = screen.getByRole("link", {
      name: /agent config → conversations/i,
    })
    expect(agentLink).toHaveAttribute("href", "/agent")
  })
})
