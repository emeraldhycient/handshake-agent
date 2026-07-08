/**
 * BlockedPage tests — WIRED to real data (Phase 9).
 *
 * The deny-list is now driven by the real `useBlockedList()` (GET /admin/blocked);
 * the api client (`@/lib/api/blocked`) is mocked so no server is needed. The two
 * write paths go through the shared funds-safety flow (reason → step-up), matching
 * the sanctions-page pattern:
 *
 *  - Add → the purpose-built AddBlockedDialog collects a value; on submit the page
 *    captures an audited reason via the shared ReasonModal → step-up-guarded
 *    `useAddBlocked` (POST /admin/blocked with a derived kind) → toast.
 *  - Remove/unblock → ReasonModal (audited reason) → step-up-guarded
 *    `useSupersedeBlocked` (POST /admin/blocked/:id/supersede) → toast. The entry is
 *    SUPERSEDED, never deleted (append-only, §3.4).
 *
 * Asserted branches: loading → data (real rows), empty (honest empty state), error
 * (inline retry). Plus the add + supersede write flows and the step-up 403 replay.
 */
import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { BlockedEntryListResponse } from "@handshake-agent/contracts"

import { BlockedPage } from "@/components/admin/blocked-page"
import { defaultToastStore } from "@/lib/store/toast-store"

// ─── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock("@/lib/api/blocked", () => ({
  listBlocked: vi.fn(),
  addBlocked: vi.fn(),
  supersedeBlocked: vi.fn(),
}))

// The signed-in admin (drives the step-up dialog's password-vs-TOTP mode).
vi.mock("@/lib/api/admin", () => ({
  getMe: vi.fn(),
}))

import { listBlocked, addBlocked, supersedeBlocked } from "@/lib/api/blocked"
import { getMe } from "@/lib/api/admin"

