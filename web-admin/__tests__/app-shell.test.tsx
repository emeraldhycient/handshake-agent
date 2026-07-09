/**
 * AppShell nav-gating tests (design chrome §4.1 — "Platform" group).
 *
 *  1. A super_admin (menus include `menu.access` + `menu.audit`) sees the
 *     access-scoped items (Admins & roles / Roles / Sessions) and Audit log.
 *  2. An ops admin (menus = only `menu.audit`) does NOT see the menu.access
 *     items, but DOES see Audit log. The Dashboard link always shows.
 *
 * The api layer is mocked — useAdminMe resolves a canned AdminMe; no server.
 */
import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { AdminMe } from "@handshake-agent/contracts"

import { AppShell } from "@/components/admin/app-shell"
import { defaultAdminAuthStore } from "@/lib/store/admin-auth-store"

// ─── Mocks ──────────────────────────────────────────────────────────────────────

const { mockReplace } = vi.hoisted(() => ({ mockReplace: vi.fn() }))
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  // The topbar command-palette + notifications/account menus use the router; the
  // auth gate (useRequireAuth) calls router.replace('/login') when unauthenticated.
  useRouter: () => ({
    push: vi.fn(),
    replace: mockReplace,
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  }),
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock("@/lib/api/admin", () => ({
  getMe: vi.fn(),
  logout: vi.fn(),
}))

// The four live nav-badge sources (KYC queue depth / stuck txns / open recon
// breaks / approvals awaiting me). Mocked so the badge counts are deterministic.
vi.mock("@/lib/api/kyc", () => ({ listKycQueue: vi.fn() }))
vi.mock("@/lib/api/transactions", () => ({ listTransactions: vi.fn() }))
vi.mock("@/lib/api/reconciliation", () => ({ getReconStatus: vi.fn() }))
vi.mock("@/lib/api/approvals", () => ({ getApprovalsInbox: vi.fn() }))

// Stub the enroll dialog so the shell's affordance is tested in isolation (the
// real dialog fires a POST on open).
vi.mock("@/components/admin/mfa-enroll-dialog", () => ({
  MfaEnrollDialog: ({ open }: { open: boolean }) =>
    open ? <div>mfa-enroll-dialog-open</div> : null,
}))

import { getMe } from "@/lib/api/admin"
import { listKycQueue } from "@/lib/api/kyc"
import { listTransactions } from "@/lib/api/transactions"
import { getReconStatus } from "@/lib/api/reconciliation"
import { getApprovalsInbox } from "@/lib/api/approvals"
const mockGetMe = vi.mocked(getMe)
const mockListKycQueue = vi.mocked(listKycQueue)
const mockListTransactions = vi.mocked(listTransactions)
const mockGetReconStatus = vi.mocked(getReconStatus)
const mockGetApprovalsInbox = vi.mocked(getApprovalsInbox)

// A canned KYC queue of `n` review items (only the length feeds the badge).
function kycQueue(n: number) {
  return {
    items: Array.from({ length: n }, (_, i) => ({ userId: `u${i}` })),
    nextCursor: null,
  } as unknown as Awaited<ReturnType<typeof listKycQueue>>
}
function txnCounts(stuck: number) {
  return {
    items: [],
    nextCursor: null,
    counts: { all: stuck, stuck, failed: 0, refunds: 0 },
  } as unknown as Awaited<ReturnType<typeof listTransactions>>
}
function reconStatus(openBreakCount: number) {
  return {
    enabled: true,
    lastRunAt: null,
    nextRunAt: null,
    intervalSeconds: 3600,
    openBreakCount,
  } as unknown as Awaited<ReturnType<typeof getReconStatus>>
}
function approvalsInbox(awaitingMe: number) {
  return {
    awaitingMe: [],
    myRequests: [],
    counts: { awaitingMe, myRequests: 0, myPending: 0 },
  } as unknown as Awaited<ReturnType<typeof getApprovalsInbox>>
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function adminMe(overrides: Partial<AdminMe>): AdminMe {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    email: "admin@example.com",
    role: { id: "00000000-0000-0000-0000-0000000000aa", name: "ops" },
    status: "active",
    displayName: "Test Admin",
    mfaEnabled: true,
    permissions: [],
    menus: [],
    pages: [],
    ...overrides,
  }
}

