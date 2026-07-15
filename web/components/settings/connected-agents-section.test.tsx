import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { ConnectedAgentsSection } from "./connected-agents-section"

const pats = vi.hoisted(() => ({ current: {} as Record<string, unknown> }))
const revoke = vi.hoisted(() => ({
  current: { mutateAsync: vi.fn().mockResolvedValue(undefined) },
}))
const showToast = vi.hoisted(() => vi.fn())

vi.mock("@/lib/query/profile", () => ({
  usePats: () => pats.current,
  useRevokePat: () => revoke.current,
}))
vi.mock("@/hooks/use-mcp-endpoint", () => ({
  useMcpEndpoint: () => "http://localhost:3001/mcp",
}))
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ showToast }) }))
vi.mock("./create-token-dialog", () => ({
  CreateTokenDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="create-dialog" /> : null,
}))

beforeEach(() => {
  showToast.mockClear()
  revoke.current = { mutateAsync: vi.fn().mockResolvedValue(undefined) }
  pats.current = { isLoading: false, isError: false, data: { tokens: [] } }
})

describe("ConnectedAgentsSection", () => {
  it("shows the empty state, MCP endpoint and opens the create dialog", async () => {
    render(<ConnectedAgentsSection density="desktop" />)
    expect(screen.getByText(/No agents connected yet/i)).toBeInTheDocument()
    expect(screen.getByText("http://localhost:3001/mcp")).toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: "Create token" }))
    expect(screen.getByTestId("create-dialog")).toBeInTheDocument()
  })

  it("lists a token and disconnects it with a toast", async () => {
    pats.current = {
      isLoading: false,
      isError: false,
      data: {
        tokens: [
          {
            id: "t1",
            label: "Personal agent",
            scopes: ["read"],
            createdAt: "2026-07-15T10:00:00.000Z",
            lastUsedAt: null,
            expiresAt: null,
          },
        ],
      },
    }
    render(<ConnectedAgentsSection density="desktop" />)
    expect(screen.getByText("Personal agent")).toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: /disconnect/i }))
    expect(revoke.current.mutateAsync).toHaveBeenCalledWith("t1")
    expect(showToast).toHaveBeenCalledWith("Personal agent disconnected")
  })
})
