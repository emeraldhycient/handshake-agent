/**
 * AuditPage tests — the wired (real-data) audit-log viewer.
 *
 * The api layer (`@/lib/api/admin`) is mocked so no server is needed. We assert:
 *   1. loading → data: skeletons give way to rows from a mock AuditLogListResponse
 *      (actor, action chip, subject/target), and the hash-chain pill turns
 *      "verified" from a mock verify result.
 *   2. empty: an empty `items` array renders the design-consistent empty state.
 *   3. error: a rejected list query renders the tokened inline error + Retry.
 */
import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type {
  AuditChainVerifyResponse,
  AuditLogListResponse,
} from "@handshake-agent/contracts"

import { AuditPage } from "@/components/admin/audit-page"

// ─── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock("@/lib/api/admin", () => ({
  listAudit: vi.fn(),
  verifyAuditChain: vi.fn(),
}))

import { listAudit, verifyAuditChain } from "@/lib/api/admin"

const mockList = vi.mocked(listAudit)
const mockVerify = vi.mocked(verifyAuditChain)

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const LIST: AuditLogListResponse = {
  items: [
    {
      id: "11111111-1111-1111-1111-111111111111",
      correlationId: "corr-1",
      actor: "Amara Okeke",
      actorAdminId: "22222222-2222-2222-2222-222222222222",
      actorUserId: null,
      subject: "AppSetting: reconciliation.cron.enabled",
      action: "config_change",
      details: { reason: "Enable nightly reconciliation" },
      before: false,
      after: true,
      currentHash: "hash-b",
      prevHash: "hash-a",
      createdAt: "2026-07-01T08:42:10.000Z",
    },
    {
      id: "33333333-3333-3333-3333-333333333333",
      correlationId: "corr-2",
      actor: "Ifeoma Bello",
      actorAdminId: "44444444-4444-4444-4444-444444444444",
      actorUserId: null,
      subject: "usr_10501",
      action: "kyc_state_change",
      details: {},
      before: "pending",
      after: "verified",
      currentHash: "hash-c",
      prevHash: "hash-b",
      createdAt: "2026-07-01T08:20:55.000Z",
    },
  ],
  nextCursor: null,
}

const VERIFIED: AuditChainVerifyResponse = {
  ok: true,
  checked: 2,
  brokenAt: null,
}

function renderAudit() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <AuditPage />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  mockList.mockReset()
  mockVerify.mockReset()
  mockList.mockResolvedValue(LIST)
  mockVerify.mockResolvedValue(VERIFIED)
})

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("AuditPage", () => {
  it("renders real audit rows and a verified hash-chain pill (loading → data)", async () => {
    renderAudit()

    // A real row's actor + subject + action chip appear from the mocked list.
    expect(await screen.findByText("Amara Okeke")).toBeInTheDocument()
    expect(
      screen.getByText("AppSetting: reconciliation.cron.enabled")
    ).toBeInTheDocument()
    // The action renders as a mono chip in the row (SPAN) — the same string
    // also appears as an <option> in the action filter, so scope to the chip.
    const chips = screen
      .getAllByText("config_change")
      .filter((el) => el.tagName === "SPAN")
    expect(chips.length).toBeGreaterThanOrEqual(1)
    // The details.reason surfaces in the Reason column.
    expect(
      screen.getByText("Enable nightly reconciliation")
    ).toBeInTheDocument()
    // The on-mount verify resolves ok → the "verified" pill.
    expect(await screen.findByText("Hash-chain verified")).toBeInTheDocument()
    expect(mockList).toHaveBeenCalled()
  })

  it("renders the empty state when there are no entries", async () => {
    mockList.mockResolvedValue({ items: [], nextCursor: null })
    renderAudit()

    expect(
      await screen.findByText("No audit entries match these filters")
    ).toBeInTheDocument()
  })

  it("renders a tokened error with a Retry affordance when the list fails", async () => {
    mockList.mockRejectedValue(new Error("boom"))
    renderAudit()

    expect(
      await screen.findByText("Failed to load the audit log")
    ).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument()
    )
  })

  it("still toasts the CSV export confirmation when Export is clicked", async () => {
    const { defaultToastStore } = await import("@/lib/store/toast-store")
    const userEvent = (await import("@testing-library/user-event")).default
    defaultToastStore.setState({ toasts: [] })
    const user = userEvent.setup()
    renderAudit()

    await screen.findByText("Amara Okeke")
    await user.click(screen.getByRole("button", { name: /Export/i }))

    const { toasts } = defaultToastStore.getState()
    expect(toasts).toHaveLength(1)
    expect(toasts[0].message).toBe("Exporting audit log to CSV…")
    expect(toasts[0].kind).toBe("info")
  })
})
