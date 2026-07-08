import type { ComplianceDispositionRequest } from "@handshake-agent/contracts"

import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { NativeSelect } from "@/components/ui/native-select"
import {
  COMMENT_TEXTAREA_CLASS,
  DISPOSITIONS,
} from "@/constants/compliance-event"
import type { ComplianceDispositionFormProps } from "@/types/components"

/**
 * The disposition form — a status select + an audited comment + the Apply button. The
 * disposition is step-up-gated in the hook; nothing here moves money (§3.1).
 */
export function ComplianceDispositionForm({
  status,
  onStatusChange,
  comment,
  onCommentChange,
  busy,
  onApply,
  localError,
}: ComplianceDispositionFormProps) {
  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-[11px] font-bold tracking-widest text-muted-foreground uppercase">
        Disposition
      </h3>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="event-disposition">Set status</Label>
        <NativeSelect
          id="event-disposition"
          aria-label="Disposition status"
          className="w-52"
          value={status}
          disabled={busy}
          onChange={(e) =>
            onStatusChange(
              e.target.value as ComplianceDispositionRequest["status"]
            )
          }
        >
          {DISPOSITIONS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="event-comment">Comment</Label>
        <textarea
          id="event-comment"
          value={comment}
          disabled={busy}
          onChange={(e) => onCommentChange(e.target.value)}
          placeholder="Audited disposition note (optional)"
          rows={3}
          className={COMMENT_TEXTAREA_CLASS}
        />
      </div>
      <Button
        size="sm"
        className="self-start"
        disabled={busy}
        aria-busy={busy}
        onClick={onApply}
      >
        Apply disposition
      </Button>
      {localError && (
        <p role="alert" className="text-xs text-destructive">
          {localError}
        </p>
      )}
    </section>
  )
}
