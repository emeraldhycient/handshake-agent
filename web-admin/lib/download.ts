/**
 * Trigger a browser download of an in-memory Blob (used by the CSV export clients).
 * Creates a temporary object URL + a synthetic anchor click, then revokes the URL
 * on the next tick so the browser has started the download. Lives in `lib/` (no
 * component/app imports); the export clients in `lib/api/*` hand it the blob and a
 * filename derived from the server's Content-Disposition, or a sensible default.
 */
export function downloadFile(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = filename
  anchor.style.display = "none"
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  // Revoke after the click has been dispatched so the download isn't cancelled.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

/**
 * Best-effort filename for an export: `${subject}-export-YYYY-MM-DD.csv`. The
 * server also sets Content-Disposition; this is the fallback when it's absent.
 */
export function exportFilename(subject: string): string {
  const day = new Date().toISOString().slice(0, 10)
  return `${subject}-export-${day}.csv`
}
