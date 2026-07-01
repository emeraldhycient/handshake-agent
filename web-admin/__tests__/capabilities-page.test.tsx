/**
 * CapabilitiesPage test (design §6.25) — wired to real capability settings.
 *
 * The crypto capability rows' ENABLED/DISABLED state is resolved from the
 * `catalog.capabilities.crypto.*` boolean settings (GET /admin/settings, mocked).
 * The kill-switch is dual-control: clicking a switch never flips it directly — it
 * opens the shared MakerCheckerModal. Approving ("Submit for approval") toasts the
 * intended change (the real server-side flip + re-read is Phase 7). The api layer is
 * mocked — no server.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { EffectiveSetting } from "@handshake-agent/contracts"

import { CapabilitiesPage } from "@/components/admin/capabilities-page"
import { defaultToastStore } from "@/lib/store/toast-store"

// ─── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock("@/lib/api/config", () => ({
  listEffectiveSettings: vi.fn(),
}))

import { listEffectiveSettings } from "@/lib/api/config"

const mockList = vi.mocked(listEffectiveSettings)

// ─── Fixture ──────────────────────────────────────────────────────────────────

function flag(key: string, value: boolean): EffectiveSetting {
  return {
    key,
    category: "Catalog",
    label: key,
    description: `Capability ${key}`,
    valueType: "boolean",
    editable: true,
    value,
    source: "default",
    scope: "global",
    scopeValue: null,
  }
}

const CATALOG_SETTINGS: EffectiveSetting[] = [
  flag("catalog.capabilities.crypto.buy", true),
  flag("catalog.capabilities.crypto.sell", true),
  flag("catalog.capabilities.crypto.send", true),
  flag("catalog.capabilities.crypto.swap", false),
]

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <CapabilitiesPage />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  defaultToastStore.setState({ toasts: [] })
  mockList.mockReset()
  mockList.mockResolvedValue(CATALOG_SETTINGS)
})

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("CapabilitiesPage (wired dual-control kill-switch)", () => {
  it("renders switchboard rows from the real capability settings", async () => {
    renderPage()

    expect(
      screen.getByRole("heading", { name: "Capabilities / service registry" })
    ).toBeInTheDocument()

    // crypto.buy resolved from a true setting → an enabled switch.
    const buy = await screen.findByRole("switch", { name: "crypto.buy" })
    expect(buy).toHaveAttribute("aria-checked", "true")
    // swap resolved from a false setting → disabled.
    expect(screen.getByRole("switch", { name: "swap" })).toHaveAttribute(
      "aria-checked",
      "false"
    )
  })

  it("does not flip the switch on click — it opens the maker-checker modal", async () => {
    const user = userEvent.setup()
    renderPage()

    const toggle = await screen.findByRole("switch", { name: "crypto.buy" })
    await user.click(toggle)

    // Still enabled — the click only opened dual-control approval.
    expect(toggle).toHaveAttribute("aria-checked", "true")
    expect(
      screen.getByRole("dialog", { name: /Disable crypto.buy/ })
    ).toBeInTheDocument()
  })

  it("toasts the intended change after the modal is approved (Phase-7 write is a stub)", async () => {
    const user = userEvent.setup()
    renderPage()

    const toggle = await screen.findByRole("switch", { name: "crypto.buy" })
    await user.click(toggle)

    const dialog = screen.getByRole("dialog", { name: /Disable crypto.buy/ })
    await user.click(
      within(dialog).getByRole("button", { name: "Submit for approval" })
    )

    // A feedback toast fired and the modal closed.
    expect(defaultToastStore.getState().toasts).toContainEqual(
      expect.objectContaining({ message: "crypto.buy disabled" })
    )
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it("shows an error branch with a retry when the settings read fails", async () => {
    mockList.mockRejectedValueOnce(new Error("boom"))
    renderPage()

    expect(
      await screen.findByText("Failed to load capabilities")
    ).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument()
  })

  it("shows an empty branch when no capability keys are present", async () => {
    mockList.mockResolvedValueOnce([])
    renderPage()

    await waitFor(() =>
      expect(screen.getByText("No capabilities")).toBeInTheDocument()
    )
    expect(screen.queryByRole("switch")).not.toBeInTheDocument()
  })
})
