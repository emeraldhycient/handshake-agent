import type { EffectiveSetting } from "@handshake-agent/contracts"

import type { SettingRow, SettingSource } from "@/types/components"

/**
 * Render an effective value (whose runtime type matches its `valueType`) as the mono
 * display string the design shows. Numbers get grouped thousands; string[] joins with a
 * comma; booleans/strings stringify directly; nullish → "—".
 */
export function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "—"
  if (typeof value === "number") return value.toLocaleString()
  if (typeof value === "boolean") return String(value)
  if (Array.isArray(value))
    return value.length === 0 ? "(empty)" : value.join(", ")
  return String(value)
}

/** Map one real EffectiveSetting onto the design's row shape. */
export function toRow(s: EffectiveSetting): SettingRow {
  const isDb = s.source === "db"
  const val = formatValue(s.value)
  return {
    key: s.key,
    val,
    src: isDb ? "DB" : "Baseline",
    type: s.valueType,
    valueType: s.valueType,
    desc: s.description,
    // The contract exposes only db-override-vs-baseline, so the resolution line is the
    // two layers we can actually distinguish (no ENV-vs-JSON split — shapeGap).
    chain: isDb
      ? [`DB override: ${val}`, "Baseline (ENV / JSON): overridden"]
      : ["DB override: (none)", `Baseline (ENV / JSON): ${val}`],
    editable: s.editable && isDb,
    rawValue: s.value,
    scope: s.scope,
    scopeValue: s.scopeValue,
  }
}

/**
 * The design's per-source chip tint: a DB override is the top of the chain (info
 * surface/text); the env/JSON baseline resolves to the neutral sub-surface.
 */
export function sourceTint(src: SettingSource): string {
  return src === "DB" ? "bg-sif text-tif" : "bg-card2 text-ink2"
}

/** The from→to change the maker-checker review shows for a DB-layer key. */
export function settingDiff(
  row: SettingRow,
  nextDisplay: string
): { field: string; from: string; to: string }[] {
  return [{ field: row.key, from: row.val, to: nextDisplay }]
}

/**
 * Coerce the value-entry field's raw string back to the key's `valueType`, matching the
 * server's registry schema (number → Number, boolean → the select's true/false, string[]
 * → comma-split, string → as-is). Returns a validation error for a non-numeric numeric
 * input rather than silently sending NaN.
 */
export function coerceValue(
  valueType: SettingRow["valueType"],
  raw: string
): { ok: true; value: unknown } | { ok: false; error: string } {
  switch (valueType) {
    case "number": {
      const n = Number(raw.trim())
      if (raw.trim() === "" || Number.isNaN(n))
        return { ok: false, error: "Enter a valid number." }
      return { ok: true, value: n }
    }
    case "boolean":
      return { ok: true, value: raw === "true" }
    case "string[]":
      return {
        ok: true,
        value: raw
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s.length > 0),
      }
    case "string":
      return { ok: true, value: raw }
  }
}

/** Seed the value-entry field from the current effective value for editing. */
export function seedInput(row: SettingRow): string {
  const v = row.rawValue
  if (Array.isArray(v)) return v.join(", ")
  if (v === null || v === undefined) return ""
  return String(v)
}
