import { render, screen, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { DataTable } from "./data-table"
import type { DataTableColumn } from "@/types/data-table"

interface Row {
  id: string
  name: string
  value: string
}
const rows: Row[] = [
  { id: "1", name: "USDT", value: "$10" },
  { id: "2", name: "TRX", value: "$2" },
]
const columns: DataTableColumn<Row>[] = [
  { key: "name", header: "Asset", render: (r) => r.name },
  { key: "value", header: "Value", align: "right", render: (r) => r.value },
]

describe("DataTable", () => {
  it("renders a named table with headers and one row per item", () => {
    render(
      <DataTable
        ariaLabel="Assets"
        columns={columns}
        rows={rows}
        getRowKey={(r) => r.id}
      />
    )
    const table = screen.getByRole("table", { name: "Assets" })
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((h) => h.textContent)
    ).toEqual(["Asset", "Value"])
    // header row + 2 data rows
    expect(within(table).getAllByRole("row")).toHaveLength(3)
    expect(within(table).getByText("TRX")).toBeInTheDocument()
  })

  it("hides the header row but stays a table when hideHeader is set", () => {
    render(
      <DataTable
        ariaLabel="Recent activity"
        columns={columns}
        rows={rows}
        getRowKey={(r) => r.id}
        hideHeader
      />
    )
    const table = screen.getByRole("table", { name: "Recent activity" })
    expect(within(table).queryAllByRole("columnheader")).toHaveLength(0)
    expect(within(table).getAllByRole("row")).toHaveLength(2)
  })

  it("renders the empty fallback when there are no rows", () => {
    render(
      <DataTable
        ariaLabel="Assets"
        columns={columns}
        rows={[]}
        getRowKey={(r) => r.id}
        empty={<p>Nothing yet</p>}
      />
    )
    expect(screen.getByText("Nothing yet")).toBeInTheDocument()
    expect(screen.queryByRole("table")).not.toBeInTheDocument()
  })
})
