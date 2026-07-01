"use client"

/**
 * FlagsPage — the feature-flags operator screen (operator-console design system
 * §6.28, `docs/design-ref/screens/Flags.html`).
 *
 * PIXEL-FOR-PIXEL design reproduction. This screen intentionally renders the
 * design's OWN mock flag content — non-pricing product flags with a per-cohort /
 * percentage rollout chip, an `eval → on/off` effective-evaluation preview, and a
 * soft toggle — so it looks exactly like the imported design. Real-data
 * reintegration (the effective-config registry + PATCH/step-up path) is a separate
 * later step; there is no `useQuery`/data-fetch here.
 *
 * Structure (from the exact markup): a centered `max-w-[1000px]` column — a title +
 * subtitle header, then a `flex-col gap-3` stack of full-width flag rows. Each row is
 * a `rounded-[16px]` card (`padding:16px 20px`): a left column (mono key · desc · a
 * rollout chip + `eval →` line) and a trailing 52×30 soft toggle.
 *
 * The design's toggle carries an `onToggle` handler. Flipping a product flag is a
 * dual-control config change, so toggling opens the shared MakerCheckerModal (the
 * design's destination). Nothing moves money (§3.1).
 */
import { useState } from "react"

import { MakerCheckerModal } from "@/components/admin/flows"
import { cn } from "@/lib/utils"
import type { FeatureFlagRow, MakerCheckerDiffRow } from "@/types/components"

// The design's own mock flag seed (docs/design-ref/screens/Flags.html), reproduced
// faithfully against the seed dataset shapes (logic.js flag-key style: mono dot-path
// keys, per-cohort / percentage rollout). Values match the design's representative
// content so the screen shows the same rows as the imported design.
const FLAG_ROWS: readonly FeatureFlagRow[] = [
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
  },
  {
    key: "ticketing.enabled",
    desc: "Discover and buy event tickets in chat",
    rollout: "cohort · early access",
    on: false,
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
 * One flag row — matches the design markup exactly (row card, mono key, desc,
 * rollout chip + `eval →` line, and a 52×30 soft toggle). The toggle is a design-
 * faithful raw track/knob (distinct 52×30 dimensions the shared Switch does not
 * carry), rendered as an accessible switch button.
 */
function FlagRow({
  flag,
  onToggle,
}: {
  flag: FeatureFlagRow
  onToggle: (flag: FeatureFlagRow) => void
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

export function FlagsPage() {
  // Which flag's toggle is pending dual-control approval (drives the modal).
  const [pending, setPending] = useState<FeatureFlagRow | null>(null)

  const diff: MakerCheckerDiffRow[] = pending
    ? [
        {
          field: `${pending.key} · enabled`,
          from: pending.on ? "on" : "off",
          to: pending.on ? "off" : "on",
        },
      ]
    : []

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

      {/* ── Flag rows ───────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3">
        {FLAG_ROWS.map((flag) => (
          <FlagRow key={flag.key} flag={flag} onToggle={setPending} />
        ))}
      </div>

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
        onSubmit={() => setPending(null)}
      />
    </div>
  )
}
