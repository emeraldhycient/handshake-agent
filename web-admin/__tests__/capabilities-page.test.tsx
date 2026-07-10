/**
 * CapabilitiesPage test (design §6.25) — wired to real capability settings, raised as a
 * four-eyes ChangeRequest (Wave I).
 *
 * The crypto capability rows' ENABLED/DISABLED state is resolved from the
 * `catalog.capabilities.crypto.*` boolean settings (GET /admin/settings, mocked).
 * The kill-switch is dual-control: clicking a switch never flips it directly — it opens
 * the reason step, then the shared MakerCheckerModal (dual-control copy). Submitting
 * RAISES a `capability_flip` ChangeRequest (createChange) for a SECOND admin to approve —
 * it does NOT write the setting directly. The api layer is mocked — no server.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ChangeRequest, EffectiveSetting } from "@handshake-agent/contracts"

import { CapabilitiesPage } from "@/components/admin/capabilities-page"
import { defaultToastStore } from "@/lib/store/toast-store"

// ─── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock("@/lib/api/config", () => ({
  listEffectiveSettings: vi.fn(),
  setSetting: vi.fn(),
}))

// The four-eyes maker-checker raise (POST /admin/approvals).
vi.mock("@/lib/api/approvals", () => ({
  createChange: vi.fn(),
}))

// The signed-in admin (drives the step-up dialog's password-vs-TOTP mode).
vi.mock("@/lib/api/admin", () => ({
  getMe: vi.fn(),
}))

import { listEffectiveSettings, setSetting } from "@/lib/api/config"
import { createChange } from "@/lib/api/approvals"
import { getMe } from "@/lib/api/admin"

const mockList = vi.mocked(listEffectiveSettings)
const mockSet = vi.mocked(setSetting)
const mockCreate = vi.mocked(createChange)
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

/** A pending ChangeRequest the mocked createChange resolves with (bypasses parse). */
const PENDING_CHANGE: ChangeRequest = {
  id: "22222222-2222-2222-2222-222222222222",
  kind: "capability_flip",
  resource: "catalog.capabilities.crypto.buy",
  payload: {},
  status: "pending",
  reason: "Kill switch",
  requestedByAdminId: "11111111-1111-1111-1111-111111111111",
  requestedByEmail: "amara@handshake.ng",
  decidedByAdminId: null,
  decidedByEmail: null,
  decisionReason: null,
  decidedAt: null,
  createdAt: "2026-07-09T00:00:00.000Z",
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

/** Click the capability switch, then walk the reason → dual-control submit chain. */
async function flipThroughApproval(
  user: ReturnType<typeof userEvent.setup>,
  switchName: string,
  reason = "Kill switch"
) {
  await user.click(await screen.findByRole("switch", { name: switchName }))
  await user.type(screen.getByRole("textbox", { name: "Reason" }), reason)
  await user.click(screen.getByRole("button", { name: "Continue" }))
  await user.click(screen.getByRole("button", { name: "Submit for approval" }))
}

beforeEach(() => {
  defaultToastStore.setState({ toasts: [] })
  mockList.mockReset()
  mockList.mockResolvedValue(CATALOG_SETTINGS)
  mockSet.mockReset()
  mockSet.mockResolvedValue(flag("catalog.capabilities.crypto.buy", false))
  mockCreate.mockReset()
  mockCreate.mockResolvedValue(PENDING_CHANGE)
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

describe("CapabilitiesPage (four-eyes capability_flip)", () => {
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

  it("does not flip the switch on click — it opens the reason step first", async () => {
    const user = userEvent.setup()
    renderPage()

    const toggle = await screen.findByRole("switch", { name: "crypto.buy" })
    await user.click(toggle)

    // Still enabled — the click only opened the reason capture (not a direct flip).
    expect(toggle).toHaveAttribute("aria-checked", "true")
    expect(screen.getByRole("textbox", { name: "Reason" })).toBeInTheDocument()
    expect(mockCreate).not.toHaveBeenCalled()
    expect(mockSet).not.toHaveBeenCalled()
  })

  it("raises a capability_flip ChangeRequest (not a direct setSetting) when submitted", async () => {
    const user = userEvent.setup()
    renderPage()

    await flipThroughApproval(user, "crypto.buy")

    // A four-eyes change request is raised; crypto.buy was ON, so the payload flips
    // it OFF, mirroring the setSetting body 1:1 inside the payload, with the reason.
    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1))
    expect(mockCreate).toHaveBeenCalledWith({
      kind: "capability_flip",
      resource: "catalog.capabilities.crypto.buy",
      payload: {
        key: "catalog.capabilities.crypto.buy",
        value: false,
        scope: "global",
        scopeValue: null,
      },
      reason: "Kill switch",
    })
    // Nothing is written directly — no optimistic settings mutation fires.
    expect(mockSet).not.toHaveBeenCalled()
    // The copy says submitted-for-approval and the modal closed.
    expect(defaultToastStore.getState().toasts).toContainEqual(
      expect.objectContaining({ message: "Submitted for approval" })
    )
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it("raises an ENABLE flip for a disabled capability", async () => {
    const user = userEvent.setup()
    renderPage()

    // swap is OFF → the flip enables it (value: true).
    await flipThroughApproval(user, "swap", "Enable swap")

    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1))
    expect(mockCreate).toHaveBeenCalledWith({
      kind: "capability_flip",
      resource: "catalog.capabilities.crypto.swap",
      payload: {
        key: "catalog.capabilities.crypto.swap",
        value: true,
        scope: "global",
        scopeValue: null,
      },
      reason: "Enable swap",
    })
  })

  it("rejects a reason shorter than 3 chars — no change request is raised", async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByRole("switch", { name: "crypto.buy" }))
    await user.type(screen.getByRole("textbox", { name: "Reason" }), "no")
    const continueBtn = screen.getByRole("button", { name: "Continue" })
    expect(continueBtn).toBeDisabled()
    await user.click(continueBtn)

    expect(
      screen.queryByRole("button", { name: "Submit for approval" })
    ).not.toBeInTheDocument()
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it("does not raise until the maker-checker submit fires", async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByRole("switch", { name: "crypto.buy" }))
    await user.type(screen.getByRole("textbox", { name: "Reason" }), "Kill switch")
    await user.click(screen.getByRole("button", { name: "Continue" }))
    // The dual-control confirm is up but nothing has been raised yet.
    expect(
      screen.getByRole("button", { name: "Submit for approval" })
    ).toBeInTheDocument()
    expect(mockCreate).not.toHaveBeenCalled()
    expect(mockSet).not.toHaveBeenCalled()
  })

  it("opens the step-up dialog and retries the raise after re-auth when the server demands step-up", async () => {
    const user = userEvent.setup()
    const { ApiError } = await import("@/lib/api/client")
    mockCreate
      .mockRejectedValueOnce(
        new ApiError("Step-up required", 403, "ADMIN_STEP_UP_REQUIRED")
      )
      .mockResolvedValueOnce(PENDING_CHANGE)

    renderPage()
    await flipThroughApproval(user, "crypto.buy")

    expect(await screen.findByText("Confirm it's you")).toBeInTheDocument()
    expect(mockCreate).toHaveBeenCalledTimes(1)
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
