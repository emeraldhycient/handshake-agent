/**
 * AdminSettingsPage tests (real-data wiring — Phase 6a).
 *
 * The screen now reads the operator's own identity from `useAdminMe()` (profile
 * card) and lists their console sessions from `useSessions()`. The api layer is
 * mocked (no server). These assert:
 *  1. loading → data: the profile card renders the real email · role and the "2FA
 *     enrolled" pill from `mfaEnabled`, and the sessions card lists a session's
 *     user-agent + IP.
 *  2. empty: an empty sessions list shows the "No active sessions." empty state.
 *  3. error: a failed `getMe` shows the inline profile error + a retry affordance.
 *
 * The Theme row + preference toggles are unchanged local UI state and are not
 * re-asserted here.
 */
import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type {
  AdminMe,
  AdminSessionListResponse,
} from "@handshake-agent/contracts"

import { AdminSettingsPage } from "@/components/admin/admin-settings-page"

// ─── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock("@/lib/api/admin", () => ({
  getMe: vi.fn(),
  listSessions: vi.fn(),
}))

import { getMe, listSessions } from "@/lib/api/admin"

const mockGetMe = vi.mocked(getMe)
const mockSessions = vi.mocked(listSessions)

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const ME: AdminMe = {
  id: "11111111-1111-1111-1111-111111111111",
  email: "amara@handshake.ng",
  role: { id: "00000000-0000-0000-0000-000000000001", name: "Super Admin" },
  status: "active",
  displayName: "Test Admin",
  mfaEnabled: true,
  permissions: [],
  menus: [],
  pages: [],
}

const SESSIONS: AdminSessionListResponse = {
  items: [
    {
      id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      expiresAt: "2026-07-02T00:00:00.000Z",
      revokedAt: null,
      stepUpCompletedAt: "2026-07-01T10:00:00.000Z",
      ipAddress: "102.89.34.10",
      userAgent: "Chrome · macOS",
    },
  ],
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <AdminSettingsPage />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  mockGetMe.mockReset()
  mockSessions.mockReset()
  mockGetMe.mockResolvedValue(ME)
  mockSessions.mockResolvedValue(SESSIONS)
})

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("AdminSettingsPage (real-data wiring)", () => {
  it("renders the profile from useAdminMe and the sessions from useSessions", async () => {
    renderPage()

    // Profile card: real email · role and the enrolled 2FA pill.
    expect(
      await screen.findByText(/amara@handshake\.ng · Super Admin/)
    ).toBeInTheDocument()
    expect(screen.getByText("2FA enrolled")).toBeInTheDocument()

    // Sessions card: the session's user-agent + IP render.
    expect(screen.getByText("Chrome · macOS")).toBeInTheDocument()
    expect(screen.getByText(/102\.89\.34\.10/)).toBeInTheDocument()
    // The stepped-up badge shows for a session with a step-up timestamp.
    expect(screen.getByText("Stepped up")).toBeInTheDocument()
  })

  it("shows a 2FA-not-set pill when MFA is disabled", async () => {
    mockGetMe.mockResolvedValue({ ...ME, mfaEnabled: false })
    renderPage()

    expect(await screen.findByText("2FA not set")).toBeInTheDocument()
    expect(screen.queryByText("2FA enrolled")).not.toBeInTheDocument()
  })

  it("shows the empty state when there are no active sessions", async () => {
    mockSessions.mockResolvedValue({ items: [] })
    renderPage()

    expect(await screen.findByText("No active sessions.")).toBeInTheDocument()
  })

  it("shows the profile error with a retry affordance when getMe fails", async () => {
    mockGetMe.mockRejectedValue(new Error("boom"))
    renderPage()

    expect(
      await screen.findByText("Couldn't load your profile")
    ).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Try again" })
    ).toBeInTheDocument()
  })
})
