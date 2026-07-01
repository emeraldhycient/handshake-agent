/**
 * KycReviewPage tests — the KYC review queue wired to the real admin backend
 * (`useKycQueue` → GET /admin/kyc/queue, which returns only pending_review users).
 *
 *  1. loading → data: shows a busy skeleton, then renders one applicant row per
 *     queue item (email + userId) once the mocked queue resolves, and the Pending
 *     tab count reflects the returned item count.
 *  2. empty: an empty queue shows the design's "Nothing in this bucket." copy;
 *     switching to a tab with no backing endpoint (Approved) also shows it.
 *  3. error: a failed queue query surfaces the tokened inline error with a Retry
 *     affordance (and re-invokes the api client on click).
 *  4. row click deep-links to the applicant's user-detail KYC tab.
 *
 * The api layer is mocked — no server. `next/navigation` is stubbed for routing.
 */
import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { KycQueueResponse } from "@handshake-agent/contracts"

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

// ─── Fixture ────────────────────────────────────────────────────────────────────

const QUEUE: KycQueueResponse = {
  items: [
    {
      userId: "11111111-1111-1111-1111-111111111111",
      email: "amara.okeke@example.com",
      status: "pending_review",
      submittedAt: "2026-06-30T10:00:00.000Z",
    },
    {
      userId: "22222222-2222-2222-2222-222222222222",
      email: "chidi.adeyemi@example.com",
      status: "pending_review",
      submittedAt: "2026-06-30T11:00:00.000Z",
    },
  ],
  nextCursor: null,
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
  it("shows a loading state, then renders one row per queue item with its count", async () => {
    mockQueue.mockResolvedValue(QUEUE)
    const { container } = renderPage()

    // Loading branch: the skeleton block is marked busy before data arrives.
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull()

    // Data branch: an applicant row per queue item (email + userId shown).
    expect(
      await screen.findByText("amara.okeke@example.com")
    ).toBeInTheDocument()
    expect(screen.getByText("chidi.adeyemi@example.com")).toBeInTheDocument()
    expect(
      screen.getByText("11111111-1111-1111-1111-111111111111")
    ).toBeInTheDocument()

    // The Pending tab count badge reflects the two returned items.
    const pendingTab = screen.getByRole("tab", { name: /Pending/ })
    expect(pendingTab).toHaveTextContent("2")
  })

  it("shows the empty-bucket copy for an empty queue and for unbacked tabs", async () => {
    mockQueue.mockResolvedValue({ items: [], nextCursor: null })
    renderPage()

    // Empty Pending queue → the design's empty copy.
    expect(
      await screen.findByText("Nothing in this bucket.")
    ).toBeInTheDocument()

    // The Approved tab has no backing endpoint → also the empty bucket.
    const user = userEvent.setup()
    await user.click(screen.getByRole("tab", { name: /Approved/ }))
    expect(screen.getByText("Nothing in this bucket.")).toBeInTheDocument()
  })

  it("surfaces a tokened error with a Retry affordance that refetches", async () => {
    mockQueue.mockRejectedValueOnce(new Error("boom"))
    const user = userEvent.setup()
    renderPage()

    expect(
      await screen.findByText("Couldn't load the review queue")
    ).toBeInTheDocument()

    // Retry re-invokes the api client (success on the second call).
    mockQueue.mockResolvedValue(QUEUE)
    await user.click(screen.getByRole("button", { name: "Retry" }))

    expect(
      await screen.findByText("amara.okeke@example.com")
    ).toBeInTheDocument()
    expect(mockQueue).toHaveBeenCalledTimes(2)
  })

  it("deep-links to the applicant's user-detail KYC tab on row click", async () => {
    mockQueue.mockResolvedValue(QUEUE)
    const user = userEvent.setup()
    renderPage()

    const row = await screen.findByRole("button", {
      name: "Review amara.okeke@example.com",
    })
    await user.click(row)

    expect(push).toHaveBeenCalledWith(
      "/users/11111111-1111-1111-1111-111111111111?tab=kyc"
    )
  })
})
