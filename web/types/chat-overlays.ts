/** Prop types for the chat overlays (`components/chat/overlays/`). */

import type { ConfirmPayload } from "@/lib/schemas"
import type { Density } from "./shared"

// ─── Phase 13 overlay components ──────────────────────────────────────────────

/** 13.1 */
export interface ConfirmSheetProps {
  open: boolean
  payload: ConfirmPayload | null
  density: Density
  /** May be async — triggers authorizeProposal in the authenticated flow. */
  onConfirm: () => void | Promise<void>
  onCancel: () => void
  /** Error message shown when authorize fails (wrong state, expired, etc.). */
  error?: string | null
  /** True while authorizeProposal is in flight — disables the CTA. */
  authorizing?: boolean
}

/** 13.2 */
export interface PinPadProps {
  open: boolean
  /** Number of digits entered so far (0–4). Controls filled dot count. */
  pinLength: number
  density: Density
  onDigit: (d: string) => void
  onBack: () => void
  onFaceId: () => void
  onCancel: () => void
  /** Error message shown below the dots after a wrong PIN / expired directive. */
  error?: string | null
  /** Alias for `error` — preferred when passed from the store's `pinError` field. */
  errorText?: string
}

/** 13.3 */
export interface SuccessOverlayProps {
  open: boolean
  text: string
}
