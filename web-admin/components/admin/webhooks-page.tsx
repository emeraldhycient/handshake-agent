"use client"

/**
 * WebhooksPage — the durable inbound-webhook console (Track A). A read surface over
 * every provider webhook the platform has ingested, with one sensitive write: replay.
 *
 *   1. A metrics strip (depth / failed / dead) from `useWebhookMetrics()`.
 *   2. A filter bar — provider, status, and a from/to received-at window — whose local
 *      state feeds `useWebhooks(query)` so changing a filter re-keys + refetches.
 *   3. The queue table (Provider / Event ID / Status / Attempts / Received + a View
 *      action). Each list branch (loading / error / empty / data) renders.
 *   4. A right-side detail drawer (Sheet, Esc-closable via Radix) showing the verbatim
 *      payload + headers, the last error, and a Retry action.
 *
 * RETRY FLOW (mirrors the sanctions page's disposition flow): Retry opens a ReasonModal
 * (the audited replay reason), then fires `retryWebhook` through `useStepUpRetry`. The
 * server re-enqueues the webhook (engine-brokered, §3.1) and records the reason; it
 * moves no money. A 403 ADMIN_STEP_UP_REQUIRED opens the StepUpDialog and the POST
 * replays after re-auth. On success the webhooks queries invalidate and a toast fires.
 */
import { useMemo, useState } from "react"

import {
  WebhookProviderSchema,
  WebhookEventStatusSchema,
  type WebhookEventStatus,
  type WebhookListItem,
} from "@handshake-agent/contracts"

import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import { NativeSelect } from "@/components/ui/native-select"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { ReasonModal } from "@/components/admin/flows"
import { StepUpDialog } from "@/components/admin/step-up-dialog"
import {
  useAdminMe,
  useRetryWebhook,
  useWebhookDetail,
  useWebhookMetrics,
  useWebhooks,
} from "@/lib/query/hooks"
import { useStepUpRetry } from "@/lib/hooks/use-step-up-retry"
import { ApiError } from "@/lib/api/client"
import { pushToast } from "@/lib/store/toast-store"
import type { WebhookQuery } from "@/lib/api/webhooks"

// ── Presentation constants ──────────────────────────────────────────────────────────

/** The queue filter held in local state; empty strings mean "no filter" (All). */
interface FilterState {
  provider: string
  status: string
  from: string
  to: string
}

const EMPTY_FILTER: FilterState = { provider: "", status: "", from: "", to: "" }

/** Status → Badge variant (colour follows severity, never the sole signal — the
 *  status word is the label). received→info, processing→warn, succeeded→success,
 *  failed/dead→danger. */
const STATUS_VARIANT: Record<
  WebhookEventStatus,
  "info" | "warn" | "success" | "danger"
> = {
  received: "info",
  processing: "warn",
  succeeded: "success",
  failed: "danger",
  dead: "danger",
}

/** Truncate a long provider event id for the table cell (full value in the drawer). */
function truncateId(id: string): string {
  return id.length > 24 ? `${id.slice(0, 24)}…` : id
}

function formatDate(iso: string | null): string {
  if (!iso) return "—"
  return new Date(iso).toLocaleString()
}

/** Pretty-print an unknown JSON-ish value for the drawer's <pre> blocks. */
function prettyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

/** Normalizes a mutation/step-up failure into a user-facing message. */
function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error) return error.message
  return "Something went wrong."
}

// ── Filter bar ───────────────────────────────────────────────────────────────────

