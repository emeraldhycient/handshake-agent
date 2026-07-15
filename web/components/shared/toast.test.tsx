import { describe, it, expect, afterEach } from "vitest"
import { render, screen } from "@testing-library/react"
import { Toast } from "./toast"
import { useToastStore } from "@/lib/store/toast-store"

afterEach(() => useToastStore.getState().clear())

describe("Toast", () => {
  it("renders nothing when there is no message", () => {
    const { container } = render(<Toast />)
    expect(container).toBeEmptyDOMElement()
  })

  it("renders the current message with a status role", () => {
    useToastStore.setState({ message: "Copied to clipboard" })
    render(<Toast />)
    expect(screen.getByRole("status")).toHaveTextContent("Copied to clipboard")
  })

  it("clear() removes the message", () => {
    useToastStore.setState({ message: "Session revoked" })
    const { rerender } = render(<Toast />)
    expect(screen.getByRole("status")).toBeInTheDocument()
    useToastStore.getState().clear()
    rerender(<Toast />)
    expect(screen.queryByRole("status")).not.toBeInTheDocument()
  })
})
