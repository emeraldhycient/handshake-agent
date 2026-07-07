"use client"

import { useMemo, useState } from "react"
import type { AdminLedgerListQuery } from "@handshake-agent/contracts"

import { useGlobalLedger, useLedgerIntegrity } from "@/lib/query/hooks"
import { exportLedger as exportLedgerCsv } from "@/lib/api/ledger"
import { downloadFile, exportFilename } from "@/lib/download"
import { pushToast } from "@/lib/store/toast-store"
import { integrityPill, toRows } from "@/lib/ledger/rows"
import { PAGE_SIZE } from "@/constants/ledger"

/**
 * The ledger viewer's data layer: the account-type + currency filters resolve into a
 * single keyset query over the GLOBAL cross-account ledger, plus the sequence-integrity
 * summary for the header pill. Read-only (§3.1) — nothing here moves money; Export
 * downloads a CSV of the current filter's legs.
 */
export function useLedgerViewer() {
  const [account, setAccount] = useState("")
  const [currency, setCurrency] = useState("")

  // Both filters are optional; empty → omit the param (global across that axis).
  const filters: AdminLedgerListQuery = useMemo(
    () => ({
      ...(account ? { accountType: account } : {}),
      ...(currency ? { currency } : {}),
      limit: PAGE_SIZE,
    }),
    [account, currency]
  )

  const ledger = useGlobalLedger(filters)
  const integrity = useLedgerIntegrity()

  const rows = useMemo(
    () => toRows(ledger.data?.pages.flatMap((p) => p.entries) ?? []),
    [ledger.data]
  )

  const [exporting, setExporting] = useState(false)

  /** Download a CSV of the ledger legs matching the current global-browse filters. */
  async function exportLedger() {
    if (exporting) return
    setExporting(true)
    try {
      const blob = await exportLedgerCsv(filters)
      downloadFile(blob, exportFilename("ledger"))
    } catch {
      pushToast("Couldn't export the ledger. Try again.", "warn")
    } finally {
      setExporting(false)
    }
  }

  const pill = integrityPill(integrity.data)

  return {
    account,
    setAccount,
    currency,
    setCurrency,
    ledger,
    rows,
    exporting,
    exportLedger,
    pill,
  }
}
