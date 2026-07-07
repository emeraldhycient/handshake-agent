import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { PageHeader } from "@/components/admin/page-header"

describe("PageHeader", () => {
  it("renders the title as a level-1 heading", () => {
    render(<PageHeader title="Admins & roles" />)
    expect(
      screen.getByRole("heading", { level: 1, name: "Admins & roles" })
    ).toBeInTheDocument()
  })

  it("renders a subtitle node and right-aligned actions when provided", () => {
    render(
      <PageHeader
        title="Users"
        subtitle={<span>12 shown</span>}
        actions={<button>Invite</button>}
      />
    )
    expect(screen.getByText("12 shown")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Invite" })).toBeInTheDocument()
  })

  it("omits the subtitle paragraph when none is given", () => {
    const { container } = render(<PageHeader title="Ops" />)
    expect(container.querySelector("p")).toBeNull()
  })
})
