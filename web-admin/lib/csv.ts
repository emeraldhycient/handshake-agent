/**
 * CSV export helpers (go-readiness #7 — per-area export). `toCsv` is a pure
 * RFC-4180 serializer; `downloadCsv` triggers a client-side file download. This
 * file lives in `lib/` (the only layer that talks to the world) — components call
 * `downloadCsv`, they never build Blobs/anchors themselves.
 */

/** A single CSV cell — coerced to its string form (numbers keep full precision). */
type Cell = string | number

/** True when a field must be quoted per RFC 4180 (comma, quote, CR or LF). */
function needsQuoting(field: string): boolean {
  return /[",\r\n]/.test(field)
}

/** Escape one field: double embedded quotes and wrap when required. */
function escapeField(value: Cell): string {
  const s = String(value)
  return needsQuoting(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/**
 * Serialize a header + rows into an RFC-4180 CSV string (CRLF row separator).
 * Numbers are stringified; fields with commas/quotes/newlines are quoted. An empty
 * `rows` yields just the header line.
 */
export function toCsv(headers: readonly string[], rows: readonly Cell[][]): string {
  const lines = [headers.map(escapeField).join(",")]
  for (const row of rows) {
    lines.push(row.map(escapeField).join(","))
  }
  return lines.join("\r\n")
}

/**
 * Download `csv` as `filename` in the browser (no-op outside a DOM, e.g. SSR).
 * Uses a Blob object URL + a transient anchor click, revoking the URL after.
 */
export function downloadCsv(filename: string, csv: string): void {
  if (typeof document === "undefined") return
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}
