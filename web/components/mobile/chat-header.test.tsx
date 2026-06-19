import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { ChatHeader } from "./chat-header"

describe("ChatHeader", () => {
  it("renders the agent name", () => {
    render(<ChatHeader />)
    expect(screen.getByText("Handshake Agent")).toBeInTheDocument()
  })

  it("renders the online status", () => {
    render(<ChatHeader />)
    expect(screen.getByText("Online · replies instantly")).toBeInTheDocument()
  })

  it("renders the Secured badge", () => {
    render(<ChatHeader />)
    expect(screen.getByText("Secured")).toBeInTheDocument()
  })
})
