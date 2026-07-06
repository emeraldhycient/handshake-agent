import { cn } from "@/lib/utils"
import type { FormAlertProps } from "@/types/forms"

const TONES = {
  danger: "border-destructive bg-destructive/10 text-destructive",
  warn: "border-warn bg-warn/10 text-warn-foreground",
} as const

/** Assertive inline form alert (server errors, lockouts). Tone-driven, tokens only. */
export function FormAlert({
  children,
  tone = "danger",
  className,
}: FormAlertProps) {
  return (
    <div
      role="alert"
      aria-live="assertive"
      className={cn(
        "rounded-lg border px-4 py-3 text-sm",
        TONES[tone],
        className
      )}
    >
      {children}
    </div>
  )
}
