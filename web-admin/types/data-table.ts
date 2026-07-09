import type { ReactNode } from "react"

/** One column of a DataTable. */
export interface DataTableColumn<Row> {
  /** Stable key for the column (React key for cells). */
  key: string
  /** Header content (not shown when the table hides its header). */
  header: ReactNode
  /** Cell + header text alignment. Default "left". */
  align?: "left" | "right" | "center"
  /** Optional fixed-width utility class, e.g. "w-[42%]". */
  widthClassName?: string
  /** Extra classes for the body cell. */
  cellClassName?: string
  /** Render the body cell for a row. */
  render: (row: Row) => ReactNode
}

/** Props for the generic, column-config-driven DataTable. */
export interface DataTableProps<Row> {
  /** Accessible name (aria-label) — a table must be identifiable, esp. with >1 on a page. */
  ariaLabel: string
  columns: DataTableColumn<Row>[]
  rows: Row[]
  getRowKey: (row: Row, index: number) => string
  /** Render rows without a visible header row (still a semantic table). */
  hideHeader?: boolean
  /** Rendered instead of the table when rows is empty. */
  empty?: ReactNode
  className?: string
}
