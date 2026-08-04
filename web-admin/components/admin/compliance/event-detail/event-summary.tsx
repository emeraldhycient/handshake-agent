import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { formatEventDate, severityVariant } from "@/lib/compliance/event-detail"
import type { ComplianceEventSummaryProps } from "@/types"

/**
 * The event metadata section — severity/status/user/tx/provider/rule + created stamp,
 * any prior disposition note, then the raw screening payload. Read-only display.
 */
export function ComplianceEventSummary({ event }: ComplianceEventSummaryProps) {
  return (
    <>
      <section className="flex flex-col gap-2">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <dt className="text-muted-foreground">Severity</dt>
          <dd>
            <Badge variant={severityVariant(event.severity)}>
              {event.severity}
            </Badge>
          </dd>
          <dt className="text-muted-foreground">Status</dt>
          <dd className="text-foreground">{event.status}</dd>
          <dt className="text-muted-foreground">User</dt>
          <dd className="font-mono text-xs text-foreground">{event.userId}</dd>
          <dt className="text-muted-foreground">Transaction</dt>
          <dd className="font-mono text-xs text-foreground">
            {event.transactionId ?? "—"}
          </dd>
          <dt className="text-muted-foreground">Provider</dt>
          <dd className="text-foreground">{event.screeningProvider}</dd>
          <dt className="text-muted-foreground">Rule / hit</dt>
          <dd className="text-foreground">{event.ruleOrHit ?? "—"}</dd>
          <dt className="text-muted-foreground">Created</dt>
          <dd className="text-foreground tabular-nums">
            {formatEventDate(event.createdAt)}
          </dd>
        </dl>
        {event.dispositionComment && (
          <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            Disposition: {event.dispositionComment}
            {event.dispositionAt
              ? ` (${formatEventDate(event.dispositionAt)})`
              : ""}
          </p>
        )}
      </section>

      <Separator />

      <section className="flex flex-col gap-2">
        <h3 className="text-[11px] font-bold tracking-widest text-muted-foreground uppercase">
          Screening payload
        </h3>
        <pre className="max-h-48 overflow-auto rounded-md border border-border bg-muted/40 p-3 text-[11px] text-muted-foreground">
          {JSON.stringify(event.details, null, 2)}
        </pre>
      </section>
    </>
  )
}
