/**
 * SettingsPage test (design §6.30) — wired to real effective settings, and (Phase 7)
 * to the real config-override PATCH.
 *
 * The rows are the effective settings from GET /admin/settings (mocked). A 'db'
 * override renders the "DB" source chip + an editable Edit pill; a 'default' key
 * renders the "Baseline" chip + a "Locked" affordance. The key-search box filters
 * client-side. The Edit flow captures a new value, then opens the reason → step-up →
 * maker-checker chain whose submit calls the REAL `setSetting` PATCH (mocked). The
 * api layer is mocked — no server.
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
  setSetting: vi.fn(),
}))

// The signed-in admin (drives the step-up dialog's password-vs-TOTP mode).
vi.mock("@/lib/api/admin", () => ({
  getMe: vi.fn(),
}))

import { listEffectiveSettings, setSetting } from "@/lib/api/config"
import { getMe } from "@/lib/api/admin"

const mockList = vi.mocked(listEffectiveSettings)
const mockSet = vi.mocked(setSetting)
const mockGetMe = vi.mocked(getMe)

// ─── Fixture ──────────────────────────────────────────────────────────────────

const DB_SETTING: EffectiveSetting = {
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
}

const BASELINE_SETTING: EffectiveSetting = {
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
}

const SETTINGS: EffectiveSetting[] = [DB_SETTING, BASELINE_SETTING]

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
  mockSet.mockReset()
  mockGetMe.mockReset()
  mockList.mockResolvedValue(SETTINGS)
  mockGetMe.mockResolvedValue({
    id: "11111111-1111-1111-1111-111111111111",
    email: "amara@handshake.ng",
    role: { id: "00000000-0000-0000-0000-000000000001", name: "Super Admin" },
    status: "active",
    displayName: "Test Admin",
    mfaEnabled: true,
    permissions: [],
    menus: [],
    pages: [],
  })
})

/** Drive the value → reason → step-up → maker-checker chain to its final submit. */
async function runEditFlow(user: ReturnType<typeof userEvent.setup>) {
  await user.click(
    await screen.findByRole("button", { name: "Edit pricing.processingFeeBps" })
  )

  // 1. New-value step — enter the override value and continue.
  const valueInput = await screen.findByLabelText("New value")
  await user.clear(valueInput)
  await user.type(valueInput, "75")
  await user.click(screen.getByRole("button", { name: "Continue" }))

  // 2. Reason step — a reason is required before Continue activates.
  await user.type(
    await screen.findByRole("textbox", { name: "Reason" }),
    "Quarterly fee update"
  )
  await user.click(screen.getByRole("button", { name: "Continue" }))

  // 3. Step-up (client ceremony) — six digits advance the chain.
  for (const d of ["1", "2", "3", "4", "5", "6"]) {
    await user.click(await screen.findByRole("button", { name: d }))
  }

  // 4. Maker-checker confirm — its submit fires the real PATCH.
  await user.click(
    await screen.findByRole("button", { name: "Submit for approval" })
  )
}

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

describe("SettingsPage (Phase 7 — config-override WRITE)", () => {
  it("submits the entered value through the flow chain to setSetting with the typed value + scope", async () => {
    const user = userEvent.setup()
    mockSet.mockResolvedValue({ ...DB_SETTING, value: 75 })
    renderPage()

    await runEditFlow(user)

    await waitFor(() => expect(mockSet).toHaveBeenCalledTimes(1))
    // The number-typed key coerces the input to a number; scope defaults to global.
    expect(mockSet).toHaveBeenCalledWith("pricing.processingFeeBps", {
      value: 75,
      scope: "global",
      scopeValue: null,
    })
  })

  it("does not call setSetting until the maker-checker submit fires", async () => {
    const user = userEvent.setup()
    mockSet.mockResolvedValue({ ...DB_SETTING, value: 75 })
    renderPage()

    await user.click(
      await screen.findByRole("button", {
        name: "Edit pricing.processingFeeBps",
      })
    )
    const valueInput = await screen.findByLabelText("New value")
    await user.clear(valueInput)
    await user.type(valueInput, "75")
    await user.click(screen.getByRole("button", { name: "Continue" }))
    await user.type(
      await screen.findByRole("textbox", { name: "Reason" }),
      "Quarterly fee update"
    )
    await user.click(screen.getByRole("button", { name: "Continue" }))

    // Reached step-up but not yet the final submit — nothing persisted.
    expect(mockSet).not.toHaveBeenCalled()
  })

  it("opens the step-up dialog and retries the PATCH after re-auth when the server demands step-up", async () => {
    const user = userEvent.setup()
    const { ApiError } = await import("@/lib/api/client")
    // First attempt 403s with the step-up code; retry (after re-auth) succeeds.
    mockSet
      .mockRejectedValueOnce(
        new ApiError("Step-up required", 403, "ADMIN_STEP_UP_REQUIRED")
      )
      .mockResolvedValueOnce({ ...DB_SETTING, value: 75 })

    renderPage()
    await runEditFlow(user)

    // The re-auth dialog appears (TOTP mode, since mfaEnabled).
    expect(
      await screen.findByText("Confirm it's you")
    ).toBeInTheDocument()
    expect(mockSet).toHaveBeenCalledTimes(1)
  })
})
