/**
 * KycReviewPage tests — the KYC review queue wired to the real admin backend
 * (`useKycQueue(status)` → GET /admin/kyc/queue?status=…). Each design tab maps
 * onto a KYC-status bucket, queried independently.
 *
 *  1. loading → data: shows a busy skeleton, then renders one applicant row per
 *     queue item, showing the enriched display name, requested-tier chip, and the
 *     formatted SLA age. The Pending tab count reflects its bucket's item count.
 *  2. per-tab counts: each tab's badge reflects its own bucket's real count.
 *  3. tab switch: selecting Approved shows that bucket's rows (its own query).
 *  4. empty: an empty bucket shows the design's "Nothing in this bucket." copy.
 *  5. error: a failed active-tab query surfaces the tokened inline error + Retry.
 *  6. row click deep-links to the applicant's user-detail KYC tab.
 *
 * The api layer is mocked — no server. `next/navigation` is stubbed for routing.
 */
import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { KycQueueItem, KycQueueResponse } from "@handshake-agent/contracts"

import { KycReviewPage } from "@/components/admin/kyc-review-page"

// ─── Mocks ──────────────────────────────────────────────────────────────────────

const push = vi.fn()
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}))

vi.mock("@/lib/api/kyc", () => ({
  listKycQueue: vi.fn(),
}))

import { listKycQueue } from "@/lib/api/kyc"

const mockQueue = vi.mocked(listKycQueue)

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function item(over: Partial<KycQueueItem> & Pick<KycQueueItem, "userId">): KycQueueItem {
  return {
    email: "user@example.com",
    displayName: null,
    requestedTier: null,
    status: "pending_review",
    submittedAt: "2026-06-30T10:00:00.000Z",
    slaAgeSeconds: 0,
    ...over,
  }
}

const PENDING: KycQueueResponse = {
  items: [
    item({
      userId: "11111111-1111-1111-1111-111111111111",
      email: "amara.okeke@example.com",
      displayName: "Amara Okeke",
      requestedTier: "tier_2",
      slaAgeSeconds: 7200, // 2h
    }),
    item({
      userId: "22222222-2222-2222-2222-222222222222",
      email: "chidi.adeyemi@example.com",
      displayName: "Chidi Adeyemi",
      requestedTier: "tier_1",
      slaAgeSeconds: 100_800, // 1d 4h
    }),
  ],
  nextCursor: null,
}

const APPROVED: KycQueueResponse = {
  items: [
    item({
      userId: "33333333-3333-3333-3333-333333333333",
      email: "ngozi.eze@example.com",
      displayName: "Ngozi Eze",
      requestedTier: "tier_3",
      status: "verified",
      slaAgeSeconds: 300,
    }),
  ],
  nextCursor: null,
}

/** Route the mock by the requested status so each tab resolves its own bucket. */
function routeByStatus(map: Record<string, KycQueueResponse>) {
  mockQueue.mockImplementation((query = {}) => {
    const status = query.status ?? "pending_review"
    return Promise.resolve(map[status] ?? { items: [], nextCursor: null })
  })
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <KycReviewPage />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  mockQueue.mockReset()
  push.mockReset()
})

// ─── Tests ──────────────────────────────────────────────────────────────────────

describe("KycReviewPage", () => {
  it("renders enriched rows (name, tier chip, SLA age) and the Pending count", async () => {
    routeByStatus({ pending_review: PENDING, verified: APPROVED })
    const { container } = renderPage()

    // Loading branch: the skeleton block is marked busy before data arrives.
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull()

    // Data branch: the display name (not the email) is the row name.
    expect(await screen.findByText("Amara Okeke")).toBeInTheDocument()
    expect(screen.getByText("Chidi Adeyemi")).toBeInTheDocument()

    // Requested-tier chip + formatted SLA age render.
    expect(screen.getByText("Tier 2")).toBeInTheDocument()
    expect(screen.getByText("2h")).toBeInTheDocument()
    expect(screen.getByText("1d 4h")).toBeInTheDocument()

    // The Pending tab count badge reflects the two returned items.
    const pendingTab = screen.getByRole("tab", { name: /Pending/ })
    expect(pendingTab).toHaveTextContent("2")

    // The queue was queried per status bucket (pending_review among them).
    await waitFor(() =>
      expect(mockQueue).toHaveBeenCalledWith({ status: "pending_review" })
    )
  })

  it("shows a real count for every tab bucket", async () => {
    routeByStatus({ pending_review: PENDING, verified: APPROVED })
    renderPage()

    await screen.findByText("Amara Okeke")

    expect(screen.getByRole("tab", { name: /Pending/ })).toHaveTextContent("2")
    expect(screen.getByRole("tab", { name: /Needs info/ })).toHaveTextContent(
      "0"
    )
    expect(screen.getByRole("tab", { name: /Approved/ })).toHaveTextContent("1")
    expect(screen.getByRole("tab", { name: /Rejected/ })).toHaveTextContent("0")
  })

  it("switches to the Approved bucket's own rows on tab select", async () => {
    routeByStatus({ pending_review: PENDING, verified: APPROVED })
    const user = userEvent.setup()
    renderPage()

    await screen.findByText("Amara Okeke")

    await user.click(screen.getByRole("tab", { name: /Approved/ }))
    expect(await screen.findByText("Ngozi Eze")).toBeInTheDocument()
    expect(screen.queryByText("Amara Okeke")).not.toBeInTheDocument()
  })

  it("shows the empty-bucket copy for a bucket with no items", async () => {
    routeByStatus({ pending_review: { items: [], nextCursor: null } })
    renderPage()

    expect(
      await screen.findByText("Nothing in this bucket.")
    ).toBeInTheDocument()
  })

  it("surfaces a tokened error with a Retry affordance that refetches", async () => {
    // The active (Pending) tab errors; the other buckets resolve empty.
    mockQueue.mockImplementation((query = {}) => {
      if ((query.status ?? "pending_review") === "pending_review") {
        return Promise.reject(new Error("boom"))
      }
      return Promise.resolve({ items: [], nextCursor: null })
    })
    const user = userEvent.setup()
    renderPage()

    expect(
      await screen.findByText("Couldn't load the review queue")
    ).toBeInTheDocument()

    // Retry re-invokes the api client (success on the next Pending call).
    routeByStatus({ pending_review: PENDING })
    await user.click(screen.getByRole("button", { name: "Retry" }))

    expect(await screen.findByText("Amara Okeke")).toBeInTheDocument()
  })

  it("deep-links to the applicant's user-detail KYC tab on row click", async () => {
    routeByStatus({ pending_review: PENDING })
    const user = userEvent.setup()
    renderPage()

    const row = await screen.findByRole("button", {
      name: "Review Amara Okeke",
    })
    await user.click(row)

    expect(push).toHaveBeenCalledWith(
      "/users/11111111-1111-1111-1111-111111111111?tab=kyc"
    )
  })
})
