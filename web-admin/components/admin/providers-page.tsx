"use client"

/**
 * ProvidersPage — the provider-adapters operator screen (design §6.27), a PIXEL
 * reproduction of `docs/design-ref/screens/Providers.html`.
 *
 * Layout: a `1fr 1fr` grid of provider cards (mark tile + name/kind + status·latency
 * pill; an optional amber MOCK-MODE banner; a masked API-KEY row with "Reveal ·
 * step-up"; a bound-capabilities line + a "Test connection" button), then a
 * full-width "Mock → live readiness checklist" card of check-icon rows.
 *
 * DATA: this is a DESIGN REPRODUCTION — no data is fetched (no TanStack Query). The
 * five provider cards and the readiness checklist are the design's OWN seed content
 * (docs/design-ref/logic.js `providers`, line 139) embedded as module-level consts,
 * so the screen renders the same values the design shows. Real-data reintegration is
 * a separate later step.
 *
 * FUNDS-SAFETY: the screen is read-only apart from the "Reveal · step-up" gesture,
 * which opens the shared step-up TOTP flow modal before the (design-faithful sample)
 * key value is shown, with an auto-remask countdown — secrets are never surfaced
 * without re-authentication (root CLAUDE.md §3.4). The shown key digits are sample
 * content, never a live secret. "Test connection" runs no live probe (§3.1).
 */
