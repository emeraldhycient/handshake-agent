import { cn } from "@/lib/utils"
import { StatusPill } from "@/components/shared"
import { Button } from "@/components/ui/button"
import type { KycSummaryProps, VerificationRowProps } from "@/types/components"

/**
 * KYC onboarding summary screen — Phase 14.1.
 * Presentational only: receives `onFinish` via props, no router, no store.
 * Token-only styling — no hex literals. (§13 + CLAUDE.md §4.2)
 */
export function KycSummary({ onFinish }: KycSummaryProps) {
  return (
    <div className="flex h-full flex-col bg-background">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex-none bg-gradient-to-b from-primary to-primary-deep px-6 pt-14 pb-6 text-primary-foreground">
        {/* Brand lockup */}
        <div className="mb-5 flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-b from-accent to-accent-deep">
            <div className="h-3.5 w-3.5 rounded-[3px] bg-primary-deep" />
          </div>
          <span className="text-base font-bold">Handshake Agent</span>
        </div>

        {/* Heading */}
        <h1 className="text-2xl leading-tight font-extrabold tracking-tight">
          Let&apos;s verify it&apos;s you
        </h1>
        <p className="mt-2 max-w-[300px] text-sm leading-snug text-primary-foreground/75">
          A one-time check keeps your money safe and meets Nigerian regulations.
          It takes about a minute.
        </p>

        {/* 3-segment progress bar: 2 filled amber + 1 dim */}
        <div className="mt-5 flex gap-1.5">
          <div className="h-1 flex-1 rounded-full bg-accent" />
          <div className="h-1 flex-1 rounded-full bg-accent" />
          <div className="h-1 flex-1 rounded-full bg-accent/40" />
        </div>
        <p className="mt-2 text-xs text-primary-foreground/70">
          Step 3 of 3 · Confirm &amp; finish
        </p>
      </div>

      {/* ── Verification rows ───────────────────────────────────────────────── */}
      <div className="flex flex-1 flex-col gap-2.5 overflow-y-auto px-4 pt-4">
        {/* Row 1 — Phone number */}
        <VerificationRow
          icon={<PhoneIcon />}
          label="Phone number"
          value="+234 802 •••• 1123"
          valueMono
          pillLabel="Verified"
        />

        {/* Row 2 — BVN / NIN */}
        <VerificationRow
          icon={<CardIcon />}
          label="BVN / NIN"
          value="••• ••• ••91"
          valueMono
          pillLabel="Matched"
        />

        {/* Row 3 — Liveness selfie: circular thumbnail as left-slot override */}
        <VerificationRow
          iconNode={<SelfieThumbnail />}
          label="Liveness selfie"
          value="Face captured"
          pillLabel="Done"
        />

        {/* Encryption note */}
        <div className="flex items-center gap-2 px-1 py-1.5 text-muted-foreground">
          <LockIcon />
          <span className="text-[12.5px] leading-snug">
            256-bit encryption. We never sell or share your data.
          </span>
        </div>
      </div>

      {/* ── Footer CTA ─────────────────────────────────────────────────────── */}
      <div className="flex-none bg-background px-4 pt-3.5 pb-7">
        <Button
          className="h-auto w-full rounded-2xl bg-accent py-4 text-base font-bold text-accent-foreground shadow-cta hover:bg-accent-deep"
          onClick={onFinish}
        >
          Finish &amp; open my wallet
        </Button>
        <p className="mt-2.5 text-center text-[11.5px] text-muted-foreground-subtle">
          Bank-grade security · NDPR &amp; CBN compliant
        </p>
      </div>
    </div>
  )
}

// ─── Internal sub-components ─────────────────────────────────────────────────

/**
 * Renders a single verification card row.
 * When `iconNode` is provided it is placed directly in the left slot (used for
 * the selfie circular thumbnail). Otherwise `icon` is wrapped in the standard
 * square icon-box.
 */
function VerificationRow({
  iconNode,
  icon,
  label,
  value,
  valueMono,
  pillLabel,
}: VerificationRowProps) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3.5">
      {/* Left slot */}
      {iconNode ?? (
        /* Token-tinted icon box */
        <div className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-background">
          {icon}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold text-muted-foreground">{label}</p>
        <p
          className={cn(
            "text-[15px] font-bold text-foreground",
            valueMono && "font-mono tabular-nums"
          )}
        >
          {value}
        </p>
      </div>
      <StatusPill tone="success" className="flex-none">
        {pillLabel}
      </StatusPill>
    </div>
  )
}

/**
 * Circular selfie placeholder with a token-based stripe gradient.
 * No hex literals — uses color-mix over CSS custom properties.
 */
function SelfieThumbnail() {
  return (
    <div
      className={cn(
        "flex h-11 w-11 flex-none items-end justify-center overflow-hidden rounded-full",
        "border border-border"
      )}
      style={{
        backgroundImage:
          "repeating-linear-gradient(45deg, color-mix(in oklch, var(--border) 55%, var(--background)) 0 5px, var(--card-muted) 5px 10px)",
      }}
      aria-hidden
    >
      <span className="mb-1 font-mono text-[6px] font-bold tracking-wider text-muted-foreground uppercase">
        SELFIE
      </span>
    </div>
  )
}

// ─── Icon SVGs (aria-hidden, token-stroked) ───────────────────────────────────

function PhoneIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 18 18"
      fill="none"
      aria-hidden="true"
    >
      <rect
        x="4.5"
        y="1.5"
        width="9"
        height="15"
        rx="2.2"
        stroke="currentColor"
        strokeWidth="1.5"
        className="text-primary"
      />
      <circle
        cx="9"
        cy="13.5"
        r="0.9"
        fill="currentColor"
        className="text-primary"
      />
    </svg>
  )
}

function CardIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 18 18"
      fill="none"
      aria-hidden="true"
    >
      <rect
        x="1.5"
        y="3.5"
        width="15"
        height="11"
        rx="2.2"
        stroke="currentColor"
        strokeWidth="1.5"
        className="text-primary"
      />
      <path
        d="M1.5 7h15"
        stroke="currentColor"
        strokeWidth="1.5"
        className="text-primary"
      />
    </svg>
  )
}

function LockIcon() {
  return (
    <svg
      width="14"
      height="15"
      viewBox="0 0 14 15"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M3.5 7V5a3.5 3.5 0 017 0v2"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        className="text-muted-foreground"
      />
      <rect
        x="1.8"
        y="7"
        width="10.4"
        height="6.5"
        rx="2"
        fill="currentColor"
        className="text-muted-foreground"
      />
    </svg>
  )
}
