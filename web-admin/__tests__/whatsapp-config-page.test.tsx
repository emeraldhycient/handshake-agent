/**
 * WhatsAppConfigPage test.
 *
 *  3. The config card renders the non-secret wiring + "secret set" badges, and
 *     never renders a secret VALUE (the boundary only carries presence flags).
 *
 * The api layer is mocked — no server.
 */
import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { WhatsAppConfigView } from "@handshake-agent/contracts"

import { WhatsAppConfigPage } from "@/components/admin/whatsapp-config-page"

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
  phoneNumberId: "1234567890",
  flowId: "flow-aaa",
  beneficiaryFlowId: "flow-bbb",
  wabaId: "waba-ccc",
  appId: "app-ddd",
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
      <WhatsAppConfigPage />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  mockConfig.mockReset()
  mockConfig.mockResolvedValue(CONFIG)
})

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("WhatsAppConfigPage", () => {
  it("shows secret-set badges and never a secret value", async () => {
    renderPage()

    // Non-secret wiring is shown.
    expect(await screen.findByText("v21.0")).toBeInTheDocument()
    expect(screen.getByText("1234567890")).toBeInTheDocument()

    // Presence badges reflect the booleans.
    expect(screen.getByText("App secret: set")).toBeInTheDocument()
    expect(screen.getByText("Flow private key: set")).toBeInTheDocument()
    expect(screen.getByText("Verify token: not set")).toBeInTheDocument()

    // No secret value appears: only the presence booleans cross the boundary,
    // and the rendered DOM must contain neither "true" nor "false" verbatim as
    // a value for the secret flags.
    expect(screen.queryByText("true")).not.toBeInTheDocument()
    expect(screen.queryByText("false")).not.toBeInTheDocument()
  })
})
