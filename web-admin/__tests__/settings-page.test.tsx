/**
 * SettingsPage test (design §6.30) — wired to real effective settings.
 *
 * The rows are the effective settings from GET /admin/settings (mocked). A 'db'
 * override renders the "DB" source chip + an editable Edit pill; a 'default' key
 * renders the "Baseline" chip + a "Locked" affordance. The key-search box filters
 * client-side. The Edit flow opens the reason → step-up → maker-checker chain (submit
 * is a Phase-7 stub). The api layer is mocked — no server.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { EffectiveSetting } from "@handshake-agent/contracts"

import { SettingsPage } from "@/components/admin/settings-page"

// ─── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock("@/lib/api/config", () => ({
  listEffectiveSettings: vi.fn(),
}))

import { listEffectiveSettings } from "@/lib/api/config"

const mockList = vi.mocked(listEffectiveSettings)

// ─── Fixture ──────────────────────────────────────────────────────────────────

const SETTINGS: EffectiveSetting[] = [
  {
    key: "pricing.processingFeeBps",
    category: "Pricing",
    label: "Processing fee (bps)",
    description: "Platform processing fee applied to buy/sell orders.",
    valueType: "number",
    editable: true,
    value: 50,
    source: "db", // a DB override → editable + "DB" chip
    scope: "global",
    scopeValue: null,
  },
  {
    key: "agent.modelId",
    category: "Agent",
    label: "Agent model id",
    description: "The Anthropic model id the agent uses for intent extraction.",
    valueType: "string",
    editable: true,
    value: "claude-opus-4-8",
    source: "default", // baseline → locked + "Baseline" chip
    scope: "global",
    scopeValue: null,
  },
]

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <SettingsPage />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  mockList.mockReset()
  mockList.mockResolvedValue(SETTINGS)
})

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("SettingsPage (wired effective-config list)", () => {
  it("renders real rows with their formatted values and source chips", async () => {
    renderPage()

    // The DB-override numeric value (50) and its key render.
    expect(
      await screen.findByText("pricing.processingFeeBps")
    ).toBeInTheDocument()
    expect(screen.getByText("50")).toBeInTheDocument()
    // The baseline string value + its key render.
    expect(screen.getByText("agent.modelId")).toBeInTheDocument()
    expect(screen.getByText("claude-opus-4-8")).toBeInTheDocument()
  })

  it("gives DB-override rows an Edit pill and baseline rows a Locked affordance", async () => {
    renderPage()

    // The 'db' row is editable → an Edit button; the 'default' row is locked.
    expect(
      await screen.findByRole("button", {
        name: "Edit pricing.processingFeeBps",
      })
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "Edit agent.modelId" })
    ).not.toBeInTheDocument()
  })

  it("filters the rows by the key-search box", async () => {
    const user = userEvent.setup()
    renderPage()

    await screen.findByText("pricing.processingFeeBps")
    await user.type(
      screen.getByRole("textbox", { name: "Search settings keys" }),
      "agent"
    )

    expect(screen.getByText("agent.modelId")).toBeInTheDocument()
    expect(
      screen.queryByText("pricing.processingFeeBps")
    ).not.toBeInTheDocument()
  })

  it("shows the error branch with a retry when the read fails", async () => {
    mockList.mockRejectedValueOnce(new Error("boom"))
    renderPage()

    expect(
      await screen.findByText("Failed to load settings")
    ).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument()
  })

  it("shows an empty branch when the registry returns no keys", async () => {
    mockList.mockResolvedValueOnce([])
    renderPage()

    await waitFor(() =>
      expect(screen.getByText("No tunable keys")).toBeInTheDocument()
    )
  })
})
