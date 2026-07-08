import { BrandMark } from "@/components/shared"
import { Button } from "@/components/ui/button"
import { VerificationRow } from "@/components/onboarding/verification-row"
import {
  PhoneIcon,
  CardIcon,
  LockIcon,
  SelfieThumbnail,
} from "@/components/onboarding/kyc-summary-icons"
import type { KycSummaryProps } from "@/types/components"

/**
 * KYC onboarding summary screen (step 3 of 3). Presentational only — receives
 * `onFinish` via props (no router, no store). Composes the header, the
 * verification rows, and the footer CTA (root §16).
 */
export function KycSummary({ onFinish }: KycSummaryProps) {
  return (
    <div className="flex h-full flex-col bg-background">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex-none bg-gradient-to-b from-primary to-primary-deep px-6 pt-14 pb-6 text-primary-foreground">
        <div className="mb-5 flex items-center gap-2.5">
          <BrandMark size={36} />
          <span className="text-base font-bold">Handshake Agent</span>
        </div>

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
        <VerificationRow
          icon={<PhoneIcon />}
          label="Phone number"
          value="+234 802 •••• 1123"
          valueMono
          pillLabel="Verified"
        />
        <VerificationRow
          icon={<CardIcon />}
          label="BVN / NIN"
          value="••• ••• ••91"
          valueMono
          pillLabel="Matched"
        />
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
