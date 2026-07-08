import * as React from "react"
import { Input } from "@/components/ui/input"
import type { FormFieldProps } from "@/types/forms"

/**
 * Canonical labeled text field: `<label>` + `Input` + inline error, wired for
 * a11y (htmlFor/id, aria-invalid, aria-describedby). Spread a react-hook-form
 * `register(name)` onto it — its `ref` forwards through to the input.
 */
export const FormField = React.forwardRef<HTMLInputElement, FormFieldProps>(
  function FormField(
    { id, label, error, hint, className, ...inputProps },
    ref
  ) {
    const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined
    return (
      <div className={`flex flex-col gap-1.5 ${className ?? ""}`}>
        <label htmlFor={id} className="text-sm font-medium text-foreground">
          {label}
        </label>
        <Input
          id={id}
          ref={ref}
          aria-invalid={!!error}
          aria-describedby={describedBy}
          {...inputProps}
        />
        {error ? (
          <p
            id={`${id}-error`}
            role="alert"
            className="text-xs text-destructive"
          >
            {error}
          </p>
        ) : (
          hint && (
            <p id={`${id}-hint`} className="text-xs text-muted-foreground">
              {hint}
            </p>
          )
        )}
      </div>
    )
  }
)
