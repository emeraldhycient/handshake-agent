"use client"

/**
 * FlagsPage — the feature-flags operator screen (operator-console design system
 * §6.28, `docs/design-ref/screens/Flags.html`).
 *
 * Structure: a centered `max-w-[1000px]` column — a title + subtitle header, then a
 * `flex-col gap-3` stack of full-width flag rows. Each row is a `rounded-[16px]` card
 * (`padding:16px 20px`): a left column (mono key · desc · a rollout chip + `eval →`
 * line) and a trailing 52×30 soft toggle.
 *
 * WIRED (Phase 6a): the flags that ARE registry keys have a REAL effective state,
 * resolved from GET /admin/settings (`useSettings()`): `swap.enabled` ←
 * `catalog.capabilities.crypto.swap`, `ticketing.enabled` ← `ticketing.enabled`,
 * (the FE key names differ from the registry dot-paths, so a key-map bridges them).
 * The remaining design flags (voice_notes.web / voice_notes.whatsapp /
 * beneficiary_flow.whatsapp / kyc.tier_3) have NO registry key — they keep their
 * design-faithful state and are recorded as shapeGaps. The per-cohort / percentage
 * `rollout` chip is ALSO not modeled (the layered config is a single global boolean
 * per key, with no cohort/percentage rollout engine), so the rollout label stays as
 * design-faithful presentation — shapeGap. Four async branches: loading/error/empty/data.
 *
 * Flipping a product flag is a dual-control config change, so toggling opens the
 * shared MakerCheckerModal. WIRED (Phase 7 — WRITE): for a REGISTRY-BACKED flag (one
 * with a `settingKey`), the maker-checker submit calls the real step-up-guarded
 * PATCH /admin/settings/:key (`useSetSetting`) to flip the boolean, then invalidates
 * the settings query so the row re-resolves with its new effective value. A 403
 * ADMIN_STEP_UP_REQUIRED opens the StepUpDialog and the PATCH replays after re-auth
 * (`useStepUpRetry`). Unbacked flags have no registry key to persist — their toggle
 * stays an acknowledged design intent (shapeGap). Nothing moves money (§3.1).
 */
import { useMemo, useState } from "react"

import type { EffectiveSetting } from "@handshake-agent/contracts"

import { MakerCheckerModal } from "@/components/admin/flows"
import { StepUpDialog } from "@/components/admin/step-up-dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { ApiError } from "@/lib/api/client"
import { pushToast } from "@/lib/store/toast-store"
import { useAdminMe, useSetSetting, useSettings } from "@/lib/query/hooks"
import { useStepUpRetry } from "@/lib/hooks/use-step-up-retry"
import { cn } from "@/lib/utils"
import type { FeatureFlagRow, MakerCheckerDiffRow } from "@/types/components"

/**
 * The design's flag rows. `settingKey` bridges the FE flag key → the registry
 * dot-path that backs it; when present, the row's `on` (and thus `eval →`) is the
 * real effective value. Rows without a `settingKey` are NOT registry-backed — they
 * keep their design-faithful `on` (recorded as a shapeGap). `rollout` is always
 * design-faithful (no cohort/percentage rollout engine — shapeGap).
 */
interface FlagDefinition extends FeatureFlagRow {
  /** The registry key backing this flag, or undefined when not backed. */
  settingKey?: string
}

const FLAG_DEFS: readonly FlagDefinition[] = [
  {
    key: "voice_notes.web",
    desc: "Accept voice-note input in the web chat composer",
    rollout: "100% · all users",
    on: true,
  },
  {
    key: "voice_notes.whatsapp",
    desc: "Transcribe inbound WhatsApp voice notes",
    rollout: "100% · all users",
    on: true,
  },
  {
    key: "swap.enabled",
    desc: "Asset-to-asset swap in chat (≥2 enabled assets)",
    rollout: "gradual · 25% cohort",
    on: true,
    settingKey: "catalog.capabilities.crypto.swap",
  },
  {
    key: "ticketing.enabled",
    desc: "Discover and buy event tickets in chat",
    rollout: "cohort · early access",
    on: false,
    settingKey: "ticketing.enabled",
  },
  {
    key: "beneficiary_flow.whatsapp",
    desc: "Add a beneficiary in-thread via WhatsApp Flow",
    rollout: "gradual · 50% cohort",
    on: true,
  },
  {
    key: "kyc.tier_3",
    desc: "Allow tier-3 KYC upgrade requests",
    rollout: "cohort · pilot users",
    on: false,
  },
] as const

