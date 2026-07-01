"use client"

/**
 * WhatsAppPage — PIXEL reproduction of `docs/design-ref/screens/Whatsapp.html`
 * (operator-console design system §6.20).
 *
 * The "Number & webhook health" card is now WIRED to real data: the NON-SECRET
 * Cloud-API / Flows wiring (graph version + phone-number / WABA / app / flow ids)
 * and the boolean secret-PRESENCE flags come from `useWhatsAppConfig()`
 * (GET /admin/whatsapp/config). Secret VALUES never cross the boundary (root
 * CLAUDE.md §3.5) — the presence rows render only "Set" / "Not set", never a
 * plaintext secret.
 *
 * The design's operational-health signals (quality rating, messaging-limit tier,
 * webhook subscription status, last-webhook age, 7d template rejections), the
 * Flows registry (per-flow name/desc/live), and the live conversation monitor
 * have NO read endpoint yet — those remain design-representative module constants
 * (recorded as shapeGaps for the later backend-enrichment pass).
 *
 * Structure (matching the markup 1:1, `max-width:1200px` · `padding:26px 30px 60px`):
 *   Row 1 (`grid-template-columns:1fr 1fr; gap:14px`):
 *     • "Number & webhook health" — real wiring rows + secret-presence, then the
 *       (mock) operational rows, closed by the "Official Cloud API only" note.
 *     • "Flows (E2E encrypted)" — `WA_FLOWS` lock-icon rows + "Live" pills (mock).
 *   Row 2 (full-width): "Live conversation monitor" — read-only, redacted chat
 *     bubbles (`WA_CONVO`), inbound left/`card2`, outbound right/`brand-green` (mock).
 *
 * The screen is entirely read-only — it moves no money and takes no sensitive
 * action, so it opens none of the shared flow modals and there is no step-up here
 * (root CLAUDE.md §3.5).
 */
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { useWhatsAppConfig } from "@/lib/query/hooks"
import type { WhatsAppConfigView } from "@handshake-agent/contracts"
import type {
  WhatsAppConvoBubble,
  WhatsAppFlowRow,
  WhatsAppHealthRow,
} from "@/types/components"

// Operational-health signals the design shows but the config view does NOT provide
// (quality rating, messaging limit, webhook status, last-webhook age, template
// rejections). These have no read endpoint yet — kept as design-representative
// samples and recorded as shapeGaps. Neutral wiring renders `--ink`; healthy
// states `--tok`; degraded `--twn`.
const WA_HEALTH_OPERATIONAL: readonly WhatsAppHealthRow[] = [
  { label: "Quality rating", value: "GREEN · High", tone: "ok" },
  { label: "Messaging limit", value: "Tier 3 · 100K / 24h", tone: "neutral" },
  { label: "Webhook", value: "Subscribed · 200 OK", tone: "ok" },
  { label: "Last webhook", value: "3s ago", tone: "ok" },
  { label: "Template rejections (7d)", value: "1", tone: "warn" },
]

// design mock (`waFlows`): the E2E-encrypted in-thread Flows — KYC, itemized confirm
// and PIN entry (root CLAUDE.md §3.5). No per-flow registry endpoint exists yet
// (the config view exposes only flowId + beneficiaryFlowId), so name/desc/live are
// design-representative samples — recorded as a shapeGap.
const WA_FLOWS: readonly WhatsAppFlowRow[] = [
  {
    id: "kyc",
    name: "KYC verification",
    desc: "Identity capture · NIN/BVN · liveness selfie",
    live: true,
  },
  {
    id: "confirm",
    name: "Itemized confirmation",
    desc: "Exact parameters · rate · fees · total",
    live: true,
  },
  {
    id: "pin",
    name: "PIN entry",
    desc: "Encrypted PIN · step-up authorization",
    live: true,
  },
]

// design mock (`waConvo`): the read-only, redacted live-conversation transcript.
// No WhatsApp conversation-monitor endpoint exists yet — recorded as a shapeGap.
const WA_CONVO: readonly WhatsAppConvoBubble[] = [
  { id: "c1", direction: "in", text: "I want to buy 50 USDT" },
  {
    id: "c2",
    direction: "out",
    text: "You'll get ~50 USDT for ₦••,•••. Confirm the itemized details in the secure Flow to continue.",
  },
  { id: "c3", direction: "in", text: "sent ✓ — where's my money?" },
  {
    id: "c4",
    direction: "out",
    text: "Settlement is in progress. I'll message you here the moment the engine confirms it.",
  },
]

/** The mono value's text-token utility for a health-row tone (design per-row `fg`). */
function toneClass(tone: WhatsAppHealthRow["tone"]): string {
  if (tone === "ok") return "text-tok"
  if (tone === "warn") return "text-twn"
  return "text-ink"
}

/**
 * Derive the real wiring rows from the config view. The non-secret ids/version
 * render as neutral mono wiring; the three secret-presence booleans render only
 * "Set" (`ok`) / "Not set" (`warn`) — never a plaintext secret (§3.5).
 */