function FilterBar({
  filter,
  onChange,
}: {
  filter: FilterState
  onChange: (next: FilterState) => void
}) {
  return (
    <div className="mb-4 flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="webhook-provider">Provider</Label>
        <NativeSelect
          id="webhook-provider"
          aria-label="Filter by provider"
          className="w-44"
          value={filter.provider}
          onChange={(e) => onChange({ ...filter, provider: e.target.value })}
        >
          <option value="">All providers</option>
          {WebhookProviderSchema.options.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </NativeSelect>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="webhook-status">Status</Label>
        <NativeSelect
          id="webhook-status"
          aria-label="Filter by status"
          className="w-40"
          value={filter.status}
          onChange={(e) => onChange({ ...filter, status: e.target.value })}
        >
          <option value="">All statuses</option>
          {WebhookEventStatusSchema.options.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </NativeSelect>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="webhook-from">From</Label>
        <input
          id="webhook-from"
          type="date"
          aria-label="Received from"
          value={filter.from}
          onChange={(e) => onChange({ ...filter, from: e.target.value })}
          className="h-[38px] rounded-[11px] border border-line bg-field px-3 text-sm font-semibold text-ink outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="webhook-to">To</Label>
        <input
          id="webhook-to"
          type="date"
          aria-label="Received to"
          value={filter.to}
          onChange={(e) => onChange({ ...filter, to: e.target.value })}
          className="h-[38px] rounded-[11px] border border-line bg-field px-3 text-sm font-semibold text-ink outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
      </div>
    </div>
  )
}

// ── Metrics strip ───────────────────────────────────────────────────────────────

function MetricsStrip() {
  const metrics = useWebhookMetrics()
  if (!metrics.isSuccess) return null
  const cells: { label: string; value: number; danger?: boolean }[] = [
    { label: "In-flight", value: metrics.data.depth },
    {
      label: "Failed",
      value: metrics.data.failed,
      danger: metrics.data.failed > 0,
    },
    { label: "Dead", value: metrics.data.dead, danger: metrics.data.dead > 0 },
  ]
  return (
    <div className="mb-4 flex flex-wrap gap-2.5">
      {cells.map((c) => (
        <div
          key={c.label}
          className="rounded-[12px] border border-line bg-card px-4 py-2.5"
        >
          <div className="text-[10px] font-bold tracking-[0.06em] text-ink3 uppercase">
            {c.label}
          </div>
          <div
            className={cn(
              "text-lg font-extrabold tabular-nums",
              c.danger ? "text-tdn" : "text-ink"
            )}
          >
            {c.value}
          </div>
        </div>
      ))}
    </div>
  )
}

// ── List branches ──────────────────────────────────────────────────────────────

function LoadingRows() {
  return (
    <div className="flex flex-col gap-2" aria-busy="true">
      <Skeleton className="h-11 w-full rounded-[10px]" />
      <Skeleton className="h-11 w-full rounded-[10px]" />
      <Skeleton className="h-11 w-full rounded-[10px]" />
    </div>
  )
}

function ErrorRows({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="rounded-[16px] border border-sdn bg-sdn/40 p-5 text-center">
      <p className="text-sm font-bold text-tdn">Failed to load webhooks</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-2 cursor-pointer rounded-[9px] border border-line bg-card px-[14px] py-2 text-xs font-bold text-ink transition-colors hover:bg-hov focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        Retry
      </button>
    </div>
  )
}

function EmptyRows() {
  return (
    <div className="rounded-[16px] border border-line bg-card px-5 py-8 text-center">
      <p className="text-sm font-bold text-ink">No webhooks</p>
      <p className="mt-1 text-[12.5px] text-ink2">
        Inbound provider webhooks matching your filters will appear here.
      </p>
    </div>
  )
}

// ── Queue table ────────────────────────────────────────────────────────────────

function WebhookTable({
  items,
  onView,
}: {
  items: readonly WebhookListItem[]
  onView: (id: string) => void
}) {
  return (
    <div className="overflow-hidden rounded-[16px] border border-line bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Provider</TableHead>
            <TableHead>Event ID</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Attempts</TableHead>
            <TableHead>Received</TableHead>
            <TableHead className="text-right">Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => (
            <TableRow key={item.id}>
              <TableCell className="font-semibold text-ink">
                {item.provider}
              </TableCell>
              <TableCell className="font-mono text-ink2">
                {truncateId(item.providerEventId)}
              </TableCell>
              <TableCell>
                <Badge variant={STATUS_VARIANT[item.status]}>
                  {item.status}
                </Badge>
              </TableCell>
              <TableCell className="text-ink tabular-nums">
                {item.attempts}
              </TableCell>
              <TableCell className="text-ink2 tabular-nums">
                {formatDate(item.receivedAt)}
              </TableCell>
              <TableCell className="text-right">
                <button
                  type="button"
                  onClick={() => onView(item.id)}
                  className="cursor-pointer rounded-[9px] border border-line px-[13px] py-1.5 text-xs font-bold text-ink transition-colors hover:bg-hov focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                >
                  View
                </button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

// ── Detail drawer ───────────────────────────────────────────────────────────────

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-[12.5px] text-ink3">{label}</dt>
      <dd className="text-[12.5px] font-semibold text-ink tabular-nums">
        {value}
      </dd>
    </>
  )
}

/**
 * The webhook detail drawer — fetches via `useWebhookDetail(id)` and renders the
 * metadata, the last error (if any), the verbatim payload + headers as pretty JSON,
 * and the Retry action. Four async branches on the detail query.
 */
function WebhookDetailDrawer({
  webhookId,
  onOpenChange,
  onRetry,
  retrying,
}: {
  webhookId: string | null
  onOpenChange: (open: boolean) => void
  onRetry: (id: string) => void
  retrying: boolean
}) {
  const detail = useWebhookDetail(webhookId)
  const webhook = detail.data

  return (
    <Sheet open={webhookId !== null} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Webhook</SheetTitle>
          <SheetDescription>
            {webhook ? webhook.provider : "Loading webhook"}
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-6 p-4 pt-0">
          {detail.isLoading && (
            <div className="flex flex-col gap-3" aria-busy="true">
              <Skeleton className="h-24 w-full rounded-md" />
              <Skeleton className="h-24 w-full rounded-md" />
            </div>
          )}

          {detail.isError && (
            <div className="rounded-[14px] border border-sdn bg-sdn/40 p-5 text-center">
              <p className="text-sm font-bold text-tdn">
                Failed to load this webhook
              </p>
              <p className="mt-1 text-xs text-ink2">Close and try again.</p>
            </div>
          )}

          {detail.isSuccess && webhook && (
            <>
              <section className="flex flex-col gap-3">
                <div className="flex items-center gap-2">
                  <Badge variant={STATUS_VARIANT[webhook.status]}>
                    {webhook.status}
                  </Badge>
                  <span className="text-[12.5px] text-ink2">
                    {webhook.attempts} attempt
                    {webhook.attempts === 1 ? "" : "s"}
                  </span>
                </div>
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
                  <DetailField label="Provider" value={webhook.provider} />
                  <dt className="text-[12.5px] text-ink3">Event ID</dt>
                  <dd className="font-mono text-[12.5px] font-semibold break-all text-ink">
                    {webhook.providerEventId}
                  </dd>
                  <DetailField
                    label="Received"
                    value={formatDate(webhook.receivedAt)}
                  />
                  <DetailField
                    label="Last attempt"
                    value={formatDate(webhook.lastAttemptAt)}
                  />
                  <DetailField
                    label="Processed"
                    value={formatDate(webhook.processedAt)}
                  />
                  <DetailField
                    label="Dead-lettered"
                    value={formatDate(webhook.deadAt)}
                  />
                </dl>
              </section>

              {webhook.lastError && (
                <section className="rounded-[12px] border border-sdn bg-sdn/40 px-4 py-3">
                  <div className="text-[10px] font-bold tracking-[0.06em] text-tdn uppercase">
                    Last error
                  </div>
                  <p className="mt-1 text-[12.5px] break-words text-tdn">
                    {webhook.lastError}
                  </p>
                </section>
              )}

              <section className="flex flex-col gap-2">
                <h3 className="text-[11px] font-bold tracking-widest text-ink3 uppercase">
                  Payload
                </h3>
                <pre className="max-h-64 overflow-auto rounded-md border border-line bg-card2 p-3 text-[11px] text-ink2">
                  {prettyJson(webhook.payload)}
                </pre>
              </section>

              <section className="flex flex-col gap-2">
                <h3 className="text-[11px] font-bold tracking-widest text-ink3 uppercase">
                  Headers
                </h3>
                <pre className="max-h-48 overflow-auto rounded-md border border-line bg-card2 p-3 text-[11px] text-ink2">
                  {prettyJson(webhook.headers)}
                </pre>
              </section>

              <button
                type="button"
                onClick={() => onRetry(webhook.id)}
                disabled={retrying}
                aria-busy={retrying}
                className="cursor-pointer self-start rounded-[10px] bg-btn-dark px-[15px] py-2.5 text-sm font-extrabold text-white transition-opacity hover:opacity-90 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50"
              >
                {retrying ? "Retrying…" : "Retry"}
              </button>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

// ── Page ────────────────────────────────────────────────────────────────────────

export function WebhooksPage() {
  const [filter, setFilter] = useState<FilterState>(EMPTY_FILTER)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // The webhook awaiting a reason before its (step-up-guarded) replay fires.
  const [reasonFor, setReasonFor] = useState<string | null>(null)

  // Project the local filter onto the query — omit empty fields so the key stays
  // stable and the backend receives only the filters the operator set.
  const query = useMemo<WebhookQuery>(() => {
    const q: WebhookQuery = {}
    if (filter.provider) q.provider = filter.provider
    if (filter.status) q.status = filter.status
    if (filter.from) q.from = filter.from
    if (filter.to) q.to = filter.to
    return q
  }, [filter])

  const webhooksQuery = useWebhooks(query)
  const items = webhooksQuery.data?.items ?? []

  const me = useAdminMe()
  const retry = useRetryWebhook()
  const stepUp = useStepUpRetry()

  /**
   * Replay a webhook through the real step-up-guarded POST. On success it toasts and
   * invalidates the webhooks queries; a 403 ADMIN_STEP_UP_REQUIRED opens the
   * StepUpDialog and the POST replays after re-auth.
   */
  function replay(id: string, reason: string) {
    setReasonFor(null)
    void (async () => {
      try {
        const ok = await stepUp.run(() =>
          retry.mutateAsync({ id, input: { reason } }).then(() => undefined)
        )
        if (ok) pushToast("Webhook re-enqueued", "ok")
        // ok === false → a step-up challenge opened; the StepUpDialog replays it.
      } catch (error) {
        pushToast(errorMessage(error), "warn")
      }
    })()
  }

  return (
    <div className="mx-auto w-full max-w-[1120px] px-[30px] pt-[26px] pb-[60px]">
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="mb-4">
        <h1 className="text-2xl font-extrabold tracking-[-0.02em] text-ink">
          Webhooks
        </h1>
        <p className="mt-[5px] text-[13.5px] text-ink2">
          Durable record of every inbound provider webhook. Filter, inspect, and
          replay.
        </p>
      </div>

      {/* ── Metrics strip ───────────────────────────────────────────────────── */}
      <MetricsStrip />

      {/* ── Filter bar ──────────────────────────────────────────────────────── */}
      <FilterBar filter={filter} onChange={setFilter} />

      {/* ── Queue (loading / error / empty / data) ──────────────────────────── */}
      {webhooksQuery.isLoading && <LoadingRows />}
      {webhooksQuery.isError && (
        <ErrorRows onRetry={() => void webhooksQuery.refetch()} />
      )}
      {webhooksQuery.isSuccess && items.length === 0 && <EmptyRows />}
      {webhooksQuery.isSuccess && items.length > 0 && (
        <WebhookTable items={items} onView={setSelectedId} />
      )}

      {/* ── Detail drawer ───────────────────────────────────────────────────── */}
      <WebhookDetailDrawer
        webhookId={selectedId}
        onOpenChange={(open) => !open && setSelectedId(null)}
        onRetry={setReasonFor}
        retrying={retry.isPending}
      />

      {/* ── Retry → ReasonModal (audited) → step-up-guarded POST ─────────────── */}
      <ReasonModal
        open={reasonFor !== null}
        onOpenChange={(next) => !next && setReasonFor(null)}
        title="Retry webhook"
        onContinue={(reason) => reasonFor && replay(reasonFor, reason)}
      />

      {/* Server-side step-up re-auth: a 403 on the retry POST opens this; the POST
          replays after re-authentication, then a toast fires. */}
      <StepUpDialog
        open={stepUp.open}
        mfaEnabled={me.data?.mfaEnabled ?? false}
        onOpenChange={stepUp.setOpen}
        onSuccess={() => {
          void stepUp
            .retry()
            .then((ok) => {
              if (ok) pushToast("Webhook re-enqueued", "ok")
            })
            .catch((error) => pushToast(errorMessage(error), "warn"))
        }}
      />
    </div>
  )
}
