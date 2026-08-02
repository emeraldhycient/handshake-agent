/** The shared flow modals — step-up, reason, engine action, maker-checker. */

// ─── Step-up flow ────────────────────────────────────────────────────────────────

export interface StepUpDialogProps {
  open: boolean
  /** Whether the signed-in admin has MFA enabled (drives password vs TOTP). */
  mfaEnabled: boolean
  /** Called after a successful step-up — the caller retries its mutation. */
  onSuccess: () => void
  onOpenChange: (open: boolean) => void
}

export interface MfaEnrollDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

// ─── Shared flow modals (design template §5 "Flow modals", lines 1161-1259) ─────────
// The funds-safety flow modals share one frame (fixed scrim rgba(10,20,15,0.55)
// + blur, centred radius-20 panel, flow shadow, hsPop). Each is opened by a caller
// (`open` + `onOpenChange`) and takes the design's per-step content props. They are
// pure presentation — they do NOT move money; a real callsite wires their submit to a
// mutation. Built on the shared Dialog primitive (focus-trap + Esc close).

/** A base shape every flow modal shares: open-state + a required action title. */
export interface FlowModalBaseProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The action being authorized (interpolated into the modal copy). */
  title: string
}

/**
 * ReasonModal (design line 1166) — blue document icon, "recorded in the immutable
 * audit log" copy, reason-category chips, a required free-text reason, Cancel /
 * Continue. `onContinue` receives the entered reason + selected category.
 */
export interface ReasonModalProps extends FlowModalBaseProps {
  /** Called with the captured reason once a reason of `minLength`+ chars is entered. */
  onContinue: (reason: string, category: string) => void
  /** Override the reason-category chips (defaults to the design's five). */
  categories?: readonly string[]
  /**
   * Minimum trimmed reason length before Continue enables. Defaults to 1 (any
   * non-empty reason). Four-eyes ChangeRequest flows pass 3 to mirror the api's
   * `CreateChangeRequestSchema.reason` floor so a too-short reason can never raise.
   */
  minLength?: number
}

/** One "Itemized effect" key/value row in the engine-action modal. */
export interface EngineEffectRow {
  /** The effect label (left, muted). */
  k: string
  /** The effect value (right, mono/tabular, bold). */
  v: string
}

/** One "Ledger entries to be written" row in the engine-action modal. */
export interface EngineLedgerRow {
  /** The double-entry account (mono). */
  acct: string
  /** Direction — `DR` (debit) tints danger, `CR` (credit) tints success. */
  dir: "DR" | "CR"
  /** The signed amount (right, mono/tabular). */
  amt: string
}

/**
 * EngineActionModal (design line 1198) — green "executed by the settlement engine"
 * banner, an itemized-effect table, a ledger-entries table, a dashed idempotency-key
 * box, Cancel / amber execute CTA. `onExecute` fires when the amber CTA is pressed.
 */
export interface EngineActionModalProps extends FlowModalBaseProps {
  /** The itemized effect rows shown before execution. */
  effect: EngineEffectRow[]
  /** The double-entry rows the engine will write. */
  ledger: EngineLedgerRow[]
  /** The idempotency key that guards this execution (mono; copyable). */
  idempotencyKey: string
  /** The amber CTA label (defaults to "Execute via engine"). */
  cta?: string
  /** Fired when the operator presses the execute CTA. */
  onExecute: () => void
}

/**
 * ManualCreditModal — the input step for a manual wallet credit (Phase 7 WRITE).
 * Collects the asset (from the user's live wallet assets) + a positive amount, then
 * hands them to the flow via `onContinue`. It is presentation only: it moves no money
 * (the engine-brokered credit runs only after reason → step-up → maker-checker →
 * approval by a SECOND admin, §3.1). The Continue CTA activates only for a valid,
 * positive amount.
 */
export interface ManualCreditModalProps extends FlowModalBaseProps {
  /** The assets the operator can credit (the user's live wallet assets). */
  assets: readonly string[]
  /** Called with the chosen asset + entered amount once both are valid. */
  onContinue: (asset: string, amount: string) => void
}

/** One from→to diff row in the maker-checker modal. */
export interface MakerCheckerDiffRow {
  /** The changed field's label. */
  field: string
  /** The current value (struck-through, danger tone). */
  from: string
  /** The proposed value (success tone). */
  to: string
}

/**
 * How a confirmed change takes effect — drives the modal's honest copy.
 * `immediate`: applies as soon as the operator confirms (step-up-gated, audited).
 * `dual-control`: raises a ChangeRequest a SECOND admin must approve (four-eyes).
 */
export type MakerCheckerMode = "immediate" | "dual-control"

/**
 * MakerCheckerModal (design line 1214) — amber shield icon, a from→to
 * change-preview table, Cancel / dark confirm CTA. The copy is honest per `mode`:
 * only a surface that actually raises a ChangeRequest may claim "Pending
 * approval". `onSubmit` fires when the dark CTA is pressed.
 */
export interface MakerCheckerModalProps extends FlowModalBaseProps {
  /** The itemized change preview (from→to per field). */
  diff: MakerCheckerDiffRow[]
  /** Fired when the operator confirms (immediate) / submits for approval (dual-control). */
  onSubmit: () => void
  /** Defaults to "immediate" — the honest copy for direct step-up-gated writes. */
  mode?: MakerCheckerMode
}
