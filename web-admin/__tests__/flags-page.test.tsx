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
  mockSet.mockReset()
  mockSet.mockResolvedValue(flag("catalog.capabilities.crypto.swap", false))
  mockGetMe.mockReset()
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

  it("persists a registry-backed flip via setSetting (PATCH) on approval", async () => {
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
    // Nothing persisted until the maker-checker submit fires.
    expect(mockSet).not.toHaveBeenCalled()

    // Approving fires the real config-override PATCH against the BACKING key with the
    // toggled boolean (swap was ON → persists false), and toasts the new state.
    await user.click(
      within(dialog).getByRole("button", { name: /Submit for approval/i })
    )

    await waitFor(() => expect(mockSet).toHaveBeenCalledTimes(1))
    expect(mockSet).toHaveBeenCalledWith("catalog.capabilities.crypto.swap", {
      value: false,
      scope: "global",
      scopeValue: null,
    })
    const { toasts } = defaultToastStore.getState()
    expect(toasts).toHaveLength(1)
    expect(toasts[0].message).toMatch(/swap\.enabled/)
    expect(toasts[0].message).toMatch(/off/)
  })

  it("does not call setSetting for an UNBACKED flag (no registry key)", async () => {
    const user = userEvent.setup()
    renderPage()

    // voice_notes.web has no settingKey → its flip is an acknowledged intent only.
    const toggle = await screen.findByRole("switch", {
      name: /Disable voice_notes\.web/i,
    })
    await user.click(toggle)
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: /Submit for approval/i,
      })
    )

    expect(mockSet).not.toHaveBeenCalled()
    // A toast still acknowledges the (non-persisted) intent.
    expect(defaultToastStore.getState().toasts).toHaveLength(1)
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
