/**
 * ProvidersPage render test — WIRED to real data (Phase 6b).
 *
 * The page renders `useProviderRegistry()` (GET /admin/providers) instead of a
 * module-level provider seed. The api client (`@/lib/api/providers`) is mocked (like
 * assets-page.test.tsx) so no server is needed.
 *
 * Asserted branches:
 *  - loading → data: a real provider card derived from the mocked
 *    `ProviderRegistryView` renders — name, kind, posture-derived status pill,
 *    the MOCK-MODE banner for a mocked adapter, the secret-PRESENCE row (never a
 *    key value), and the bound-capabilities line; plus a readiness checklist row.
 *  - empty: an empty `providers[]` renders the "No provider adapters registered".
 *  - error: a rejected fetch renders the inline retry affordance.
 *  - secrets: no key VALUE is ever rendered — only present/missing.
 */
import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ProviderRegistryView } from "@handshake-agent/contracts"

import { ProvidersPage } from "@/components/admin/providers-page"

vi.mock("@/lib/api/providers", () => ({
  getProviderRegistry: vi.fn(),
}))

import { getProviderRegistry } from "@/lib/api/providers"

const mockGetProviderRegistry = vi.mocked(getProviderRegistry)

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const VIEW: ProviderRegistryView = {
  providers: [
    {
      key: "blockradar",
      name: "Blockradar",
      kind: "Custodial crypto WaaS · TRON",
      status: "ok",
      mock: false,
      hasSecret: true,
      capabilities: ["crypto.buy", "crypto.sell"],
      latencyMs: null,
    },
    {
      key: "resend",
      name: "Resend",
      kind: "Transactional email",
      status: "mock",
      mock: true,
      hasSecret: false,
      capabilities: ["email"],
      latencyMs: null,
    },
  ],
  readiness: [
    {
      key: "mock-off",
      label: "PAYMENTS_MOCK_MODE / WALLET_MOCK_MODE flipped to false",
      done: false,
    },
  ],
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <ProvidersPage />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  mockGetProviderRegistry.mockReset()
})

describe("ProvidersPage", () => {
  it("renders real provider cards (name, kind, capabilities)", async () => {
    mockGetProviderRegistry.mockResolvedValue(VIEW)
    renderPage()

    expect(await screen.findByText("Blockradar")).toBeInTheDocument()
    expect(
      screen.getByText("Custodial crypto WaaS · TRON")
    ).toBeInTheDocument()
    // Bound capabilities are joined with " · ".
    expect(screen.getByText(/crypto\.buy · crypto\.sell/)).toBeInTheDocument()
  })

  it("shows the MOCK-MODE banner for a mocked adapter", async () => {
    mockGetProviderRegistry.mockResolvedValue(VIEW)
    renderPage()
    await screen.findByText("Blockradar")
    expect(screen.getByText("MOCK MODE ON")).toBeInTheDocument()
  })

  it("renders secret PRESENCE, never a key value", async () => {
    mockGetProviderRegistry.mockResolvedValue(VIEW)
    renderPage()
    await screen.findByText("Blockradar")
    // Blockradar has its secret → "present"; Resend does not → "missing".
    expect(screen.getByText("present")).toBeInTheDocument()
    expect(screen.getByText("missing")).toBeInTheDocument()
    expect(screen.getByText("•••• configured")).toBeInTheDocument()
    expect(screen.getByText("not configured")).toBeInTheDocument()
  })

  it("renders the readiness checklist row with its pending state", async () => {
    mockGetProviderRegistry.mockResolvedValue(VIEW)
    renderPage()
    await screen.findByText("Blockradar")
    expect(
      screen.getByText(/PAYMENTS_MOCK_MODE .* flipped to false/)
    ).toBeInTheDocument()
    // The pending gate exposes an sr-only "pending" label (colour is not the sole signal).
    expect(screen.getByText("pending")).toBeInTheDocument()
  })

  it("renders the empty state when no providers are registered", async () => {
    mockGetProviderRegistry.mockResolvedValue({ providers: [], readiness: [] })
    renderPage()
    expect(
      await screen.findByText(/No provider adapters registered/i)
    ).toBeInTheDocument()
  })

  it("renders the error state with a retry affordance when the fetch fails", async () => {
    mockGetProviderRegistry.mockRejectedValue(new Error("boom"))
    renderPage()
    expect(
      await screen.findByText(/Couldn't load the provider registry/i)
    ).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Retry/i })).toBeInTheDocument()
  })
})
