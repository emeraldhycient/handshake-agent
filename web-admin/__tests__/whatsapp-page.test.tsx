/**
 * WhatsAppPage test (design §6.20).
 *
 * The "Number & webhook health" card is WIRED to `useWhatsAppConfig()`
 * (GET /admin/whatsapp/config): the non-secret Cloud-API / Flows wiring ids +
 * secret-PRESENCE booleans come from the real config view. Secret VALUES never
 * cross the boundary (root CLAUDE.md §3.5) — presence rows read only "Set" /
 * "Not set". The api layer is mocked; no server.
 *
 * The Flows registry, live conversation monitor and operational-health signals
 * (quality rating, messaging limit, webhook status, template rejections) have no
 * read endpoint yet and remain design-representative constants (shapeGaps).
 *
 * Tests:
 *  1. loading → data: skeletons first, then the real wiring ids + secret-presence
 *     labels resolve; never a plaintext secret; the Cloud-API note is shown.
 *  2. error: a tokened inline error with a Retry affordance renders on failure.
 *  3. The (mock) Flows card + redacted conversation monitor still render.
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

  it("renders a tokened inline error with a Retry affordance on failure", async () => {
    mockConfig.mockRejectedValue(new Error("boom"))
    renderPage()

    expect(
      await screen.findByText("Couldn't load WhatsApp config")
    ).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument()
  })

  it("renders the (mock) Flows registry and redacted conversation monitor", async () => {
    mockConfig.mockResolvedValue(CONFIG)
    renderPage()

    // Wait for the wired card to settle so no act() warnings leak.
    await waitFor(() => expect(mockConfig).toHaveBeenCalled())

    expect(screen.getByText("Flows (E2E encrypted)")).toBeInTheDocument()
    expect(screen.getByText("KYC verification")).toBeInTheDocument()
    // All three E2E flows read "Live".
    expect(screen.getAllByText("Live").length).toBeGreaterThanOrEqual(3)

    // The read-only conversation monitor renders (design-faithful sample).
    expect(screen.getByText("Live conversation monitor")).toBeInTheDocument()
    expect(screen.getByText("read-only · redacted")).toBeInTheDocument()
  })
})