import { useCallback, useEffect, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { StepUpModal } from "@/components/admin/flows"
import { pushToast } from "@/lib/store/toast-store"
import type {
  ProviderCard,
  ProviderCardViewProps,
  ProviderReadinessItem,
  ProviderStatus,
} from "@/types/components"

// design reproduction: the design's own seed provider records (docs/design-ref/
// logic.js `providers`, line 139) — five cards, the exact masked keys, statuses,
// latencies, and bound-capability strings the design renders. Not live data.
const PROVIDERS: readonly ProviderCard[] = [
  {
    id: "blockradar",
    mark: "BL",
    name: "Blockradar",
    kind: "Custodial crypto WaaS · TRON",
    status: "ok",
    latency: "120ms",
    mock: false,
    keyMasked: "sk_live_••••4821",
    keyRevealed: "sk_live_9c31a8d5e07b4821",
    caps: "crypto.buy, sell, send, swap",
  },
  {
    id: "flutterwave",
    mark: "FL",
    name: "Flutterwave",
    kind: "Fiat NGN rails",
    status: "degraded",
    latency: "890ms",
    mock: false,
    keyMasked: "FLWSECK-••••0b2a",
    keyRevealed: "FLWSECK-4d2b9a1c7e0b2a",
    caps: "payout, collection",
  },
  {
    id: "resend",
    mark: "RE",
    name: "Resend",
    kind: "Transactional email",
    status: "ok",
    latency: "70ms",
    mock: false,
    keyMasked: "re_••••9f31",
    keyRevealed: "re_7a4f0e9b12c69f31",
    caps: "email",
  },
  {
    id: "whatsapp",
    mark: "WC",
    name: "WhatsApp Cloud API",
    kind: "Messaging + Flows",
    status: "ok",
    latency: "210ms",
    mock: false,
    keyMasked: "EAAG••••c7",
    keyRevealed: "EAAG2f8c14d7a03ec7",
    caps: "chat, flows",
  },
  {
    id: "anthropic",
    mark: "AN",
    name: "Anthropic",
    kind: "Agent LLM · claude-opus-4-8",
    status: "ok",
    latency: "640ms",
    mock: false,
    keyMasked: "sk-ant-••••1k",
    keyRevealed: "sk-ant-api03-2f8c14d71k",
    caps: "agent",
  },
]

// design reproduction: the design's mock→live readiness gates. `done` reflects a
// representative pre-launch posture (some gates still open before go-live).
const READINESS: readonly ProviderReadinessItem[] = [
  {
    id: "keys",
    label: "Live API keys provisioned for every enabled provider",
    done: true,
  },
  {
    id: "mock-off",
    label: "PAYMENTS_MOCK_MODE / WALLET_MOCK_MODE flipped to false",
    done: true,
  },
  {
    id: "webhooks",
    label: "Provider webhook signatures verified end-to-end",
    done: true,
  },
  {
    id: "recon",
    label: "Reconciliation cron scheduled against live balances",
    done: false,
  },
  {
    id: "swap",
    label: "Swap route (USDT ↔ TRX) enrolled on Blockradar",
    done: false,
  },
]

// Provider status word → the canonical status→token pill variant (§5). Colour is
// never the sole signal — the status word text carries the state.
const STATUS_VARIANT: Record<
  ProviderStatus,
  React.ComponentProps<typeof Badge>["variant"]
> = {
  ok: "success",
  degraded: "warn",
  down: "danger",
  mock: "info",
}

/** The re-auth window (seconds) before a revealed key auto-remasks — design PII copy. */
const REMASK_SECONDS = 30

// ─── Icons (inline stroke SVG, matching the design's 24×24 paths) ───────────────────

function WarningTriangleIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className="text-twn"
    >
      <path
        d="M12 4l9 16H3z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** The readiness-row glyph — a check when done, a dash while pending (design `r.icon`). */
function ReadinessIcon({ done }: { done: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d={done ? "M5 12l5 5L20 7" : "M6 12h12"}
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

// ─── Provider card (design markup lines 6-11) ───────────────────────────────────────

function ProviderCardView({
  provider,
  onReveal,
  revealed,
  onRemask,
}: ProviderCardViewProps) {
  return (
    <div className="rounded-2xl border border-line bg-card px-5 py-[18px]">
      {/* Header: mark + name/kind + status·latency pill (design line 7) */}
      <div className="mb-3 flex items-center gap-3">
        <span
          aria-hidden="true"
          className="flex size-10 flex-none items-center justify-center rounded-[11px] bg-card2 text-sm font-extrabold text-ink"
        >
          {provider.mark}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-extrabold text-ink">{provider.name}</div>
          <div className="truncate text-[11px] text-ink3">{provider.kind}</div>
        </div>
        <Badge variant={STATUS_VARIANT[provider.status]}>
          <span
            aria-hidden="true"
            className="size-1.5 rounded-full bg-current"
          />
          {provider.status} · {provider.latency}
        </Badge>
      </div>

      {/* Optional MOCK-MODE banner (design line 8) */}
      {provider.mock && (
        <div className="mb-2.5 flex items-center gap-2 rounded-[9px] bg-swn px-[11px] py-2">
          <WarningTriangleIcon />
          <span className="text-[11px] font-extrabold tracking-[0.03em] text-twn">
            MOCK MODE ON
          </span>
        </div>
      )}

      {/* Masked API-KEY row with "Reveal · step-up" (design line 9) */}
      <div className="mb-2.5 flex items-center gap-2.5 rounded-[10px] bg-field px-3 py-[9px]">
        <span className="text-[10.5px] font-bold text-ink3">API KEY</span>
        <span className="min-w-0 flex-1 truncate font-mono text-xs font-semibold text-ink">
          {revealed ? provider.keyRevealed : provider.keyMasked}
        </span>
        <button
          type="button"
          onClick={() =>
            revealed ? onRemask(provider.id) : onReveal(provider.id)
          }
          aria-label={
            revealed
              ? `Hide ${provider.name} API key`
              : `Reveal ${provider.name} API key — requires step-up`
          }
          className={`cursor-pointer rounded-md px-1 text-[11px] font-bold outline-none focus-visible:ring-2 focus-visible:ring-ring/50 ${
            revealed ? "text-tdn" : "text-tif"
          }`}
        >
          {revealed ? "Hide" : "Reveal · step-up"}
        </button>
      </div>

      {/* Bound capabilities + Test connection (design line 10) */}
      <div className="flex items-center justify-between gap-3">
        <span className="min-w-0 truncate text-[11px] text-ink3">
          Bound: {provider.caps}
        </span>
        {/* design reproduction: read-shaped confirmation, no live probe (§3.1). */}
        <Button
          variant="outline"
          size="sm"
          type="button"
          aria-label={`Test connection to ${provider.name}`}
          onClick={() =>
            pushToast(`Testing connection to ${provider.name}…`, "info")
          }
        >
          Test connection
        </Button>
      </div>
    </div>
  )
}

// ─── Readiness checklist (design markup lines 14-17) ────────────────────────────────

function ReadinessCard() {
  return (
    <div className="rounded-2xl border border-line bg-card px-5 py-[18px]">
      <div className="mb-3 text-[13px] font-extrabold text-ink">
        Mock → live readiness checklist
      </div>
      {READINESS.map((item) => (
        <div
          key={item.id}
          className="flex items-center gap-[11px] border-b border-line2 py-2 last:border-b-0"
        >
          <span
            aria-hidden="true"
            className={`flex size-5 flex-none items-center justify-center rounded-md ${
              item.done ? "bg-sok text-tok" : "bg-card2 text-ink3"
            }`}
          >
            <ReadinessIcon done={item.done} />
          </span>
          <span className="text-[12.5px] font-semibold text-ink2">
            {item.label}
          </span>
          <span className="sr-only">{item.done ? "done" : "pending"}</span>
        </div>
      ))}
    </div>
  )
}

// ─── Page ───────────────────────────────────────────────────────────────────────────

export function ProvidersPage() {
  // Which provider's key the operator is trying to reveal (drives the step-up modal).
  const [pendingReveal, setPendingReveal] = useState<string | null>(null)
  // The set of providers whose keys are currently revealed (post step-up).
  const [revealedIds, setRevealedIds] = useState<ReadonlySet<string>>(
    () => new Set()
  )
  const [remaskIn, setRemaskIn] = useState(REMASK_SECONDS)

  const onReveal = useCallback((id: string) => setPendingReveal(id), [])

  const onRemask = useCallback((id: string) => {
    setRevealedIds((prev) => {
      const next = new Set(prev)
      next.delete(id)
      return next
    })
  }, [])

  // On a completed step-up (6-digit TOTP), reveal the pending provider + reset the
  // countdown, then close the modal. Presentation-only: the code is not verified
  // against a real endpoint (this is a design reproduction).
  const onStepUpComplete = useCallback(() => {
    setPendingReveal((id) => {
      if (id) {
        setRevealedIds((prev) => new Set(prev).add(id))
        setRemaskIn(REMASK_SECONDS)
      }
      return null
    })
  }, [])

  // Auto-remask every revealed key once the window elapses — ticks only while at
  // least one key is revealed, then clears them all and resets the counter.
  useEffect(() => {
    if (revealedIds.size === 0) return
    const timer = setInterval(() => {
      setRemaskIn((s) => {
        if (s <= 1) {
          setRevealedIds(new Set())
          return REMASK_SECONDS
        }
        return s - 1
      })
    }, 1000)
    return () => clearInterval(timer)
  }, [revealedIds])

  const pendingProvider = PROVIDERS.find((p) => p.id === pendingReveal)

  return (
    <div className="mx-auto w-full max-w-[1200px] px-[30px] pt-[26px] pb-[60px]">
      {/* ── Header (design markup line 3) ──────────────────────────────────────── */}
      <div className="mb-4">
        <h1 className="text-[24px] font-extrabold tracking-[-0.02em] text-ink">
          Providers
        </h1>
        <p className="mt-[5px] text-[13.5px] text-ink2">
          Provider adapters per capability. Secrets are masked — reveal requires
          step-up.
        </p>
      </div>

      {/* Auto-remask banner — visible whenever any key is revealed. */}
      {revealedIds.size > 0 && (
        <div
          role="status"
          className="mb-4 flex items-center gap-2.5 rounded-xl border border-[color:var(--sdn)] bg-sdn px-[15px] py-[11px]"
        >
          <WarningTriangleIcon />
          <span className="flex-1 text-[12.5px] font-semibold text-tdn">
            A provider secret is visible · this access is logged to the audit
            trail. Auto-remasking in{" "}
            <span className="tabular-nums">{remaskIn}</span>s.
          </span>
          <button
            type="button"
            onClick={() => setRevealedIds(new Set())}
            className="text-[12px] font-bold text-tdn underline outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            Re-mask now
          </button>
        </div>
      )}

      {/* ── Provider cards · 1fr 1fr (design markup line 4) ────────────────────── */}
      <div className="mb-4 grid grid-cols-1 gap-3.5 md:grid-cols-2">
        {PROVIDERS.map((provider) => (
          <ProviderCardView
            key={provider.id}
            provider={provider}
            onReveal={onReveal}
            revealed={revealedIds.has(provider.id)}
            onRemask={onRemask}
          />
        ))}
      </div>

      {/* ── Readiness checklist (design markup line 14) ────────────────────────── */}
      <ReadinessCard />

      {/* Reveal-gated step-up: on completion the pending provider's key is shown. */}
      <StepUpModal
        open={pendingReveal !== null}
        title={
          pendingProvider
            ? `Reveal ${pendingProvider.name} API key`
            : "Reveal API key"
        }
        onComplete={onStepUpComplete}
        onOpenChange={(open) => {
          if (!open) setPendingReveal(null)
        }}
      />
    </div>
  )
}
