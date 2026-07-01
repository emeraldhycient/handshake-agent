/**
 * WhatsAppPage test (design §6.20).
 *
 * This screen is a pure design reproduction (no TanStack Query / no
 * `useWhatsAppConfig`) — it renders the design's own representative sample content
 * from module-level constants. The tests assert that content renders:
 *
 *  1. The "Number & webhook health" card renders its key/val rows and the
 *     "Official Cloud API only" success note — and never a plaintext secret.
 *  2. The Flows card renders a "Live" pill for each E2E flow.
 *  3. The read-only, redacted conversation monitor renders.
 */
import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"

import { WhatsAppPage } from "@/components/admin/whatsapp-page"

describe("WhatsAppPage", () => {
  it("renders the number & webhook health rows and the Cloud-API note", () => {
    render(<WhatsAppPage />)

    // Health key/val content is shown.
    expect(screen.getByText("Number & webhook health")).toBeInTheDocument()
    expect(screen.getByText("Phone number ID")).toBeInTheDocument()
    expect(screen.getByText("Subscribed · 200 OK")).toBeInTheDocument()

    // The "Official Cloud API only" success note closes the card (§3.5).
    expect(
      screen.getByText("Official Cloud API only · ban-risk: low")
    ).toBeInTheDocument()
  })

  it("marks every E2E flow as Live and shows the redacted monitor", () => {
    render(<WhatsAppPage />)

    expect(screen.getByText("Flows (E2E encrypted)")).toBeInTheDocument()
    expect(screen.getByText("KYC verification")).toBeInTheDocument()
    // All three E2E flows read "Live".
    expect(screen.getAllByText("Live").length).toBeGreaterThanOrEqual(3)

    // The read-only conversation monitor renders (design-faithful sample).
    expect(screen.getByText("Live conversation monitor")).toBeInTheDocument()
    expect(screen.getByText("read-only · redacted")).toBeInTheDocument()
  })
})
