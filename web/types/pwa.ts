/** Prop types for the PWA install affordance (`components/pwa/`). */

// ─── PWA install affordance ───────────────────────────────────────────────────

/** Icon-button that opens the install modal; hides itself once installed. */
export interface InstallButtonProps {
  /** Visual placement — "chrome" (topbar icon) or "header" (dark header icon). */
  tone?: "chrome" | "header"
  className?: string
}

/** Controlled install modal (uses the Dialog primitive — focus trap + Esc). */
export interface InstallModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * Presentational install guidance — the branch shown depends on capability:
 * a native install button (Chromium), iOS "Add to Home Screen" steps, or a
 * generic browser hint. Reused by the install modal and the /download page.
 */
export interface InstallInstructionsProps {
  /** A native prompt is available — render the one-tap install button. */
  canPrompt: boolean
  /** iOS Safari — render manual "Add to Home Screen" steps. */
  isIOS: boolean
  /** The native prompt is in flight — disable the button. */
  installing: boolean
  /** Fire the native prompt. */
  onInstall: () => void
  className?: string
}
