"use client"

import { useState } from "react"
import { useProfile } from "@/lib/query/auth"
import { useRefreshIdentity } from "@/lib/query/kyc-onboarding"
import { SumsubVerificationDialog } from "@/components/kyc/SumsubVerificationDialog"
import { cn } from "@/lib/utils"
import { formatFiat } from "@/lib/format"
import {
  tierLabel,
  tierNumber,
  nextKycLevel,
  MAX_TIER,
} from "@/lib/format/tier"
import { maskPhone } from "@/lib/format/phone"
import type { MembershipCardProps } from "@/types"

const COUNTRY_BY_FIAT: Record<string, string> = {
  NGN: "NG",
  GHS: "GH",
  KES: "KE",
}

/**
 * The passport "membership" card — the settings hero. Live data from /profile:
 * tier ring, daily limit + usage, security-strength meter, member-since, and a
 * verify CTA (below the top tier) reusing the Sumsub flow. Read-only.
 */
export function MembershipCard({ density, className }: MembershipCardProps) {
  const profile = useProfile()
  const refreshIdentity = useRefreshIdentity()
  const [verifying, setVerifying] = useState(false)

  const isMobile = density === "mobile"

  if (!profile.data) {
    return (
      <div
        aria-hidden
        className={cn(
          "animate-pulse [background:var(--membership-card-bg)]",
          isMobile
            ? "h-[360px] rounded-[22px]"
            : "sticky top-8 h-[520px] rounded-[26px]",
          className
        )}
      />
    )
  }
  const p = profile.data

  const tierNum = tierNumber(p.kycTier)
  const level = nextKycLevel(p.kycTier)
  const verified = p.kycStatus === "verified" || tierNum >= 2
  const usedPct =
    p.limits && p.limits.dailyFiatMax > 0
      ? Math.min(
          100,
          Math.round((p.limits.dailyFiatUsed / p.limits.dailyFiatMax) * 100)
        )
      : 0
  const country = COUNTRY_BY_FIAT[p.fiatCurrency] ?? p.fiatCurrency
  const memberSince = p.memberSince
    ? new Date(p.memberSince)
        .toLocaleDateString("en-GB", { month: "short", year: "numeric" })
        .toUpperCase()
    : null

  return (
    <div
      className={cn(
        "relative overflow-hidden text-white [background:var(--membership-card-bg)]",
        isMobile
          ? "rounded-[22px] p-5 shadow-[0_16px_40px_rgb(14_36_28/0.3)]"
          : "sticky top-8 rounded-[26px] p-[26px] shadow-[0_24px_60px_rgb(14_36_28/0.32)]",
        className
      )}
    >
      <div
        className={cn(
          "pointer-events-none absolute rounded-full [background:var(--membership-glow)]",
          isMobile
            ? "-top-[70px] -right-[60px] h-[220px] w-[220px]"
            : "-top-[90px] -right-[70px] h-[260px] w-[260px]"
        )}
      />

      {/* Row 1 — Membership label + chip svg */}
      <div
        className={cn(
          "relative flex items-center justify-between",
          isMobile ? "mb-[18px]" : "mb-6"
        )}
      >
        <span
          className={cn(
            "mono font-medium tracking-[0.14em] text-membership-sage/60 uppercase",
            isMobile ? "text-[10.5px]" : "text-[11px]"
          )}
        >
          Membership
        </span>
        <ChipIcon mobile={isMobile} />
      </div>

      {/* Row 2 — avatar + name/phone (+ inline tier pill on mobile) */}
      <div
        className={cn(
          "relative flex items-center",
          isMobile ? "mb-4 gap-[13px]" : "mb-[22px] gap-[14px]"
        )}
      >
        <div
          className={cn(
            "flex-none rounded-full shadow-[0_0_0_3px_rgb(245_166_35/0.35)] [background:var(--membership-avatar)]",
            isMobile ? "h-[52px] w-[52px]" : "h-[60px] w-[60px]"
          )}
        />
        <div className="min-w-0 flex-1">
          <div
            className={cn(
              "font-extrabold tracking-[-0.01em]",
              isMobile ? "text-[18px]" : "text-[19px]"
            )}
          >
            {p.fullName ?? p.email.split("@")[0]}
          </div>
          <div
            className={cn(
              "mono mt-0.5 text-membership-sage/[.62]",
              isMobile ? "text-[12.5px]" : "text-[13px]"
            )}
          >
            {maskPhone(p.phone)}
          </div>
        </div>
        {isMobile && (
          <VerifiedPill
            mobile
            verified={verified}
            tier={tierLabel(p.kycTier)}
          />
        )}
      </div>

      {!isMobile && (
        <VerifiedPill verified={verified} tier={tierLabel(p.kycTier)} />
      )}

      <div
        className={cn(
          "relative h-px bg-white/10",
          isMobile ? "mb-4" : "mb-[22px]"
        )}
      />

      {/* Tier ring + daily limit/usage */}
      <div
        className={cn(
          "relative flex items-center",
          isMobile ? "mb-4 gap-4" : "mb-[22px] gap-5"
        )}
      >
        <TierRing tierNum={tierNum} mobile={isMobile} />
        <div className="min-w-0 flex-1">
          <div
            className={cn(
              "font-semibold text-membership-sage/[.62]",
              isMobile ? "text-[11.5px]" : "text-[12px]"
            )}
          >
            Daily transfer limit
          </div>
          <div
            className={cn(
              "mt-0.5 font-extrabold tracking-[-0.02em] tabular-nums",
              isMobile ? "text-[22px]" : "text-[24px]"
            )}
          >
            {p.limits ? formatFiat(p.limits.dailyFiatMax, p.fiatCurrency) : "—"}
          </div>
          <div
            className={cn(
              "overflow-hidden rounded-full bg-white/[.13]",
              isMobile ? "mt-[9px] h-[6px]" : "mt-2.5 h-[7px]"
            )}
          >
            <div
              className="h-full rounded-full [background:var(--membership-usage-fill)]"
              style={{ width: `${usedPct}%` }}
            />
          </div>
          <div
            className={cn(
              "mt-1.5 text-membership-sage/[.55] tabular-nums",
              isMobile ? "text-[11px]" : "text-[11.5px]"
            )}
          >
            {p.limits
              ? `${formatFiat(p.limits.dailyFiatUsed, p.fiatCurrency)} used today`
              : "No limit yet"}
          </div>
        </div>
      </div>

      {level && (
        <button
          type="button"
          onClick={() => setVerifying(true)}
          className="relative mb-[22px] flex w-full items-center justify-center gap-1.5 rounded-[12px] border border-accent/25 bg-accent/[.12] py-2.5 text-[12.5px] font-bold text-accent transition-colors hover:bg-accent/20"
        >
          {level === "tier_3"
            ? "Verify address to raise limits"
            : "Verify to reach Tier 2"}
          <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
            <path
              d="M5 3l4 4-4 4"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      )}

      <div
        className={cn(
          "relative h-px bg-white/10",
          isMobile ? "mb-[15px]" : "mb-5"
        )}
      />

      {/* Security strength */}
      <div
        className={cn(
          "relative flex items-center",
          isMobile ? "gap-[11px]" : "mb-[22px] gap-3"
        )}
      >
        {!isMobile && (
          <div className="flex h-9 w-9 flex-none items-center justify-center rounded-[10px] bg-white/[.06]">
            <ShieldIcon />
          </div>
        )}
        {isMobile && <ShieldIcon />}
        <div className="min-w-0 flex-1">
          <div
            className={cn(
              "flex items-center justify-between",
              isMobile ? "mb-[5px]" : "mb-1.5"
            )}
          >
            <span
              className={cn(
                "font-bold",
                isMobile ? "text-[12.5px]" : "text-[13.5px]"
              )}
            >
              Security
            </span>
            <span
              className={cn(
                "font-bold text-membership-mint capitalize",
                isMobile ? "text-[11.5px]" : "text-[12px]"
              )}
            >
              {p.security.label}
            </span>
          </div>
          <SecurityBars score={p.security.score} />
        </div>
      </div>

      {!isMobile && (
        <div className="relative flex items-center justify-between">
          <span className="mono text-[11px] tracking-[0.05em] text-membership-sage/50">
            {memberSince ? `MEMBER SINCE ${memberSince}` : "MEMBER"}
          </span>
          <span className="mono text-[11px] tracking-[0.05em] text-accent/85">
            HSK · {country}
          </span>
        </div>
      )}

      {level && (
        <SumsubVerificationDialog
          open={verifying}
          onOpenChange={setVerifying}
          level={level}
          onSubmitted={() => {
            setVerifying(false)
            refreshIdentity()
          }}
        />
      )}
    </div>
  )
}

