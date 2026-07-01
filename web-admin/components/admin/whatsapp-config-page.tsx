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

/** Number & webhook health — the non-secret Cloud-API wiring, in display order. */
const HEALTH_FIELDS: ReadonlyArray<{
  key: keyof WhatsAppConfigView
  label: string
}> = [
  { key: "graphVersion", label: "Graph version" },
  { key: "graphBaseUrl", label: "Graph base URL" },
  { key: "phoneNumberId", label: "Phone number ID" },
  { key: "wabaId", label: "WABA ID" },
  { key: "appId", label: "App ID" },
]

/** E2E-encrypted Flows — each backed by an env-configured flow id, in display order. */
const FLOW_FIELDS: ReadonlyArray<{
  key: keyof WhatsAppConfigView
  name: string
  desc: string
}> = [
  {
    key: "flowId",
    name: "KYC & confirmation flow",
    desc: "Identity, itemized confirm, PIN entry",
  },
  {
    key: "beneficiaryFlowId",
    name: "Beneficiary flow",
    desc: "Add wallet / bank beneficiary",
  },
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

function CheckIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className="text-tok"
    >
      <path
        d="m5 12 5 5L20 7"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
    </svg>
  )
}

function LockIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M7 11V8a5 5 0 0 1 10 0v3"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <rect
        x="5"
        y="11"
        width="14"
        height="9"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.6"
      />
    </svg>
  )
}

/** Number & webhook health — key/val rows + the "Official Cloud API only" note. */
function HealthCard({ config }: { config: WhatsAppConfigView }) {
  return (
    <div className="rounded-[16px] border border-line bg-card p-[18px_20px]">
      <h2 className="mb-3 text-[13px] font-extrabold text-ink">
        Number &amp; webhook health
      </h2>
      <dl>
        {HEALTH_FIELDS.map((field) => (
          <div
            key={field.key}
            className="flex items-center justify-between gap-4 border-b border-line2 py-[9px]"
          >
            <dt className="text-[12.5px] text-ink2">{field.label}</dt>
            <dd className="truncate font-mono text-xs font-bold text-ink">
              {String(config[field.key]) || "—"}
            </dd>
          </div>
        ))}
      </dl>
      <div className="mt-3 flex items-center gap-2 rounded-[9px] bg-sok px-3 py-[9px]">
        <CheckIcon />
        <span className="text-[11.5px] font-semibold text-tok">
          Official Cloud API only · ban-risk: low
        </span>
      </div>
    </div>
  )
}

/** Flows (E2E encrypted) — lock rows + a Live pill when the flow id is configured. */
function FlowsCard({ config }: { config: WhatsAppConfigView }) {
  return (
    <div className="rounded-[16px] border border-line bg-card p-[18px_20px]">
      <h2 className="mb-3 text-[13px] font-extrabold text-ink">
        Flows (E2E encrypted)
      </h2>
      <div>
        {FLOW_FIELDS.map((flow) => {
          const live = Boolean(config[flow.key])
          return (
            <div
              key={flow.key}
              className="flex items-center gap-[11px] border-b border-line2 py-2.5"
            >
              <span className="flex size-[30px] flex-none items-center justify-center rounded-lg bg-card2 text-ink2">
                <LockIcon />
              </span>
              <div className="flex-1">
                <div className="text-[12.5px] font-bold text-ink">
                  {flow.name}
                </div>
                <div className="text-[10.5px] text-ink3">{flow.desc}</div>
              </div>
              <Badge variant={live ? "success" : "neutral"}>
                {live ? "Live" : "Not set"}
              </Badge>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** Secrets — presence-only (§3.5): confirm which secrets are configured. */
function SecretsCard({ config }: { config: WhatsAppConfigView }) {
  return (
    <div className="rounded-[16px] border border-line bg-card p-[18px_20px]">
      <div className="mb-3 flex items-center gap-2">
        <h2 className="flex-1 text-[13px] font-extrabold text-ink">Secrets</h2>
        <span className="text-[11px] text-ink3">
          env-managed · presence only
        </span>
      </div>
      <ul className="flex flex-wrap gap-2">
        {SECRET_FLAGS.map((flag) => {
          const present = Boolean(config[flag.key])
          return (
            <li key={flag.key}>
              <Badge variant={present ? "success" : "neutral"}>
                {flag.label}: {present ? "set" : "not set"}
              </Badge>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export function WhatsAppConfigPage() {
  const config = useWhatsAppConfig()

  return (
    <div className="mx-auto w-full max-w-[1200px] flex-1 overflow-y-auto p-[26px_30px_60px]">
      <div className="mb-4">
        <h1 className="text-[24px] font-extrabold tracking-tighter text-ink">
          WhatsApp
        </h1>
        <p className="mt-[5px] text-[13.5px] text-ink2">
          Cloud API config and E2E-encrypted Flows wiring. Secrets and flow ids
          are managed in the environment (not editable here); this view only
          confirms which secrets are configured.
        </p>
      </div>

      {/* ── Loading ──────────────────────────────────────────────────────────── */}
      {config.isLoading && (
        <div
          className="grid grid-cols-1 gap-[14px] sm:grid-cols-2"
          aria-busy="true"
        >
          <Skeleton className="h-56 w-full rounded-[16px]" />
          <Skeleton className="h-56 w-full rounded-[16px]" />
        </div>
      )}

      {/* ── Error ────────────────────────────────────────────────────────────── */}
      {config.isError && (
        <div className="rounded-[16px] border border-line bg-sdn/40 p-5 text-center">
          <p className="text-sm font-semibold text-tdn">
            Failed to load WhatsApp config
          </p>
          <p className="mt-1 text-xs text-ink3">Please refresh the page.</p>
        </div>
      )}

      {/* ── Empty ────────────────────────────────────────────────────────────── */}
      {config.isSuccess && !config.data && (
        <p className="text-sm text-ink2">No WhatsApp configuration found.</p>
      )}

      {/* ── Data ─────────────────────────────────────────────────────────────── */}
      {config.isSuccess && config.data && (
        <div className="flex flex-col gap-[14px]">
          <div className="grid grid-cols-1 gap-[14px] sm:grid-cols-2">
            <HealthCard config={config.data} />
            <FlowsCard config={config.data} />
          </div>
          <SecretsCard config={config.data} />
        </div>
      )}
    </div>
  )
}
