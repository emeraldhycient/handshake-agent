import type { InputHTMLAttributes, ReactNode } from "react"

/** Props for the shared FormAlert (assertive inline form error). */
export interface FormAlertProps {
  children: ReactNode
  /** "danger" (default) for errors, "warn" for lockouts/soft blocks. */
  tone?: "danger" | "warn"
  className?: string
}

/** Props for the shared FormField (labeled input + inline error). */
export interface FormFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  id: string
  label: ReactNode
  /** Inline error message; when set, marks the input invalid + links the message. */
  error?: string
  /** Helper text shown (and linked via aria-describedby) when there is no error. */
  hint?: ReactNode
}
