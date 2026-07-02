/**
 * AdminSettingsPage tests (real-data wiring — Phase 8).
 *
 * The screen reads the operator's own identity from `useAdminMe()` (profile card:
 * real displayName + email · role + the 2FA pill), lists their console sessions
 * from `useSessions()`, and wires the three notification-preference toggles to
 * `useAdminPreferences()` / `useUpdateAdminPreferences()`. The api layer is mocked
 * (no server). These assert:
 *  1. loading → data: the profile card renders the real displayName, email · role
 *     and the "2FA enrolled" pill; the sessions card lists a session; and the
 *     preference toggles seed from the fetched preferences.
 *  2. mfa disabled: the "2FA not set" pill + an "Enroll 2FA" button that opens the
 *     MfaEnrollDialog.
 *  3. preferences: toggling a row PATCHes the full preference set (full-state
 *     replace), and the switch holds its new state (derived, not setState-in-effect).
 *  4. empty: an empty sessions list shows the "No active sessions." empty state.
 *  5. error: a failed `getMe` shows the inline profile error + a retry affordance;
 *     a failed preferences fetch shows an inline preferences error.
 */
import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type {
  AdminMe,
  AdminPreferences,
  AdminSessionListResponse,
} from "@handshake-agent/contracts"

import { AdminSettingsPage } from "@/components/admin/admin-settings-page"

// ─── Mocks ──────────────────────────────────────────────────────────────────────
// Mock the api layer (not the hooks) — no server, and one module covers getMe,
// listSessions, the self-preferences read/write, and enrollMfa (behind the dialog).

vi.mock("@/lib/api/admin", () => ({
  getMe: vi.fn(),
  listSessions: vi.fn(),
  getAdminPreferences: vi.fn(),
  updateAdminPreferences: vi.fn(),
  enrollMfa: vi.fn(),
}))

import {
  getMe,
  listSessions,
  getAdminPreferences,
  updateAdminPreferences,
  enrollMfa,
} from "@/lib/api/admin"

const mockGetMe = vi.mocked(getMe)
const mockSessions = vi.mocked(listSessions)
const mockGetPrefs = vi.mocked(getAdminPreferences)
const mockUpdatePrefs = vi.mocked(updateAdminPreferences)
const mockEnrollMfa = vi.mocked(enrollMfa)

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const ME: AdminMe = {
  id: "11111111-1111-1111-1111-111111111111",
  email: "amara@handshake.ng",
  role: { id: "00000000-0000-0000-0000-000000000001", name: "Super Admin" },
  status: "active",
  displayName: "Amara Okonkwo",
  mfaEnabled: true,
  permissions: [],
  menus: [],
  pages: [],
}

const PREFS: AdminPreferences = {
  emailAlerts: true,
  approvalMentions: true,
  weeklyDigest: false,
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
  mockGetPrefs.mockReset()
  mockUpdatePrefs.mockReset()
  mockEnrollMfa.mockReset()
  mockGetMe.mockResolvedValue(ME)
  mockSessions.mockResolvedValue(SESSIONS)
  mockGetPrefs.mockResolvedValue(PREFS)
  // PATCH echoes the submitted full-state set back.
  mockUpdatePrefs.mockImplementation((input) => Promise.resolve(input))
  mockEnrollMfa.mockResolvedValue({
    otpauthUri: "otpauth://totp/x",
    qrSvg: "<svg></svg>",
    recoveryCodes: ["code-1", "code-2"],
  })
})

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("AdminSettingsPage (real-data wiring)", () => {
  it("renders the real displayName, email · role, and the enrolled 2FA pill", async () => {
    renderPage()

    // Profile card: real displayName (not the email local-part) + email · role.
    expect(await screen.findByText("Amara Okonkwo")).toBeInTheDocument()
    expect(
      screen.getByText(/amara@handshake\.ng · Super Admin/)
    ).toBeInTheDocument()
    expect(screen.getByText("2FA enrolled")).toBeInTheDocument()

    // Sessions card: the session's user-agent + IP render.
    expect(screen.getByText("Chrome · macOS")).toBeInTheDocument()
    expect(screen.getByText(/102\.89\.34\.10/)).toBeInTheDocument()
    expect(screen.getByText("Stepped up")).toBeInTheDocument()
  })

  it("seeds the preference toggles from the fetched preferences", async () => {
    renderPage()

    const emailAlerts = await screen.findByRole("switch", {
      name: "Email alerts",
    })
    expect(emailAlerts).toHaveAttribute("aria-checked", "true")
    expect(
      screen.getByRole("switch", { name: "Approval mentions" })
    ).toHaveAttribute("aria-checked", "true")
    expect(
      screen.getByRole("switch", { name: "Weekly digest" })
    ).toHaveAttribute("aria-checked", "false")
  })

  it("PATCHes the full preference set when a toggle is flipped and holds the new state", async () => {
    const user = userEvent.setup()
    renderPage()

    const weeklyDigest = await screen.findByRole("switch", {
      name: "Weekly digest",
    })
    expect(weeklyDigest).toHaveAttribute("aria-checked", "false")

    await user.click(weeklyDigest)

    // Full-state replace: the PATCH carries all three flags with weeklyDigest flipped.
    await waitFor(() => expect(mockUpdatePrefs).toHaveBeenCalledTimes(1))
    expect(mockUpdatePrefs).toHaveBeenCalledWith({
      emailAlerts: true,
      approvalMentions: true,
      weeklyDigest: true,
    })

    // The switch holds the flipped state (optimistic override).
    await waitFor(() =>
      expect(weeklyDigest).toHaveAttribute("aria-checked", "true")
    )
  })

  it("shows a 2FA-not-set pill and an Enroll button that opens the MFA dialog", async () => {
    mockGetMe.mockResolvedValue({ ...ME, mfaEnabled: false })
    const user = userEvent.setup()
    renderPage()

    expect(await screen.findByText("2FA not set")).toBeInTheDocument()
    expect(screen.queryByText("2FA enrolled")).not.toBeInTheDocument()

    const enrollBtn = screen.getByRole("button", { name: /Enroll 2FA/ })
    await user.click(enrollBtn)

    // The MfaEnrollDialog opens and kicks off enrollment.
    expect(
      await screen.findByText("Set up multi-factor authentication")
    ).toBeInTheDocument()
    await waitFor(() => expect(mockEnrollMfa).toHaveBeenCalled())
  })

  it("does not show the Enroll button when MFA is already enrolled", async () => {
    renderPage()

    await screen.findByText("2FA enrolled")
    expect(
      screen.queryByRole("button", { name: /Enroll 2FA/ })
    ).not.toBeInTheDocument()
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

  it("shows an inline preferences error when the preferences fetch fails", async () => {
    mockGetPrefs.mockRejectedValue(new Error("boom"))
    renderPage()

    expect(
      await screen.findByText("Couldn't load your preferences")
    ).toBeInTheDocument()
  })
})