/** The soft toggle track/knob dimensions (design markup: 52×30 track, 24px knob). */
const KNOB_ON = "25px" // 52 − 24 − 3 (right inset matches the 3px left inset)
const KNOB_OFF = "3px"

/**
 * A resolved flag row plus the registry key (if any) that backs it — carried so the
 * write path knows whether it can persist a flip via the settings PATCH. The scope
 * mirrors the backing setting so the override targets the same leaf the read resolved.
 */
interface ResolvedFlag extends FeatureFlagRow {
  settingKey?: string
  scope: EffectiveSetting["scope"]
  scopeValue: string | null
}

/**
 * Resolve each flag's effective `on`: a registry-backed flag takes the boolean value
 * of its backing setting (fail-closed — absent / non-boolean → false); an unbacked
 * flag keeps its design-faithful default. Carries the backing key + scope for the
 * write path.
 */
function resolveFlags(settings: readonly EffectiveSetting[]): ResolvedFlag[] {
  const byKey = new Map(settings.map((s) => [s.key, s]))
  return FLAG_DEFS.map((def) => {
    const backing = def.settingKey ? byKey.get(def.settingKey) : undefined
    const on = backing ? backing.value === true : def.on
    return {
      key: def.key,
      desc: def.desc,
      rollout: def.rollout,
      on,
      settingKey: def.settingKey,
      scope: backing?.scope ?? "global",
      scopeValue: backing?.scopeValue ?? null,
    }
  })
}

/**
 * One flag row — matches the design markup exactly (row card, mono key, desc,
 * rollout chip + `eval →` line, and a 52×30 soft toggle). The toggle is a design-
 * faithful raw track/knob (distinct 52×30 dimensions the shared Switch does not
 * carry), rendered as an accessible switch button.
 */
function FlagRow({
  flag,
  onToggle,
}: {
  flag: ResolvedFlag
  onToggle: (flag: ResolvedFlag) => void
}) {
  return (
    <div className="flex items-center gap-4 rounded-[16px] border border-line bg-card px-5 py-4">
      {/* ── Flag identity (mono key · desc · rollout chip + eval preview) ────── */}
      <div className="min-w-0 flex-1">
        <div className="font-mono text-[13.5px] font-extrabold text-ink">
          {flag.key}
        </div>
        <div className="mt-[3px] text-[12px] text-ink3">{flag.desc}</div>
        <div className="mt-2 flex items-center gap-2">
          <span className="rounded-[6px] bg-card2 px-2 py-0.5 text-[10.5px] font-bold text-ink2">
            {flag.rollout}
          </span>
          <span className="text-[10.5px] text-ink3">
            eval → {flag.on ? "on" : "off"}
          </span>
        </div>
      </div>

      {/* ── Soft toggle (52×30, brand-green track on / card2 off) ────────────── */}
      <button
        type="button"
        role="switch"
        aria-checked={flag.on}
        aria-label={`${flag.on ? "Disable" : "Enable"} ${flag.key}`}
        onClick={() => onToggle(flag)}
        className={cn(
          "relative h-[30px] w-[52px] flex-none rounded-full transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
          flag.on ? "bg-brand-green" : "bg-card2"
        )}
      >
        <span
          aria-hidden="true"
          className="absolute top-[3px] size-6 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.25)] transition-[left] duration-150"
          style={{ left: flag.on ? KNOB_ON : KNOB_OFF }}
        />
      </button>
    </div>
  )
}

/** Normalizes a mutation/step-up failure into a user-facing message. */
function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error) return error.message
  return "Something went wrong."
}