function renderShell() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <AppShell>
        <div>page body</div>
      </AppShell>
    </QueryClientProvider>
  )
}

beforeEach(() => {
  mockGetMe.mockReset()
  // AppShell embeds the auth gate (useRequireAuth). Boot from a clean anonymous
  // store: the GET /admin/me probe (mocked per test via mockGetMe) rehydrates the
  // session from the HttpOnly cookie and mounts the chrome; a rejected probe
  // redirects to /login. Default the probe to a resolved session.
  defaultAdminAuthStore.getState().clear()
  mockGetMe.mockResolvedValue(adminMe({}))
  // Default the badge sources to zero so nav-gating/MFA tests stay deterministic
  // (a zero count renders no pip). Badge-specific tests override these.
  mockListKycQueue.mockResolvedValue(kycQueue(0))
  mockListTransactions.mockResolvedValue(txnCounts(0))
  mockGetReconStatus.mockResolvedValue(reconStatus(0))
  mockGetApprovalsInbox.mockResolvedValue(approvalsInbox(0))
})

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("AppShell nav gating", () => {
  it("shows the access-scoped items + Audit for a super_admin menu set", async () => {
    mockGetMe.mockResolvedValue(
      adminMe({
        role: {
          id: "00000000-0000-0000-0000-0000000000ff",
          name: "super_admin",
        },
        menus: ["menu.access", "menu.audit", "menu.approvals"],
      })
    )

    renderShell()

    // Admins & roles (menu.access) + Approvals (menu.approvals — the checker
    // grant, so ops/finance/compliance reach their own four-eyes inbox) show.
    expect(
      await screen.findByRole("link", { name: "Admins & roles" })
    ).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Approvals" })).toBeInTheDocument()
    // Audit log (menu.audit) + Dashboard (always) also show.
    expect(screen.getByRole("link", { name: "Audit log" })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Dashboard" })).toBeInTheDocument()
  })

  it("shows the Metrics & analytics link (→ /metrics) when menu.metrics is granted", async () => {
    mockGetMe.mockResolvedValue(adminMe({ menus: ["menu.metrics"] }))
    renderShell()
    const link = await screen.findByRole("link", {
      name: "Metrics & analytics",
    })
    expect(link).toHaveAttribute("href", "/metrics")
  })

  it("hides the menu.access items but shows Audit for an ops set with only menu.audit", async () => {
    mockGetMe.mockResolvedValue(adminMe({ menus: ["menu.audit"] }))

    renderShell()

    // Audit log resolves (menu.audit granted); Dashboard always shows.
    expect(
      await screen.findByRole("link", { name: "Audit log" })
    ).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Dashboard" })).toBeInTheDocument()

    // The menu.access items never appear.
    await waitFor(() => {
      expect(
        screen.queryByRole("link", { name: "Admins & roles" })
      ).not.toBeInTheDocument()
    })
    expect(
      screen.queryByRole("link", { name: "Approvals" })
    ).not.toBeInTheDocument()
  })
})

describe("AppShell live nav badges", () => {
  // menus that make all four badge-bearing nav items visible.
  const BADGE_MENUS = [
    "menu.kyc",
    "menu.transactions",
    "menu.access",
    "menu.approvals",
  ]

  it("renders the live count from each badge source, not the design mock", async () => {
    mockGetMe.mockResolvedValue(
      adminMe({
        role: {
          id: "00000000-0000-0000-0000-0000000000ff",
          name: "super_admin",
        },
        menus: BADGE_MENUS,
      })
    )
    // Live counts distinct from the old design mock (kyc 13 / stuck 5 / recon 3
    // / approvals 4) so a regression to the hardcoded values fails this test.
    mockListKycQueue.mockResolvedValue(kycQueue(7))
    mockListTransactions.mockResolvedValue(txnCounts(2))
    mockGetReconStatus.mockResolvedValue(reconStatus(9))
    mockGetApprovalsInbox.mockResolvedValue(approvalsInbox(1))

    renderShell()

    // The badge number is concatenated into each nav link's accessible name.
    expect(
      await screen.findByRole("link", { name: /KYC review\s*7/ })
    ).toBeInTheDocument()
    expect(
      screen.getByRole("link", { name: /Transactions\s*2/ })
    ).toBeInTheDocument()
    expect(
      screen.getByRole("link", { name: /Reconciliation\s*9/ })
    ).toBeInTheDocument()
    expect(
      screen.getByRole("link", { name: /Approvals\s*1/ })
    ).toBeInTheDocument()

    // The stale mock KYC value (13) must not survive anywhere in the nav.
    expect(screen.queryByText("13")).not.toBeInTheDocument()
  })

  it("shows no pip when a source count is zero", async () => {
    mockGetMe.mockResolvedValue(adminMe({ menus: BADGE_MENUS }))
    // all sources default to zero via beforeEach

    renderShell()

    // KYC review link resolves, but its name carries no trailing count.
    const kyc = await screen.findByRole("link", { name: /KYC review/ })
    expect(kyc).toHaveAccessibleName("KYC review")
  })
})

describe("AppShell account menu (honest role display, no view-as)", () => {
  it("shows the operator's real role on the account pill and offers no view-as switcher", async () => {
    mockGetMe.mockResolvedValue(
      adminMe({
        role: {
          id: "00000000-0000-0000-0000-0000000000ff",
          name: "super_admin",
        },
        menus: ["menu.audit"],
      })
    )

    renderShell()

    // The account pill opens once me resolves; it shows the signed-in email.
    const account = await screen.findByRole("button", { name: "Account menu" })
    await userEvent.click(account)

    // The honest read-only role display renders the operator's REAL role (shown
    // on both the pill and inside the open menu).
    await waitFor(() =>
      expect(screen.getAllByText("super_admin").length).toBeGreaterThan(0)
    )
    // Sign out stays.
    expect(screen.getByRole("menuitem", { name: "Sign out" })).toBeInTheDocument()

    // The view-as role SWITCHER is gone: no section header, no per-role items.
    expect(screen.queryByText(/view as role/i)).not.toBeInTheDocument()
    expect(
      screen.queryByRole("menuitem", { name: "Operations" })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("menuitem", { name: "Compliance" })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("menuitem", { name: "Finance" })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("menuitem", { name: "Support" })
    ).not.toBeInTheDocument()
  })

  it("never renders a view-as impersonation banner", async () => {
    mockGetMe.mockResolvedValue(adminMe({ menus: ["menu.audit"] }))

    renderShell()

    // Wait for the shell to resolve, then assert the amber view-as banner is absent.
    await screen.findByRole("button", { name: "Account menu" })
    expect(screen.queryByText(/viewing as/i)).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: /reset to super admin/i })
    ).not.toBeInTheDocument()
  })
})

