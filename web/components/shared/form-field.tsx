import * as React from "react"
import { Input } from "@/components/ui/input"
import type { FormFieldProps } from "@/types/forms"

/**
 * Canonical labeled text field: `<label>` + `Input` + inline error, wired for
 * a11y (htmlFor/id, aria-invalid, aria-describedby). Spread a react-hook-form
 * `register(name)` onto it — its `ref` forwards through to the input.
 */
export const FormField = React.forwardRef<HTMLInputElement, FormFieldProps>(
  function FormField({ id, label, error, className, ...inputProps }, ref) {
    return (
      <div className={`flex flex-col gap-1.5 ${className ?? ""}`}>
        <label htmlFor={id} className="text-sm font-medium text-foreground">
          {label}
        </label>
        <Input
          id={id}
          ref={ref}
          aria-invalid={!!error}
          aria-describedby={error ? `${id}-error` : undefined}
          {...inputProps}
        />
        {error && (
          <p
            id={`${id}-error`}
            role="alert"
            className="text-xs text-destructive"
          >
            {error}
          </p>
        )}
      </div>
    )
  }
)
