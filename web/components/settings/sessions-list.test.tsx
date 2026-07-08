import { beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

const sessionsQuery = vi.hoisted(() => ({
  current: {} as Record<string, unknown>,
}))
const revokeMutation = vi.hoisted(() => ({
  current: {} as Record<string, unknown>,
}))
const logoutMutation = vi.hoisted(() => ({
  current: {} as Record<string, unknown>,
}))
const routerPush = vi.hoisted(() => vi.fn())

vi.mock("@/lib/query/profile", () => ({
  useProfileSessions: () => sessionsQuery.current,
  useRevokeSession: () => revokeMutation.current,
}))
vi.mock("@/lib/query/auth", () => ({
  useLogout: () => logoutMutation.current,
}))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush }),
}))

import { SessionsList } from "./sessions-list"

const currentSession = {
  id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  channel: "web",
  userAgent: "Mozilla/5.0 (Macintosh)",
  createdAt: "2026-07-01T10:00:00.000Z",
  lastUsedAt: "2026-07-08T09:00:00.000Z",
  expiresAt: "2026-08-01T10:00:00.000Z",
  isCurrent: true,
}
const otherSession = {
  ...currentSession,
  id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
  userAgent: "Mozilla/5.0 (iPhone)",
  isCurrent: false,
}

describe("SessionsList", () => {
  beforeEach(() => {
    routerPush.mockReset()
    sessionsQuery.current = {
      isLoading: false,
      isError: false,
      data: { sessions: [currentSession, otherSession] },
    }
    revokeMutation.current = {
      mutateAsync: vi.fn().mockResolvedValue(undefined),
      isPending: false,
      reset: vi.fn(),
    }
    logoutMutation.current = {
      mutate: vi.fn(
        (_: unknown, opts?: { onSettled?: () => void }) => opts?.onSettled?.()
      ),
      isPending: false,
    }
  })

  it("renders a skeleton while loading", () => {
    sessionsQuery.current = { isLoading: true, isError: false, data: undefined }
    const { container } = render(<SessionsList />)
    expect(container.querySelector('[data-slot="skeleton"]')).not.toBeNull()
  })

  it("renders the error branch", () => {
    sessionsQuery.current = { isLoading: false, isError: true, data: undefined }
    render(<SessionsList />)
    expect(screen.getByText(/could not load your sessions/i)).toBeInTheDocument()
  })

  it("renders the empty branch", () => {
    sessionsQuery.current = {
      isLoading: false,
      isError: false,
      data: { sessions: [] },
    }
    render(<SessionsList />)
    expect(screen.getByText(/no active sessions/i)).toBeInTheDocument()
  })

  it("marks the current session with a 'This device' badge", () => {
    render(<SessionsList />)
    expect(screen.getByText(/this device/i)).toBeInTheDocument()
    expect(screen.getAllByRole("button", { name: /revoke/i })).toHaveLength(2)
  })

  it("revokes another session after confirmation (no logout)", async () => {
    const user = userEvent.setup()
    render(<SessionsList />)

    await user.click(screen.getAllByRole("button", { name: /revoke/i })[1])
    await user.click(
      await screen.findByRole("button", { name: /yes, revoke/i })
    )

    expect(revokeMutation.current.mutateAsync).toHaveBeenCalledWith(
      otherSession.id
    )
    expect(logoutMutation.current.mutate).not.toHaveBeenCalled()
    expect(routerPush).not.toHaveBeenCalled()
  })

  it("revoking the current session runs the logout flow", async () => {
    const user = userEvent.setup()
    render(<SessionsList />)

    await user.click(screen.getAllByRole("button", { name: /revoke/i })[0])
    await user.click(
      await screen.findByRole("button", { name: /yes, revoke/i })
    )

    expect(revokeMutation.current.mutateAsync).toHaveBeenCalledWith(
      currentSession.id
    )
    expect(logoutMutation.current.mutate).toHaveBeenCalled()
    expect(routerPush).toHaveBeenCalledWith("/login")
  })
})