describe("AppShell MFA enrollment affordance", () => {
  it("shows a Set up MFA control when not enrolled and opens the enroll dialog", async () => {
    mockGetMe.mockResolvedValue(adminMe({ mfaEnabled: false }))

    renderShell()

    const button = await screen.findByRole("button", { name: /set up mfa/i })
    expect(screen.queryByText("mfa-enroll-dialog-open")).not.toBeInTheDocument()

    await userEvent.click(button)

    expect(screen.getByText("mfa-enroll-dialog-open")).toBeInTheDocument()
  })

  it("hides the Set up MFA control once MFA is enrolled", async () => {
    mockGetMe.mockResolvedValue(adminMe({ mfaEnabled: true }))

    renderShell()

    // Sign out is always present once me resolves — anchor on it, then assert
    // the MFA control is absent.
    expect(
      await screen.findByRole("button", { name: "Sign out" })
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: /set up mfa/i })
    ).not.toBeInTheDocument()
  })
})

describe("AppShell auth gate (centralized)", () => {
  it("renders no chrome and redirects to /login when the session probe fails (401)", async () => {
    mockReplace.mockClear()
    // Anonymous store + a failing GET /admin/me probe = no valid cookie session.
    defaultAdminAuthStore.getState().clear()
    mockGetMe.mockRejectedValue(new Error("unauthorized"))

    renderShell()

    // No chrome + no page body render; the auth gate returns null.
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/login"))
    expect(screen.queryByText("page body")).not.toBeInTheDocument()
    expect(
      screen.queryByRole("link", { name: "Dashboard" })
    ).not.toBeInTheDocument()
  })
})
