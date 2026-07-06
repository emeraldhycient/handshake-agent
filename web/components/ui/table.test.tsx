import { render, screen, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "./table"

describe("Table primitive", () => {
  it("renders a semantic table with column headers and rows", () => {
    render(
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Asset</TableHead>
            <TableHead>Value</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell>USDT</TableCell>
            <TableCell>$10</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    )
    const table = screen.getByRole("table")
    const headers = within(table)
      .getAllByRole("columnheader")
      .map((h) => h.textContent)
    expect(headers).toEqual(["Asset", "Value"])
    expect(within(table).getAllByRole("row")).toHaveLength(2)
  })

  it("marks header cells with scope=col for a11y", () => {
    render(
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Asset</TableHead>
          </TableRow>
        </TableHeader>
      </Table>
    )
    expect(screen.getByRole("columnheader")).toHaveAttribute("scope", "col")
  })

  it("merges custom className onto the cell", () => {
    render(
      <Table>
        <TableBody>
          <TableRow>
            <TableCell className="text-right">x</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    )
    expect(screen.getByRole("cell")).toHaveClass("text-right")
  })
})
