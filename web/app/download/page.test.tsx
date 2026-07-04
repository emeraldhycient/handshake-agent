import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import DownloadPage from "./page"

describe("/download", () => {
  it("renders the install experience inside a main landmark", () => {
    render(<DownloadPage />)
    expect(screen.getByRole("main")).toBeInTheDocument()
    expect(
      screen.getByRole("heading", { name: /install handshake agent/i })
    ).toBeInTheDocument()
  })
})
