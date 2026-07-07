/**
 * Pure parsing helpers for the "Draft compliance report" (SAR/STR) form.
 * Both are display-boundary validators only — the authoritative validation is
 * the `ComplianceReportDraftRequestSchema` parse the engine re-runs server-side
 * (§3.1). These just turn raw textarea input into typed values + inline errors.
 */

/** Result of parsing the raw "Content (JSON)" textarea. */
export type ParsedReportContent =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; error: string }

/**
 * Parse the report content textarea. It must be a JSON *object* — arrays, null,
 * and primitives are rejected with a distinct message so the operator knows
 * whether the JSON was malformed or merely the wrong shape.
 */
export function parseReportContent(raw: string): ParsedReportContent {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return { ok: false, error: "Content is not valid JSON." }
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: "Content must be a JSON object." }
  }
  return { ok: true, value: value as Record<string, unknown> }
}

/** Split the newline-separated "Related event ids" textarea into trimmed, non-empty ids. */
export function parseRelatedEvents(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
}