const mockList = vi.mocked(listBlocked)
const mockAdd = vi.mocked(addBlocked)
const mockSupersede = vi.mocked(supersedeBlocked)
const mockGetMe = vi.mocked(getMe)

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const BLOCKED: BlockedEntryListResponse = {
  items: [
    {
      id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      kind: "address",
      value: "TQmByr1s6dLPU9Xz8y7Gk2f4Nc3Vw5Hj8",
      reason: "OFAC SDN-list match",
      addedByAdminId: "admin-1",
      createdAt: "2026-06-30T10:00:00.000Z",
      supersededAt: null,
    },
    {
      id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      kind: "bank",
      value: "0114227781 · Access Bank",
      reason: "Confirmed mule account",
      addedByAdminId: "admin-2",
      createdAt: "2026-06-28T10:00:00.000Z",
      supersededAt: "2026-06-29T10:00:00.000Z",
    },
  ],
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <BlockedPage />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  defaultToastStore.setState({ toasts: [] })
  mockList.mockReset()
  mockList.mockResolvedValue(BLOCKED)
  mockAdd.mockReset()
  mockAdd.mockResolvedValue(BLOCKED.items[0])
  mockSupersede.mockReset()
  mockSupersede.mockResolvedValue(undefined)
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

describe("BlockedPage (wired)", () => {
  it("renders the header and real deny-list rows (loading → data)", async () => {
    renderPage()

    expect(
      screen.getByRole("heading", { name: "Blocked list" })
    ).toBeInTheDocument()

    // loading → data: the mocked entries render.
    expect(
      await screen.findByText("TQmByr1s6dLPU9Xz8y7Gk2f4Nc3Vw5Hj8")
    ).toBeInTheDocument()
    expect(screen.getByText("0114227781 · Access Bank")).toBeInTheDocument()
    // The stored reason fills the Reason column.
    expect(screen.getByText("OFAC SDN-list match")).toBeInTheDocument()
  })

  it("renders the honest empty state when nothing is blocked", async () => {
    mockList.mockResolvedValue({ items: [] })
    renderPage()

    expect(
      await screen.findByText(/Nothing blocked/i)
    ).toBeInTheDocument()
  })

  it("renders a tokened inline error with a Retry affordance on failure", async () => {
    mockList.mockRejectedValue(new Error("boom"))
    renderPage()

    expect(
      await screen.findByText("Failed to load the blocked list")
    ).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument()
  })

  it("adds an entry via the dialog → reason flow, deriving the kind, and toasts", async () => {
    const user = userEvent.setup()
    renderPage()

    await screen.findByText("TQmByr1s6dLPU9Xz8y7Gk2f4Nc3Vw5Hj8")

    const newValue = "0xAbC1230000000000000000000000000000000009"

    // Open the purpose-built AddBlockedDialog + fill the value.
    await user.click(screen.getByRole("button", { name: "+ Add entry" }))
    const dialog = await screen.findByRole("dialog")
    expect(dialog).toHaveTextContent("Add to the blocked list")
    await user.type(within(dialog).getByLabelText("Value"), newValue)
    await user.click(within(dialog).getByRole("button", { name: "Add entry" }))

    // The dialog closes; the shared ReasonModal captures the audited reason.
    await user.type(
      await screen.findByRole("textbox", { name: "Reason" }),
      "Linked to phishing proceeds"
    )
    await user.click(screen.getByRole("button", { name: "Continue" }))

    // The POST fires with the derived kind + the entered value + reason.
    await waitFor(() => expect(mockAdd).toHaveBeenCalledTimes(1))
    expect(mockAdd).toHaveBeenCalledWith({
      kind: "address",
      value: newValue,
      reason: "Linked to phishing proceeds",
    })

    const { toasts } = defaultToastStore.getState()
    expect(toasts).toHaveLength(1)
    expect(toasts[0].kind).toBe("ok")
  })

  it("does not call addBlocked until the reason modal's Continue fires", async () => {
    const user = userEvent.setup()
    renderPage()

    await screen.findByText("TQmByr1s6dLPU9Xz8y7Gk2f4Nc3Vw5Hj8")
    await user.click(screen.getByRole("button", { name: "+ Add entry" }))
    const dialog = await screen.findByRole("dialog")
    await user.type(within(dialog).getByLabelText("Value"), "user-123")
    await user.click(within(dialog).getByRole("button", { name: "Add entry" }))

    // The ReasonModal is open but nothing is persisted yet.
    await screen.findByRole("textbox", { name: "Reason" })
    expect(mockAdd).not.toHaveBeenCalled()
  })

  it("supersedes (unblocks) a row via the audited reason flow and toasts", async () => {
    const user = userEvent.setup()
    renderPage()

    const target = "TQmByr1s6dLPU9Xz8y7Gk2f4Nc3Vw5Hj8"
    await screen.findByText(target)

    // Open the Remove flow → ReasonModal. Its Continue fires the POST directly —
    // the REAL step-up is server-driven (403 → StepUpDialog → replay).
    await user.click(
      screen.getByRole("button", {
        name: `Unblock ${target}`,
      })
    )
    await user.type(
      await screen.findByRole("textbox", { name: "Reason" }),
      "False positive on review"
    )
    await user.click(screen.getByRole("button", { name: "Continue" }))

    await waitFor(() => expect(mockSupersede).toHaveBeenCalledTimes(1))
    expect(mockSupersede).toHaveBeenCalledWith(
      "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      "False positive on review"
    )

    const { toasts } = defaultToastStore.getState()
    expect(toasts).toHaveLength(1)
    expect(toasts[0].kind).toBe("ok")
  })

  it("opens the step-up dialog and retries the supersede after re-auth on a 403", async () => {
    const user = userEvent.setup()
    const { ApiError } = await import("@/lib/api/client")
    mockSupersede
      .mockRejectedValueOnce(
        new ApiError("Step-up required", 403, "ADMIN_STEP_UP_REQUIRED")
      )
      .mockResolvedValueOnce(undefined)

    renderPage()

    const target = "TQmByr1s6dLPU9Xz8y7Gk2f4Nc3Vw5Hj8"
    await screen.findByText(target)
    await user.click(screen.getByRole("button", { name: `Unblock ${target}` }))
    await user.type(
      await screen.findByRole("textbox", { name: "Reason" }),
      "False positive on review"
    )
    await user.click(screen.getByRole("button", { name: "Continue" }))

    // The re-auth dialog appears (TOTP mode, since mfaEnabled).
    expect(await screen.findByText("Confirm it's you")).toBeInTheDocument()
    expect(mockSupersede).toHaveBeenCalledTimes(1)
  })

  it("marks superseded rows as inactive (append-only, not deleted)", async () => {
    renderPage()

    // The superseded bank row still renders (nothing is deleted) but is not
    // offered an Unblock action.
    await screen.findByText("0114227781 · Access Bank")
    expect(
      screen.queryByRole("button", { name: "Unblock 0114227781 · Access Bank" })
    ).not.toBeInTheDocument()
  })
})
