import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"

vi.mock("@/components/settings/settings-panel", () => ({
  SettingsPanel: (props: { density?: string }) => (
    <div
      data-testid="settings-panel"
      data-density={props.density ?? "desktop"}
    />
  ),
}))

import { SettingsPage } from "./settings-page"

describe("SettingsPage (desktop)", () => {
  it("renders the shared SettingsPanel at desktop density", () => {
    render(<SettingsPage />)
    const panel = screen.getByTestId("settings-panel")
    expect(panel).toBeInTheDocument()
    expect(panel).toHaveAttribute("data-density", "desktop")
  })
})
