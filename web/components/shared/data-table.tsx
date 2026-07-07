import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { cn } from "@/lib/utils"
import type { DataTableColumn, DataTableProps } from "@/types/data-table"

const ALIGN: Record<NonNullable<DataTableColumn<unknown>["align"]>, string> = {
  left: "text-left",
  right: "text-right",
  center: "text-center",
}

/**
 * Column-config-driven table. Presentational only (no data fetching) — the
 * single canonical way to render a list of records (root §13.1). Renders a real
 * <table> via the Table primitive; `hideHeader` keeps table semantics without a
 * visible header row; `empty` replaces the table when there are no rows.
 */
export function DataTable<Row>({
  ariaLabel,
  columns,
  rows,
  getRowKey,
  hideHeader = false,
  empty,
  className,
}: DataTableProps<Row>) {
  if (rows.length === 0 && empty !== undefined) return <>{empty}</>

  return (
    <Table aria-label={ariaLabel} className={className}>
      {!hideHeader && (
        <TableHeader>
          <TableRow>
            {columns.map((col) => (
              <TableHead
                key={col.key}
                className={cn(
                  col.widthClassName,
                  col.align && ALIGN[col.align]
                )}
              >
                {col.header}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
      )}
      <TableBody>
        {rows.map((row, i) => (
          <TableRow key={getRowKey(row, i)}>
            {columns.map((col) => (
              <TableCell
                key={col.key}
                className={cn(col.align && ALIGN[col.align], col.cellClassName)}
              >
                {col.render(row)}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
