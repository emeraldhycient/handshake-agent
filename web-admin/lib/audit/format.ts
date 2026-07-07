/**
 * The design's `actColor(action)` helper (logic.js line 783): maps an action to its
 * mono-chip token pair by keyword, reproduced 1:1 as Tailwind token classes.
 */
export function actionChip(action: string): string {
  if (/reject|freeze|fail|block|violation|override/.test(action))
    return "bg-sdn text-tdn"
  if (/pii/.test(action)) return "bg-sdn text-tdn"
  if (/config|update|pricing/.test(action)) return "bg-swn text-twn"
  if (/ledger|settle|credit|approve|confirm|execute|authorize/.test(action))
    return "bg-sok text-tok"
  return "bg-sif text-tif"
}

/** Render a nullable `unknown` before/after value as a compact display string. */
export function displayValue(value: unknown): string {
  if (value === null || value === undefined) return "—"
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean")
    return String(value)
  return JSON.stringify(value)
}

/** Format the ISO `createdAt` as the design's mono "Mon D · HH:MM:SS" timestamp. */
export function formatTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  const day = date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  })
  const time = date.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
  return `${day} · ${time}`
}
