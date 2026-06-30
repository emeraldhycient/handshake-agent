"use client"

/**
 * WhatsAppConfigPage — a read-only view of the WhatsApp Cloud-API / Flows wiring
 * (Phase 4). Surfaces the NON-SECRET graph version + ids and a "secret set" badge
 * per secret. The secret VALUES never cross the boundary (root CLAUDE.md §3.5) —
 * this page only confirms presence. Secrets + flow ids are env-managed, not
 * editable here (a hint says so).
 *
 * Four async branches: loading / error / empty / data.
 */
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { useWhatsAppConfig } from "@/lib/query/hooks"
import type { WhatsAppConfigView } from "@handshake-agent/contracts"

/** The non-secret wiring fields, in display order. */
const WIRING_FIELDS: ReadonlyArray<{
  key: keyof WhatsAppConfigView
  label: string
}> = [
  { key: "graphVersion", label: "Graph version" },
  { key: "graphBaseUrl", label: "Graph base URL" },
  { key: "phoneNumberId", label: "Phone number ID" },
  { key: "flowId", label: "Flow ID" },
  { key: "beneficiaryFlowId", label: "Beneficiary flow ID" },
  { key: "wabaId", label: "WABA ID" },
  { key: "appId", label: "App ID" },
]

/** The secret-presence flags, in display order. */
const SECRET_FLAGS: ReadonlyArray<{
  key: keyof WhatsAppConfigView
  label: string
}> = [
  { key: "hasAppSecret", label: "App secret" },
  { key: "hasFlowPrivateKey", label: "Flow private key" },
  { key: "hasVerifyToken", label: "Verify token" },
]

function ConfigCard({ config }: { config: WhatsAppConfigView }) {
  return (
    <div className="flex flex-col gap-6 rounded-[14px] border border-border bg-card p-5">
      <section className="flex flex-col gap-2">
        <h2 className="text-[11px] font-bold tracking-widest text-muted-foreground uppercase">
          Cloud API / Flows wiring
        </h2>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          {WIRING_FIELDS.map((field) => (
            <div
              key={field.key}
              className="flex items-center justify-between gap-4 border-b border-border/60 py-1.5"
            >
              <dt className="text-muted-foreground">{field.label}</dt>
              <dd className="truncate font-mono text-xs text-foreground">
                {String(config[field.key]) || "—"}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-[11px] font-bold tracking-widest text-muted-foreground uppercase">
          Secrets
        </h2>
        <ul className="flex flex-wrap gap-2">
          {SECRET_FLAGS.map((flag) => {
            const present = Boolean(config[flag.key])
            return (
              <li key={flag.key}>
                <Badge variant={present ? "default" : "outline"}>
                  {flag.label}: {present ? "set" : "not set"}
                </Badge>
              </li>
            )
          })}
        </ul>
      </section>
    </div>
  )
}

export function WhatsAppConfigPage() {
  const config = useWhatsAppConfig()

  return (
    <div className="flex flex-1 flex-col gap-5 overflow-y-auto p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-[20px] font-extrabold tracking-tight text-foreground">
          WhatsApp
        </h1>
      </div>

      <div
        role="note"
        className="rounded-[14px] border border-info/30 bg-info/5 px-4 py-3 text-sm text-info-foreground"
      >
        Secrets and flow ids are managed in the environment (not editable here);
        this view only confirms which secrets are configured.
      </div>

      {/* ── Loading ──────────────────────────────────────────────────────────── */}
      {config.isLoading && (
        <div className="flex flex-col gap-3" aria-busy="true">
          <Skeleton className="h-48 w-full rounded-md" />
        </div>
      )}

      {/* ── Error ────────────────────────────────────────────────────────────── */}
      {config.isError && (
        <div className="rounded-[14px] border border-destructive/20 bg-destructive/5 p-5 text-center">
          <p className="text-sm font-semibold text-destructive">
            Failed to load WhatsApp config
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Please refresh the page.
          </p>
        </div>
      )}

      {/* ── Empty ────────────────────────────────────────────────────────────── */}
      {config.isSuccess && !config.data && (
        <p className="text-sm text-muted-foreground">
          No WhatsApp configuration found.
        </p>
      )}

      {/* ── Data ─────────────────────────────────────────────────────────────── */}
      {config.isSuccess && config.data && <ConfigCard config={config.data} />}
    </div>
  )
}
