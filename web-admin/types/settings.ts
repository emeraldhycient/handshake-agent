/** Settings page (§6.30) — the layered-config console. */

import type { EffectiveSetting } from "@handshake-agent/contracts"

// ─── Settings page (layered-config console, design §6.30) ────────────────────────────

/** The config layer a key resolved from — `db` (an admin override) vs env/JSON baseline. */
export type SettingSource = "DB" | "Baseline"

/** The settings edit chain: value → reason → confirm → the step-up-guarded PATCH. */
export type SettingsFlowStep = "value" | "reason" | "maker" | null

/** One design-reproduction settings row, mapped from a real `EffectiveSetting`. */
export interface SettingRow {
  key: string
  /** The resolved effective value, formatted (mono / tabular). */
  val: string
  /** The winning config layer — 'DB' for an override, else 'Baseline' (env/JSON). */
  src: SettingSource
  /** The value's type — shown in the key meta line (`valueType`). */
  type: string
  /** The registry `valueType` — drives the value-entry control + coercion. */
  valueType: EffectiveSetting["valueType"]
  desc: string
  /** A human resolution line for the source chip tooltip. */
  chain: readonly string[]
  /** Whether the row is editable from the console (DB-layer keys only). */
  editable: boolean
  /** The raw effective value, used to seed the value-entry control. */
  rawValue: unknown
  scope: EffectiveSetting["scope"]
  scopeValue: string | null
}

/** One body row of the settings grid. */
export interface SettingsTableRowProps {
  row: SettingRow
  onEdit: (row: SettingRow) => void
}

/** The settings table card — header + loading / error / empty / data. */
export interface SettingsTableProps {
  rows: SettingRow[]
  totalCount: number
  isLoading: boolean
  isError: boolean
  isSuccess: boolean
  search: string
  onRetry: () => void
  onEdit: (row: SettingRow) => void
}

/** The value-entry modal (step 0 of the edit chain). */
export interface SettingValueModalProps {
  open: boolean
  row: SettingRow | null
  onOpenChange: (open: boolean) => void
  onContinue: (value: unknown, display: string) => void
}

/** The value-entry form body — mounted only while open so it seeds from `row`. */
export interface SettingValueFormProps {
  row: SettingRow
  onContinue: (value: unknown, display: string) => void
}
