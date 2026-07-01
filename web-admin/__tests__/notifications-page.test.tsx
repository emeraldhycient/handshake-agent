/**
 * TemplatesPage render test (design reproduction).
 *
 * During the operator-console re-skin, TemplatesPage was rebuilt as a
 * pixel-faithful, read-only reproduction of the design's Templates screen: a grid of
 * template preview cards rendered from module-level sample content (no
 * `@/lib/api/notifications`, no editor dialog, no preview mutation, no
 * step-up-on-403). The old behavioural tests drove the editor + preview + step-up
 * api, none of which the reproduction has, so they are replaced with a render test
 * asserting the reproduced design content: the heading, a channel chip, a mock
 * template name + approval pill, and a rendered body preview.
 */
import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"

import { TemplatesPage } from "@/components/admin/templates-page"

describe("TemplatesPage (design reproduction)", () => {
  it("renders the header and channel chips", () => {
    render(<TemplatesPage />)

    expect(
      screen.getByRole("heading", { name: "Templates" })
    ).toBeInTheDocument()
    // Both channel chips appear (Email via Resend, WhatsApp approved templates).
    expect(screen.getAllByText("WhatsApp").length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText("Email").length).toBeGreaterThanOrEqual(1)
  })

  it("renders a mock template card with its name, approval pill and body", () => {
    render(<TemplatesPage />)

    // A known mock template from the design-faithful sample content.
    expect(screen.getByText("kyc_verified_v2")).toBeInTheDocument()
    // Its approval pill.
    expect(screen.getAllByText("Approved").length).toBeGreaterThanOrEqual(1)
    // The rendered body preview text.
    expect(screen.getByText(/your identity is verified/i)).toBeInTheDocument()
  })
})
