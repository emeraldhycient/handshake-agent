"use client"

import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useTravelRule } from "@/lib/query/hooks"
import { formatCrypto, formatFiat } from "@/lib/format"
import {
  ErrorPanel,
  LoadingRows,
  TableCard,
  EmptyNote,
} from "@/components/admin/compliance/compliance-shells"
import { formatDate } from "@/lib/compliance/format"

/** Travel Rule tab — qualifying-transfer capture (read-only). */
export function TravelRuleTab() {
  const travel = useTravelRule()

  if (travel.isLoading) return <LoadingRows />
  if (travel.isError) return <ErrorPanel what="Travel Rule records" />
  if (travel.isSuccess && travel.data.items.length === 0) {
    return <EmptyNote>No Travel Rule records.</EmptyNote>
  }
  if (!travel.isSuccess) return null

  return (
    <TableCard>
      <TableHeader>
        <TableRow>
          <TableHead>Transaction</TableHead>
          <TableHead className="text-right">Amount</TableHead>
          <TableHead className="text-right">Fiat</TableHead>
          <TableHead>Trigger</TableHead>
          <TableHead>Reported</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {travel.data.items.map((item) => (
          <TableRow key={item.id}>
            <TableCell className="font-mono text-xs text-ink2">
              {item.transactionId.slice(0, 8)}…
            </TableCell>
            <TableCell className="text-right font-mono text-ink tabular-nums">
              {formatCrypto(item.amount, item.asset)}
            </TableCell>
            {/* The fiat-equivalent snapshot in the currency it was valued in at
                capture time (item.fiatCurrency) — never an assumed NGN. */}
            <TableCell className="text-right text-ink2 tabular-nums">
              {formatFiat(item.amountFiat, item.fiatCurrency)}
            </TableCell>
            <TableCell className="text-ink2">{item.triggeringFactor}</TableCell>
            <TableCell className="text-ink2 tabular-nums">
              {formatDate(item.reportedAt)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </TableCard>
  )
}