function wiringRows(config: WhatsAppConfigView): readonly WhatsAppHealthRow[] {
  const presence = (set: boolean): WhatsAppHealthRow["tone"] =>
    set ? "ok" : "warn"
  // An unconfigured env yields blank ids — render a subtle em-dash so the row
  // reads as "not configured" rather than an empty cell (design-consistent).
  const id = (value: string): string => (value.trim() === "" ? "—" : value)
  return [
    {
      label: "Graph version",
      value: id(config.graphVersion),
      tone: "neutral",
    },
    {
      label: "Phone number ID",
      value: id(config.phoneNumberId),
      tone: "neutral",
    },
    { label: "WABA ID", value: id(config.wabaId), tone: "neutral" },
    { label: "App ID", value: id(config.appId), tone: "neutral" },
    { label: "Flow ID", value: id(config.flowId), tone: "neutral" },
    {
      label: "Beneficiary Flow ID",
      value: id(config.beneficiaryFlowId),
      tone: "neutral",
    },
    {
      label: "App secret",
      value: config.hasAppSecret ? "Set" : "Not set",
      tone: presence(config.hasAppSecret),
    },
    {
      label: "Flow private key",
      value: config.hasFlowPrivateKey ? "Set" : "Not set",
      tone: presence(config.hasFlowPrivateKey),
    },
    {
      label: "Verify token",
      value: config.hasVerifyToken ? "Set" : "Not set",
      tone: presence(config.hasVerifyToken),
    },
  ]
}

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

/** One key/value health row (design markup) — label + tinted mono value. */
function HealthRow({ row }: { row: WhatsAppHealthRow }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-line2 py-[9px]">
      <dt className="text-[12.5px] text-ink2">{row.label}</dt>
      <dd
        className={`max-w-[55%] truncate font-mono text-xs font-bold ${toneClass(row.tone)}`}
      >
        {row.value}
      </dd>
    </div>
  )
}

/** Skeleton wiring rows for the loading branch (matches the row rhythm). */
function HealthRowsSkeleton() {
  return (
    <div aria-busy="true">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="flex items-center justify-between gap-4 border-b border-line2 py-[9px]"
        >
          <Skeleton className="h-3 w-28" />
          <Skeleton className="h-3 w-24" />
        </div>
      ))}
    </div>
  )
}

/**
 * Number & webhook health — real Cloud-API / Flows wiring + secret-presence
 * (from `useWhatsAppConfig`), then the design's (mock) operational rows, closed
 * by the "Official Cloud API only" note. Four async branches.
 */
function HealthCard() {
  const { data, isLoading, isError, refetch } = useWhatsAppConfig()

  return (
    <div className="rounded-2xl border border-line bg-card px-5 py-[18px]">
      <h2 className="mb-3 text-[13px] font-extrabold text-ink">
        Number &amp; webhook health
      </h2>

      <dl>
        {isLoading && <HealthRowsSkeleton />}

        {isError && (
          <div className="my-2 rounded-[9px] border border-sdn bg-sdn/40 px-3 py-[11px] text-center">
            <p className="text-[12px] font-bold text-tdn">
              Couldn&apos;t load WhatsApp config
            </p>
            <button
              type="button"
              onClick={() => refetch()}
              className="mt-1 cursor-pointer rounded-md px-1 text-[11.5px] font-bold text-tif hover:bg-hov focus-visible:outline focus-visible:outline-2 focus-visible:outline-tif"
            >
              Retry
            </button>
          </div>
        )}

        {data && (
          <>
            {wiringRows(data).map((row) => (
              <HealthRow key={row.label} row={row} />
            ))}
            {/* Operational signals the config view does not yet provide (shapeGap). */}
            {WA_HEALTH_OPERATIONAL.map((row) => (
              <HealthRow key={row.label} row={row} />
            ))}
          </>
        )}
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

/** Flows (E2E encrypted) — lock rows + a Live pill. */
function FlowsCard() {
  return (
    <div className="rounded-2xl border border-line bg-card px-5 py-[18px]">
      <h2 className="mb-3 text-[13px] font-extrabold text-ink">
        Flows (E2E encrypted)
      </h2>
      <div>
        {WA_FLOWS.map((flow) => (
          <div
            key={flow.id}
            className="flex items-center gap-[11px] border-b border-line2 py-2.5 last:border-b-0"
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
            <Badge variant={flow.live ? "success" : "neutral"}>
              {flow.live ? "Live" : "Not set"}
            </Badge>
          </div>
        ))}
      </div>
    </div>
  )
}

/** Live conversation monitor — read-only, redacted chat bubbles. */
function ConversationMonitorCard() {
  return (
    <div className="rounded-2xl border border-line bg-card px-5 py-[18px]">
      <div className="mb-3 flex items-center gap-[9px]">
        <div className="flex-1 text-[13px] font-extrabold text-ink">
          Live conversation monitor
        </div>
        <span className="text-[11px] text-ink3">read-only · redacted</span>
      </div>
      <div className="flex max-w-[560px] flex-col gap-[9px]">
        {WA_CONVO.map((bubble) => {
          const outbound = bubble.direction === "out"
          return (
            <div
              key={bubble.id}
              className={`flex ${outbound ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[75%] rounded-[13px] px-[13px] py-[9px] text-[12.5px] leading-[1.4] ${
                  outbound ? "bg-brand-green text-white" : "bg-card2 text-ink"
                }`}
              >
                {bubble.text}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function WhatsAppPage() {
  return (
    <div className="mx-auto w-full max-w-[1200px] px-[30px] pt-[26px] pb-[60px]">
      <div className="mb-4">
        <h1 className="text-[24px] font-extrabold tracking-[-0.02em] text-ink">
          WhatsApp
        </h1>
        <p className="mt-[5px] text-[13.5px] text-ink2">
          Cloud API config, Flows, live conversation monitor and delivery
          metrics.
        </p>
      </div>

      <div className="flex flex-col gap-[14px]">
        <div className="grid grid-cols-1 gap-[14px] md:grid-cols-2">
          <HealthCard />
          <FlowsCard />
        </div>
        <ConversationMonitorCard />
      </div>
    </div>
  )
}
