import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import { DownloadExperience } from "./download-experience"

describe("DownloadExperience (/download page body)", () => {
  it("has a clear install heading", () => {
    render(<DownloadExperience />)
    expect(
      screen.getByRole("heading", { name: /install handshake agent/i })
    ).toBeInTheDocument()
  })

  it("renders a scannable QR to share the install link", () => {
    render(<DownloadExperience />)
    expect(screen.getByRole("img", { name: /scan/i })).toBeInTheDocument()
  })

  it("shows platform install guidance", () => {
    // jsdom is neither promptable nor iOS → the generic browser hint appears.
    render(<DownloadExperience />)
    expect(
      screen.getByText(/install icon in the address bar/i)
    ).toBeInTheDocument()
  })
})
