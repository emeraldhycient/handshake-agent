"use client"

import { useEffect, useMemo, useState } from "react"

import { useAudit, useVerifyAuditChain } from "@/lib/query/hooks"
import { pushToast } from "@/lib/store/toast-store"
import { downloadFile, exportFilename } from "@/lib/download"
import { exportAuditLog } from "@/lib/api/admin"
import { PAGE_SIZE } from "@/constants/audit"
import type { AuditLogQuery } from "@handshake-agent/contracts"

/**
 * The audit-log view-model: the server-side filter inputs (debounced search → `subject`,
 * action enum, from/to range), the keyset cursor stack, the CSV export, and the on-mount
 * hash-chain verify. Read-only; every filter change resets pagination to the first page.
 * Extracted so the page is pure composition.
 */
export function useAuditLog() {
  const [search, setSearch] = useState("")
  const [subject, setSubject] = useState("")
  const [action, setAction] = useState("all")
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")

  // Keyset cursor stack: the last entry is the current page's cursor; an empty stack is
  // the first (uncursored) page. Reset whenever a filter changes.
  const [cursors, setCursors] = useState<readonly string[]>([])
  const cursor = cursors.length > 0 ? cursors[cursors.length - 1] : undefined

  useEffect(() => {
    const timer = setTimeout(() => setSubject(search.trim()), 250)
    return () => clearTimeout(timer)
  }, [search])

  const query = useMemo<AuditLogQuery>(
    () => ({
      ...(subject ? { subject } : {}),
      ...(action !== "all"
        ? { action: action as AuditLogQuery["action"] }
        : {}),
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
      ...(cursor ? { cursor } : {}),
      limit: PAGE_SIZE,
    }),
    [subject, action, from, to, cursor]
  )

  const audit = useAudit(query)
  const verify = useVerifyAuditChain()
  const [exporting, setExporting] = useState(false)

  /** Download a CSV of the audit entries matching the current filters. */
  async function onExport() {
    if (exporting) return
    setExporting(true)
    try {
      const blob = await exportAuditLog(query)
      downloadFile(blob, exportFilename("audit"))
    } catch {
      pushToast("Couldn't export the audit log. Try again.", "warn")
    } finally {
      setExporting(false)
    }
  }

  // Run the chain-integrity verify once on mount so the header pill is real.
  useEffect(() => {
    verify.mutate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Any filter change resets keyset pagination back to the first page.
  function resetPaging() {
    setCursors([])
  }

  function onFilter(setter: (value: string) => void) {
    return (value: string) => {
      setter(value)
      resetPaging()
    }
  }

  const items = audit.data?.items ?? []
  const nextCursor = audit.data?.nextCursor ?? null

  function goPrev() {
    setCursors((prev) => prev.slice(0, -1))
  }
  function goNext() {
    if (nextCursor) setCursors((prev) => [...prev, nextCursor])
  }

  return {
    audit,
    verify,
    items,
    nextCursor,
    cursors,
    exporting,
    onExport,
    goPrev,
    goNext,
    search,
    action,
    from,
    to,
    onSearchChange: onFilter(setSearch),
    onActionChange: onFilter(setAction),
    onFromChange: onFilter(setFrom),
    onToChange: onFilter(setTo),
  }
}
