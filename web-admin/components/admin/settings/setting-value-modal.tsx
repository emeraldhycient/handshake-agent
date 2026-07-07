"use client"

import { useState } from "react"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { NativeSelect } from "@/components/ui/native-select"
import { coerceValue, formatValue, seedInput } from "@/lib/settings/rows"
import type {
  SettingValueFormProps,
  SettingValueModalProps,
} from "@/types/components"

/** The value-entry form body — mounted only while open so it seeds from `row`. */
function SettingValueForm({ row, onContinue }: SettingValueFormProps) {
  const [raw, setRaw] = useState(() => seedInput(row))
  const [error, setError] = useState<string | null>(null)

  function submit() {
    const coerced = coerceValue(row.valueType, raw)
    if (!coerced.ok) {
      setError(coerced.error)
      return
    }
    onContinue(coerced.value, formatValue(coerced.value))
  }

  return (
    <DialogContent showCloseButton={false} className="w-[440px] max-w-[94vw]">
      <DialogHeader>
        <DialogTitle>Edit {row.key}</DialogTitle>
        <DialogDescription>
          Set a new DB-override value. It resolves above the ENV / JSON
          baseline.
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="setting-value">New value</Label>
        {row.valueType === "boolean" ? (
          <NativeSelect
            id="setting-value"
            aria-label="New value"
            value={raw}
            onChange={(e) => {
              setRaw(e.target.value)
              setError(null)
            }}
          >
            <option value="true">true</option>
            <option value="false">false</option>
          </NativeSelect>
        ) : (
          <Input
            id="setting-value"
            aria-label="New value"
            inputMode={row.valueType === "number" ? "decimal" : undefined}
            value={raw}
            onChange={(e) => {
              setRaw(e.target.value)
              setError(null)
            }}
            placeholder={
              row.valueType === "string[]" ? "comma, separated, values" : ""
            }
          />
        )}
        <p className="text-[11px] text-ink3">Type: {row.valueType}</p>
        {error && (
          <p role="alert" className="text-xs text-tdn">
            {error}
          </p>
        )}
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={() => onContinue(undefined, "")}>
          Cancel
        </Button>
        <Button onClick={submit}>Continue</Button>
      </DialogFooter>
    </DialogContent>
  )
}

/**
 * Step 0 of the settings edit — capture the new DB-override value with a control typed
 * to the key's `valueType`. Continue advances into the funds-safety flow chain; it
 * refuses to advance on an invalid value.
 */
export function SettingValueModal({
  open,
  row,
  onOpenChange,
  onContinue,
}: SettingValueModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && row && <SettingValueForm row={row} onContinue={onContinue} />}
    </Dialog>
  )
}
