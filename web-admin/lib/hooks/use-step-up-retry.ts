/**
 * useStepUpRetry — shared step-up-then-retry flow for sensitive mutations.
 *
 * Wraps an async action: run it; if it rejects with an ApiError carrying code
 * `ADMIN_STEP_UP_REQUIRED`, stash the action and open the step-up dialog. After
 * the operator re-authenticates, `retry()` replays the stashed action.
 *
 * Lives in `lib/` (a hook with no component imports) so both the admins page and
 * any future sensitive surface reuse one implementation (root §13.2).
 */
import { useCallback, useRef, useState } from "react"

import { ApiError } from "@/lib/api/client"

const STEP_UP_CODE = "ADMIN_STEP_UP_REQUIRED"

export interface StepUpRetry {
  /** True while the step-up dialog should be shown. */
  open: boolean
  setOpen: (open: boolean) => void
  /**
   * Run a sensitive action. Returns true if it completed; false if it triggered
   * a step-up challenge (the dialog is now open and the action is stashed).
   * Re-throws any non-step-up error for the caller's own handling.
   */
  run: (action: () => Promise<void>) => Promise<boolean>
  /** Replay the stashed action after a successful step-up. */
  retry: () => Promise<boolean>
}

function isStepUpError(error: unknown): boolean {
  return error instanceof ApiError && error.code === STEP_UP_CODE
}

export function useStepUpRetry(): StepUpRetry {
  const [open, setOpen] = useState(false)
  const pending = useRef<(() => Promise<void>) | null>(null)

  const run = useCallback(async (action: () => Promise<void>) => {
    try {
      await action()
      pending.current = null
      return true
    } catch (error) {
      if (isStepUpError(error)) {
        pending.current = action
        setOpen(true)
        return false
      }
      throw error
    }
  }, [])

  const retry = useCallback(async () => {
    const action = pending.current
    if (!action) return false
    await action()
    pending.current = null
    return true
  }, [])

  return { open, setOpen, run, retry }
}
