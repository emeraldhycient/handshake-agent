import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, it, expect, vi } from "vitest"
import { TicketsCard } from "./tickets-card"
import type { TicketsCardProps } from "@/types"
import type { TicketOption } from "@/lib/schemas"

const options: TicketOption[] = [
  {
    tier: "Regular",
    perk: "General admission",
    price: "₦15,000",
    left: "142 left",
    total: "₦15,000",
  },
  {
    tier: "VIP",
    perk: "Premium lounge access",
    price: "₦35,000",
    left: "23 left",
    total: "₦35,000",
  },
  {
    tier: "VVIP Table",
    perk: "Reserved table for 4",
    price: "₦120,000",
    left: "5 left",
    total: "₦120,000",
  },
]

const baseProps: TicketsCardProps = {
  kind: "tickets",
  eventMeta: "SAT 14 JUN · VICTORIA ISLAND",
  eventName: "Burna Boy Live Lagos",
  options,
  density: "mobile",
  onSelect: vi.fn(),
}

describe("TicketsCard", () => {
  it("renders eventName for mobile density", () => {
    render(<TicketsCard {...baseProps} density="mobile" />)
    expect(screen.getByText("Burna Boy Live Lagos")).toBeInTheDocument()
  })

  it("renders eventName for desktop density", () => {
    render(<TicketsCard {...baseProps} density="desktop" />)
    expect(screen.getByText("Burna Boy Live Lagos")).toBeInTheDocument()
  })

  it("renders all option tiers for mobile density", () => {
    render(<TicketsCard {...baseProps} density="mobile" />)
    expect(screen.getByText("Regular")).toBeInTheDocument()
    expect(screen.getByText("VIP")).toBeInTheDocument()
    expect(screen.getByText("VVIP Table")).toBeInTheDocument()
  })

  it("renders all option prices for mobile density", () => {
    render(<TicketsCard {...baseProps} density="mobile" />)
    expect(screen.getByText("₦15,000")).toBeInTheDocument()
    expect(screen.getByText("₦35,000")).toBeInTheDocument()
    expect(screen.getByText("₦120,000")).toBeInTheDocument()
  })

  it("renders all option tiers for desktop density", () => {
    render(<TicketsCard {...baseProps} density="desktop" />)
    expect(screen.getByText("Regular")).toBeInTheDocument()
    expect(screen.getByText("VIP")).toBeInTheDocument()
    expect(screen.getByText("VVIP Table")).toBeInTheDocument()
  })

  it("calls onSelect with the correct option when an option is clicked (mobile)", async () => {
    const onSelect = vi.fn()
    render(<TicketsCard {...baseProps} density="mobile" onSelect={onSelect} />)
    await userEvent.click(screen.getByText("VIP").closest("button")!)
    expect(onSelect).toHaveBeenCalledWith(options[1])
  })

  it("calls onSelect with the correct option when an option is clicked (desktop)", async () => {
    const onSelect = vi.fn()
    render(<TicketsCard {...baseProps} density="desktop" onSelect={onSelect} />)
    await userEvent.click(screen.getByText("VVIP Table").closest("button")!)
    expect(onSelect).toHaveBeenCalledWith(options[2])
  })
})
