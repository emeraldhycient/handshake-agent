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

    // Clicking opens the confirm modal but does NOT flip yet.
    await user.click(toggle)
    expect(toggle).toHaveAttribute("aria-checked", "true")
    const dialog = screen.getByRole("dialog")
    expect(
      within(dialog).getByText(/Disable swap\.enabled/i)
    ).toBeInTheDocument()
    // HONEST copy: this surface applies immediately after step-up — it never
    // enters a pending-approval queue, so the modal must not claim it does.
    expect(
      within(dialog).getByText(/applies immediately/i)
    ).toBeInTheDocument()
    expect(
      within(dialog).queryByText(/pending approval/i)
    ).not.toBeInTheDocument()
    // Nothing persisted until the confirm fires.
    expect(mockSet).not.toHaveBeenCalled()

    // Confirming fires the real config-override PATCH against the BACKING key with
    // the toggled boolean (swap was ON → persists false), and toasts the new state.
    await user.click(
      within(dialog).getByRole("button", { name: /Confirm change/i })
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

  it("renders UNBACKED flags as read-only 'Not yet wired' rows (no switch, no fake toggle)", async () => {
    renderPage()

    await screen.findByRole("switch", { name: /Disable swap\.enabled/i })

    // voice_notes.web has no registry key → no switch to flip, no modal to open,
    // and no fabricated "eval → on" claim — an honest read-only pill instead.
    expect(
      screen.queryByRole("switch", { name: /voice_notes\.web/i })
    ).not.toBeInTheDocument()
    expect(screen.getByText("voice_notes.web")).toBeInTheDocument()
    // Four unbacked design flags → four read-only pills.
    expect(screen.getAllByText("Not yet wired")).toHaveLength(4)
    // Only the two registry-backed flags expose a switch.
    expect(screen.getAllByRole("switch")).toHaveLength(2)
    // No fake-success toast path exists for unbacked flags.
    expect(defaultToastStore.getState().toasts).toHaveLength(0)
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
