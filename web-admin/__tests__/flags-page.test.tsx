/**
 * FlagsPage test — wired to real registry-backed flags.
 *
 * The flags that ARE registry keys resolve their effective state from GET
 * /admin/settings (mocked): `swap.enabled` ← `catalog.capabilities.crypto.swap`,
 * `ticketing.enabled` ← `ticketing.enabled`. Unbacked design flags keep their
 * design-faithful default. Clicking a switch opens the MakerCheckerModal (no flip
 * yet); approving toasts the intended new state (the real flip is Phase 7).
 * The api layer is mocked — no server.
 */
import { describe, expect, it, beforeEach, vi } from "vitest"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { EffectiveSetting } from "@handshake-agent/contracts"

import { FlagsPage } from "@/components/admin/flags-page"
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
    description: `Flag ${key}`,
    valueType: "boolean",
    editable: true,
    value,
    source: "default",
    scope: "global",
    scopeValue: null,
  }
}

// swap-capability is on; ticketing is off — the two registry-backed flags.
const SETTINGS: EffectiveSetting[] = [
  flag("catalog.capabilities.crypto.swap", true),
  flag("ticketing.enabled", false),
]

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <FlagsPage />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  defaultToastStore.setState({ toasts: [] })
  mockList.mockReset()
  mockList.mockResolvedValue(SETTINGS)
})

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("FlagsPage (wired to registry flags)", () => {
  it("resolves swap.enabled from its backing capability setting", async () => {
    renderPage()

    // swap.enabled is backed by catalog.capabilities.crypto.swap = true → on.
    const toggle = await screen.findByRole("switch", {
      name: /Disable swap\.enabled/i,
    })
    expect(toggle).toHaveAttribute("aria-checked", "true")
  })

  it("opens the modal on toggle and toasts the new state on approval", async () => {
    const user = userEvent.setup()
    renderPage()

    const toggle = await screen.findByRole("switch", {
      name: /Disable swap\.enabled/i,
    })

    // Clicking opens the maker-checker modal but does NOT flip yet (dual-control).
    await user.click(toggle)
    expect(toggle).toHaveAttribute("aria-checked", "true")
    const dialog = screen.getByRole("dialog")
    expect(
      within(dialog).getByText(/Disable swap\.enabled/i)
    ).toBeInTheDocument()

    // Approving toasts the flag + its intended new effective state.
    await user.click(
      within(dialog).getByRole("button", { name: /Submit for approval/i })
    )

    const { toasts } = defaultToastStore.getState()
    expect(toasts).toHaveLength(1)
    expect(toasts[0].message).toMatch(/swap\.enabled/)
    expect(toasts[0].message).toMatch(/off/)
  })

  it("leaves the row unchanged when the modal is cancelled", async () => {
    const user = userEvent.setup()
    renderPage()

    const toggle = await screen.findByRole("switch", {
      name: /Disable swap\.enabled/i,
    })
    await user.click(toggle)

    const dialog = screen.getByRole("dialog")
    await user.click(within(dialog).getByRole("button", { name: /Cancel/i }))

    // Still on; no toast fired.
    expect(
      screen.getByRole("switch", { name: /Disable swap\.enabled/i })
    ).toHaveAttribute("aria-checked", "true")
    expect(defaultToastStore.getState().toasts).toHaveLength(0)
  })

  it("shows the error branch with a retry when the settings read fails", async () => {
    mockList.mockRejectedValueOnce(new Error("boom"))
    renderPage()

    expect(await screen.findByText("Failed to load flags")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument()
  })
})