export function FlagsPage() {
  const query = useSettings()
  const rows = useMemo(() => resolveFlags(query.data ?? []), [query.data])

  const me = useAdminMe()
  const setSetting = useSetSetting()
  const stepUp = useStepUpRetry()

  // Which flag's toggle is pending dual-control approval (drives the modal + write).
  const [pending, setPending] = useState<ResolvedFlag | null>(null)

  const diff: MakerCheckerDiffRow[] = pending
    ? [
        {
          field: `${pending.key} · enabled`,
          from: pending.on ? "on" : "off",
          to: pending.on ? "off" : "on",
        },
      ]
    : []

  /**
   * Dual-control approved. A REGISTRY-BACKED flag persists the flip via the real
   * step-up-guarded PATCH /admin/settings/:key (`useSetSetting`), which re-validates
   * + hot-reloads + audits `config_change` server-side; the settings query then
   * invalidates so the row re-resolves. A 403 ADMIN_STEP_UP_REQUIRED opens the
   * StepUpDialog and the PATCH replays after re-auth. An UNBACKED flag has no key to
   * persist — it stays an acknowledged design intent. Nothing moves money (§3.1).
   */
  const applyToggle = () => {
    if (!pending) return
    const flag = pending
    const nextOn = !flag.on
    setPending(null)

    if (!flag.settingKey) {
      pushToast(`${flag.key} · eval → ${nextOn ? "on" : "off"}`, "ok")
      return
    }

    const key = flag.settingKey
    void (async () => {
      try {
        const ok = await stepUp.run(() =>
          setSetting
            .mutateAsync({
              key,
              input: { value: nextOn, scope: flag.scope, scopeValue: flag.scopeValue },
            })
            .then(() => undefined)
        )
        if (ok) pushToast(`${flag.key} · eval → ${nextOn ? "on" : "off"}`, "ok")
      } catch (error) {
        pushToast(errorMessage(error), "warn")
      }
    })()
  }

  return (
    <div className="mx-auto w-full max-w-[1000px] px-[30px] pt-[26px] pb-[60px]">
      {/* ── Page header ─────────────────────────────────────────────────────── */}
      <div className="mb-4">
        <h1 className="text-[24px] font-extrabold tracking-[-0.02em] text-ink">
          Feature flags
        </h1>
        <p className="mt-[5px] text-[13.5px] text-ink2">
          Non-pricing product flags with per-cohort / percentage rollout and
          effective-evaluation preview.
        </p>
      </div>

      {/* ── Loading ─────────────────────────────────────────────────────────── */}
      {query.isLoading && (
        <div className="flex flex-col gap-3" aria-busy="true">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-[86px] rounded-[16px]" />
          ))}
        </div>
      )}

      {/* ── Error ───────────────────────────────────────────────────────────── */}
      {query.isError && (
        <div className="rounded-[16px] border border-sdn bg-sdn/40 p-6 text-center">
          <p className="text-sm font-bold text-tdn">Failed to load flags</p>
          <p className="mt-1 text-[12.5px] text-ink2">
            The feature-flag registry could not be read.
          </p>
          <button
            type="button"
            onClick={() => query.refetch()}
            className="mt-3 inline-flex items-center rounded-[9px] border border-line bg-card px-3 py-[7px] text-[11.5px] font-bold text-ink transition-colors hover:bg-hov focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            Retry
          </button>
        </div>
      )}

      {/* ── Flag rows (data) ────────────────────────────────────────────────── */}
      {query.isSuccess && (
        <div className="flex flex-col gap-3">
          {rows.map((flag) => (
            <FlagRow key={flag.key} flag={flag} onToggle={setPending} />
          ))}
        </div>
      )}

      {/* ── Maker-checker flow (the design's toggle destination) ────────────── */}
      <MakerCheckerModal
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null)
        }}
        title={
          pending
            ? `${pending.on ? "Disable" : "Enable"} ${pending.key}`
            : "Feature-flag change"
        }
        diff={diff}
        onSubmit={applyToggle}
      />

      {/* Server-side step-up re-auth: a 403 on the flag PATCH opens this; the PATCH
          replays after re-authentication (settings then invalidate to re-resolve). */}
      <StepUpDialog
        open={stepUp.open}
        mfaEnabled={me.data?.mfaEnabled ?? false}
        onOpenChange={stepUp.setOpen}
        onSuccess={() => {
          void stepUp
            .retry()
            .then(() => undefined)
            .catch((error) => pushToast(errorMessage(error), "warn"))
        }}
      />
    </div>
  )
}
