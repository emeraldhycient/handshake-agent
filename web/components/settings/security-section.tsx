"use client"

import { useState } from "react"
import { ChangePinDialog } from "./change-pin-dialog"
import { SessionsList } from "./sessions-list"

/**
 * Security card: transaction-PIN management + active sessions. The old
 * Face-ID toggle was placeholder interactivity (persisted nothing) and was
 * removed per §3.6 — no fake controls.
 */
export function SecuritySection() {
  const [changingPin, setChangingPin] = useState(false)

  return (
    <div className="overflow-hidden rounded-[16px] border border-border bg-card">
      <p className="border-b border-border px-5 py-[13px] text-xs font-bold tracking-widest text-muted-foreground uppercase">
        Security
      </p>
      <div className="flex items-center border-b border-border px-5 py-[15px]">
        <div className="flex-1">
          <p className="text-sm font-semibold text-foreground">
            Transaction PIN
          </p>
          <p className="text-[12.5px] text-muted-foreground">
            Required for every money movement
          </p>
        </div>
        <button
          type="button"
          className="cursor-pointer text-[13px] font-bold text-primary"
          onClick={() => setChangingPin(true)}
        >
          Change
        </button>
      </div>
      <p className="border-b border-border px-5 pt-[13px] pb-2 text-[11px] font-bold tracking-widest text-muted-foreground uppercase">
        Active sessions
      </p>
      <SessionsList />
      <ChangePinDialog open={changingPin} onOpenChange={setChangingPin} />
    </div>
  )
}
