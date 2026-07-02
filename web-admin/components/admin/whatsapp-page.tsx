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
 * webhook subscription status, last-webhook age, 7d template rejections), the Flows
 * registry (per-flow name/desc/live), and the live conversation monitor have NO read
 * endpoint yet. Rather than fabricate design-representative sample data, each of
 * those surfaces now renders an HONEST shape-gap note (Phase 8) — deferred to a
 * later backend-enrichment pass.
 *
 * Structure (matching the markup 1:1, `max-width:1200px` · `padding:26px 30px 60px`):
 *   Row 1 (`grid-template-columns:1fr 1fr; gap:14px`):
 *     • "Number & webhook health" — real wiring rows + secret-presence, an
 *       operational-signals shape-gap note, closed by the "Official Cloud API only" note.
 *     • "Flows (E2E encrypted)" — a shape-gap note (no per-flow registry endpoint).
 *   Row 2 (full-width): "Live conversation monitor" — a shape-gap note (no monitor
 *     feed endpoint).
 *
 * The screen is entirely read-only — it moves no money and takes no sensitive
 * action, so it opens none of the shared flow modals and there is no step-up here
 * (root CLAUDE.md §3.5).
 */
import { Skeleton } from "@/components/ui/skeleton"
import { useWhatsAppConfig } from "@/lib/query/hooks"
import type { WhatsAppConfigView } from "@handshake-agent/contracts"
import type { WhatsAppHealthRow } from "@/types/components"

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

/**
 * An honest shape-gap note for a panel whose backing read endpoint does not exist
 * yet. Shown instead of fabricating design-representative data.
 */
function ShapeGapNote({ title, children }: { title: string; children: string }) {
  return (
    <div className="rounded-[12px] border border-dashed border-line2 px-4 py-6 text-center">
      <p className="text-[13px] font-bold text-ink">{title}</p>
      <p className="mt-1 text-[12px] leading-snug text-ink2">{children}</p>
    </div>
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
 * (from `useWhatsAppConfig`), closed by the "Official Cloud API only" note. The
 * design's operational signals (quality rating, messaging limit, webhook status,
 * template rejections) have NO read endpoint yet, so instead of fabricating them the
 * card carries an honest shape-gap note. Four async branches.
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

        {data &&
          wiringRows(data).map((row) => (
            <HealthRow key={row.label} row={row} />
          ))}
      </dl>

      {data && (
        <p className="mt-2 text-[11px] leading-snug text-ink3">
          Operational signals (quality rating, messaging-limit tier, webhook
          subscription, template rejections) have no read endpoint yet and are
          intentionally omitted rather than shown as sample data.
        </p>
      )}

      <div className="mt-3 flex items-center gap-2 rounded-[9px] bg-sok px-3 py-[9px]">
        <CheckIcon />
        <span className="text-[11.5px] font-semibold text-tok">
          Official Cloud API only · ban-risk: low
        </span>
      </div>
    </div>
  )
}

/**
 * Flows (E2E encrypted) — the config view exposes only `flowId` + `beneficiaryFlowId`,
 * with no per-flow registry (name/description/live status) to enumerate. Rather than
 * fabricate KYC/confirm/PIN flow rows, this shows an honest shape-gap note (deferred).
 */
function FlowsCard() {
  return (
    <div className="rounded-2xl border border-line bg-card px-5 py-[18px]">
      <h2 className="mb-3 text-[13px] font-extrabold text-ink">
        Flows (E2E encrypted)
      </h2>
      <ShapeGapNote title="No Flows registry yet">
        There is no per-flow read endpoint yet — the config view exposes only the
        flow ids. The E2E-encrypted KYC, itemized-confirmation and PIN flows will be
        listed here once a registry is added.
      </ShapeGapNote>
    </div>
  )
}

/**
 * Live conversation monitor — there is NO WhatsApp conversation-monitor read endpoint
 * yet, so rather than fabricate redacted chat bubbles this shows an honest shape-gap
 * note (deferred).
 */
function ConversationMonitorCard() {
  return (
    <div className="rounded-2xl border border-line bg-card px-5 py-[18px]">
      <div className="mb-3 flex items-center gap-[9px]">
        <div className="flex-1 text-[13px] font-extrabold text-ink">
          Live conversation monitor
        </div>
        <span className="text-[11px] text-ink3">read-only · redacted</span>
      </div>
      <ShapeGapNote title="No conversation feed yet">
        There is no read endpoint for live WhatsApp conversations yet. A read-only,
        redacted transcript will appear here once a monitor feed is added.
      </ShapeGapNote>
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
