import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import {
  SectionCard,
  SettingRow,
  RowButton,
  DangerButton,
} from "./section-card"

describe("SectionCard", () => {
  it("renders the label, an optional action and children", () => {
    render(
      <SectionCard
        label="Account"
        density="desktop"
        action={<button>Create token</button>}
      >
        <div>row</div>
      </SectionCard>
    )
    expect(screen.getByText("Account")).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Create token" })
    ).toBeInTheDocument()
    expect(screen.getByText("row")).toBeInTheDocument()
  })
})

describe("SettingRow", () => {
  it("renders icon, title, subtitle, trailing and the below slot", () => {
    render(
      <SettingRow
        density="desktop"
        icon={<span data-testid="icon" />}
        title="Name"
        subtitle="olivia lee"
        trailing={<span data-testid="trailing" />}
        below={<span data-testid="below" />}
      />
    )
    expect(screen.getByTestId("icon")).toBeInTheDocument()
    expect(screen.getByText("Name")).toBeInTheDocument()
    expect(screen.getByText("olivia lee")).toBeInTheDocument()
    expect(screen.getByTestId("trailing")).toBeInTheDocument()
    expect(screen.getByTestId("below")).toBeInTheDocument()
  })
})

describe("row buttons", () => {
  it("RowButton and DangerButton fire onClick", async () => {
    const onRow = vi.fn()
    const onDanger = vi.fn()
    render(
      <>
        <RowButton density="desktop" onClick={onRow}>
          Edit
        </RowButton>
        <DangerButton density="desktop" onClick={onDanger}>
          Revoke
        </DangerButton>
      </>
    )
    await userEvent.click(screen.getByRole("button", { name: "Edit" }))
    await userEvent.click(screen.getByRole("button", { name: "Revoke" }))
    expect(onRow).toHaveBeenCalled()
    expect(onDanger).toHaveBeenCalled()
  })
})
