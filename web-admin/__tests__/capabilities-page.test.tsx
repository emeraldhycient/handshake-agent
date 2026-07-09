/**
 * CapabilitiesPage test (design §6.25) — wired to real capability settings.
 *
 * The crypto capability rows' ENABLED/DISABLED state is resolved from the
 * `catalog.capabilities.crypto.*` boolean settings (GET /admin/settings, mocked).
 * The kill-switch is dual-control: clicking a switch never flips it directly — it
 * opens the shared MakerCheckerModal. Approving ("Confirm change") toasts the
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
  mockSet.mockReset()
  mockSet.mockResolvedValue(flag("catalog.capabilities.crypto.buy", false))
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

  it("persists the flip via setSetting (PATCH) when the maker-checker is approved", async () => {
    const user = userEvent.setup()
    renderPage()

    const toggle = await screen.findByRole("switch", { name: "crypto.buy" })
    await user.click(toggle)

    const dialog = screen.getByRole("dialog", { name: /Disable crypto.buy/ })
    await user.click(
      within(dialog).getByRole("button", { name: "Confirm change" })
    )

    // The real config-override PATCH fires with the toggled boolean + the setting's
    // scope; the buy row was ON, so the flip persists `false`.
    await waitFor(() => expect(mockSet).toHaveBeenCalledTimes(1))
    expect(mockSet).toHaveBeenCalledWith("catalog.capabilities.crypto.buy", {
      value: false,
      scope: "global",
      scopeValue: null,
    })
    // A feedback toast fired and the modal closed.
    expect(defaultToastStore.getState().toasts).toContainEqual(
      expect.objectContaining({ message: "crypto.buy disabled" })
    )
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it("does not persist until the maker-checker submit fires", async () => {
    const user = userEvent.setup()
    renderPage()

    const toggle = await screen.findByRole("switch", { name: "crypto.buy" })
    await user.click(toggle)
    // The dialog is open but nothing has been persisted yet.
    expect(
      screen.getByRole("dialog", { name: /Disable crypto.buy/ })
    ).toBeInTheDocument()
    expect(mockSet).not.toHaveBeenCalled()
  })

  it("opens the step-up dialog and retries the PATCH after re-auth when the server demands step-up", async () => {
    const user = userEvent.setup()
    const { ApiError } = await import("@/lib/api/client")
    mockSet
      .mockRejectedValueOnce(
        new ApiError("Step-up required", 403, "ADMIN_STEP_UP_REQUIRED")
      )
      .mockResolvedValueOnce(flag("catalog.capabilities.crypto.buy", false))

    renderPage()
    const toggle = await screen.findByRole("switch", { name: "crypto.buy" })
    await user.click(toggle)
    await user.click(
      within(
        screen.getByRole("dialog", { name: /Disable crypto.buy/ })
      ).getByRole("button", { name: "Confirm change" })
    )

    expect(await screen.findByText("Confirm it's you")).toBeInTheDocument()
    expect(mockSet).toHaveBeenCalledTimes(1)
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
