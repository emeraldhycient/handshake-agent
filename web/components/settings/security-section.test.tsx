import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { SecuritySection } from "./security-section"

const sessions = vi.hoisted(() => ({ current: {} as Record<string, unknown> }))
const revoke = vi.hoisted(() => ({
  current: {
    mutateAsync: vi.fn().mockResolvedValue(undefined),
    isPending: false,
  },
}))
const showToast = vi.hoisted(() => vi.fn())

vi.mock("@/lib/query/profile", () => ({
  useProfileSessions: () => sessions.current,
  useRevokeSession: () => revoke.current,
}))
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ showToast }) }))
vi.mock("./change-pin-dialog", () => ({
  ChangePinDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="pin-dialog" /> : null,
}))

const CHROME_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36"

beforeEach(() => {
  showToast.mockClear()
  revoke.current = {
    mutateAsync: vi.fn().mockResolvedValue(undefined),
    isPending: false,
  }
  sessions.current = {
    isLoading: false,
    isError: false,
    data: {
      sessions: [
        {
          id: "s1",
          channel: "web",
          userAgent: CHROME_UA,
          createdAt: "2026-07-15T10:00:00.000Z",
          lastUsedAt: "2026-07-15T12:00:00.000Z",
          expiresAt: "2026-08-15T10:00:00.000Z",
          isCurrent: true,
        },
        {
          id: "s2",
          channel: "web",
          userAgent: null,
          createdAt: "2026-07-14T10:00:00.000Z",
          lastUsedAt: null,
          expiresAt: "2026-08-14T10:00:00.000Z",
          isCurrent: false,
        },
      ],
    },
  }
})

describe("SecuritySection", () => {
  it("opens the change-PIN dialog", async () => {
    render(<SecuritySection density="desktop" />)
    expect(screen.getByText("Transaction PIN")).toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: "Change" }))
    expect(screen.getByTestId("pin-dialog")).toBeInTheDocument()
  })

  it("shows the parsed browser · os and a non-revocable current session", () => {
    render(<SecuritySection density="desktop" />)
    expect(screen.getByText("Chrome · macOS")).toBeInTheDocument()
    expect(screen.getByText("This device")).toBeInTheDocument()
    // one Revoke button (only the non-current session)
    expect(screen.getAllByRole("button", { name: /revoke/i })).toHaveLength(1)
  })

  it("revokes a non-current session with a toast", async () => {
    render(<SecuritySection density="desktop" />)
    await userEvent.click(screen.getByRole("button", { name: /revoke/i }))
    expect(revoke.current.mutateAsync).toHaveBeenCalledWith("s2")
    expect(showToast).toHaveBeenCalledWith("Session revoked")
  })
})
