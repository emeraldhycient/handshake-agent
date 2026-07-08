import { beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MCP_CAPABILITY_NOTE } from "@/constants/settings"

const patsQuery = vi.hoisted(() => ({
  current: {} as Record<string, unknown>,
}))
const revokeMutation = vi.hoisted(() => ({
  current: {} as Record<string, unknown>,
}))
vi.mock("@/lib/query/profile", () => ({
  usePats: () => patsQuery.current,
  useRevokePat: () => revokeMutation.current,
}))
// The create dialog has its own spec — assert only that the section opens it.
vi.mock("./create-token-dialog", () => ({
  CreateTokenDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="create-token-dialog" /> : null,
}))

import { McpSection } from "./mcp-section"

const token = {
  id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
  label: "Claude Code",
  scopes: ["read", "chat:propose"],
  createdAt: "2026-07-08T10:00:00.000Z",
  lastUsedAt: null,
  expiresAt: null,
}

describe("McpSection", () => {
  beforeEach(() => {
    patsQuery.current = {
      isLoading: false,
      isError: false,
      data: { tokens: [token] },
    }
    revokeMutation.current = {
      mutateAsync: vi.fn().mockResolvedValue(undefined),
      isPending: false,
      reset: vi.fn(),
    }
  })

  it("renders a skeleton while loading", () => {
    patsQuery.current = { isLoading: true, isError: false, data: undefined }
    const { container } = render(<McpSection />)
    expect(container.querySelector('[data-slot="skeleton"]')).not.toBeNull()
  })

  it("renders the error branch", () => {
    patsQuery.current = { isLoading: false, isError: true, data: undefined }
    render(<McpSection />)
    expect(screen.getByText(/could not load your tokens/i)).toBeInTheDocument()
  })

  it("renders the empty branch", () => {
    patsQuery.current = {
      isLoading: false,
      isError: false,
      data: { tokens: [] },
    }
    render(<McpSection />)
    expect(screen.getByText(/no connected agents yet/i)).toBeInTheDocument()
  })

  it("lists tokens with label and scopes, and shows the connection docs", () => {
    render(<McpSection />)
    expect(screen.getByText("Claude Code")).toBeInTheDocument()
    expect(screen.getByText(/read account data/i)).toBeInTheDocument()
    // Connection docs: endpoint + auth header example + §3.1 capability note.
    expect(screen.getByText(/\/mcp$/)).toBeInTheDocument()
    expect(screen.getByText(/authorization: bearer hsk_pat_/i)).toBeInTheDocument()
    expect(screen.getByText(MCP_CAPABILITY_NOTE)).toBeInTheDocument()
    expect(screen.getByText(/claude mcp add --transport http/i)).toBeInTheDocument()
  })

  it("opens the create-token dialog", async () => {
    const user = userEvent.setup()
    render(<McpSection />)

    await user.click(screen.getByRole("button", { name: /create token/i }))

    expect(screen.getByTestId("create-token-dialog")).toBeInTheDocument()
  })

  it("revokes a token after confirmation", async () => {
    const user = userEvent.setup()
    render(<McpSection />)

    await user.click(screen.getByRole("button", { name: /revoke/i }))
    await user.click(
      await screen.findByRole("button", { name: /yes, revoke/i })
    )

    expect(revokeMutation.current.mutateAsync).toHaveBeenCalledWith(token.id)
  })
})