function VerifiedPill({
  verified,
  tier,
  mobile,
}: {
  verified: boolean
  tier: string
  mobile?: boolean
}) {
  return (
    <div
      className={cn(
        "inline-flex flex-none items-center rounded-full border border-membership-mint/30 bg-membership-mint/15 font-bold text-membership-mint-soft",
        mobile
          ? "gap-[5px] px-[10px] py-[5px] text-[11.5px]"
          : "relative mb-6 gap-1.5 px-3 py-1.5 text-[12.5px]"
      )}
    >
      <svg
        width={mobile ? 11 : 12}
        height={mobile ? 11 : 12}
        viewBox="0 0 12 12"
        fill="none"
      >
        <path
          d="M2.5 6.2l2.3 2.3L9.5 3.8"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {mobile ? tier : `${verified ? "Verified · " : ""}${tier}`}
    </div>
  )
}

function TierRing({ tierNum, mobile }: { tierNum: number; mobile: boolean }) {
  const size = mobile ? 76 : 96
  const r = mobile ? 32 : 40
  const sw = mobile ? 7 : 8
  const c = 2 * Math.PI * r
  const arc = (Math.min(tierNum, MAX_TIER) / MAX_TIER) * c
  return (
    <div
      className={cn(
        "relative flex-none",
        mobile ? "h-[76px] w-[76px]" : "h-24 w-24"
      )}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        fill="none"
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke="rgb(255 255 255 / 0.13)"
          strokeWidth={sw}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke="#f5a623"
          strokeWidth={sw}
          strokeLinecap="round"
          strokeDasharray={`${arc} ${c}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <div
        className={cn(
          "absolute inset-0 flex flex-col items-center justify-center",
          mobile ? "gap-1" : "gap-1.5"
        )}
      >
        <span
          className={cn(
            "leading-none font-semibold tracking-[0.12em] text-membership-sage/75 uppercase",
            mobile ? "text-[9px]" : "text-[10px]"
          )}
        >
          Tier
        </span>
        <span
          className={cn(
            "leading-none font-extrabold",
            mobile ? "text-[20px]" : "text-[26px]"
          )}
        >
          {tierNum}
        </span>
        <span
          className={cn(
            "leading-none text-membership-sage/70",
            mobile ? "text-[9px]" : "text-[10px]"
          )}
        >
          of {MAX_TIER}
        </span>
      </div>
    </div>
  )
}

function SecurityBars({ score }: { score: number }) {
  return (
    <div className="flex gap-1">
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className={cn(
            "h-[5px] flex-1 rounded-[3px]",
            i < score ? "bg-membership-mint" : "bg-white/[.16]"
          )}
        />
      ))}
    </div>
  )
}

function ChipIcon({ mobile }: { mobile: boolean }) {
  return (
    <svg
      width={mobile ? 28 : 30}
      height={mobile ? 22 : 24}
      viewBox="0 0 30 24"
      fill="none"
    >
      <rect
        x="1"
        y="1"
        width="28"
        height="22"
        rx="4"
        stroke="rgb(245 166 35 / 0.45)"
        strokeWidth="1.2"
      />
      <path
        d="M1 8h28M10 1v22M20 1v22"
        stroke="rgb(245 166 35 / 0.3)"
        strokeWidth="1.1"
      />
    </svg>
  )
}

function ShieldIcon() {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 18 18"
      fill="none"
      className="flex-none"
    >
      <path
        d="M9 1.5l6 2.2v4.1c0 3.8-2.6 6.6-6 8-3.4-1.4-6-4.2-6-8V3.7L9 1.5z"
        stroke="#7fd6a3"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path
        d="M6.4 9l1.8 1.8L11.8 7"
        stroke="#7fd6a3"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
