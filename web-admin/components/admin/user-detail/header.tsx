"use client"

/**
 * UserDetailHeader — the back-link + identity card (avatar monogram, name, FROZEN /
 * KYC / SIM-swap pills, copyable id) and the freeze / add-note / resend actions.
 * Presentation only; name/initials/frozen/KYC-pill derive from `detail`/`kyc` and
 * every action is a callback the orchestrator's step-up-gated hook owns (§3.1).
 */
import { cn } from "@/lib/utils"
import { pushToast } from "@/lib/store/toast-store"
import { displayName, initialsOf } from "@/lib/users/user-detail"
import { KYC_STATUS_META, U_ACTIONS } from "@/constants/user-detail"
import type { UserDetailHeaderProps } from "@/types"

export function UserDetailHeader({
  detail,
  kyc,
  simSwapFlagged,
  onBack,
  onFreeze,
  onAddNote,
  onResend,
}: UserDetailHeaderProps) {
  const name = displayName(kyc, detail)
  const initials = initialsOf(name)
  const frozen = detail.status === "suspended"
  const kycMeta = KYC_STATUS_META[detail.kycStatus]

  return (
    <>
      {/* Back-link */}
      <button
        type="button"
        onClick={onBack}
        className="mb-3.5 inline-flex cursor-pointer items-center gap-[7px] text-[12.5px] font-bold text-ink2 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path
            d="M14 6l-6 6 6 6"
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        All users
      </button>

      {/* HEADER */}
      <div className="mb-3.5 rounded-[18px] border border-line bg-card p-[20px_22px]">
        <div className="flex flex-wrap items-start gap-4">
          <span
            className="flex size-14 flex-none items-center justify-center rounded-full text-xl font-extrabold text-white"
            style={{ background: "#2a6f55" }}
          >
            {initials}
          </span>
          <div className="min-w-[200px] flex-1">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-[21px] font-extrabold tracking-[-0.02em]">
                {name}
              </h1>
              {frozen && (
                <span className="rounded-full bg-sdn px-2.5 py-[3px] text-[11px] font-extrabold text-tdn">
                  FROZEN
                </span>
              )}
              <span
                className="inline-flex items-center gap-[5px] rounded-full px-2.5 py-[3px] text-[11px] font-bold"
                style={{ background: kycMeta.bg, color: kycMeta.fg }}
              >
                {kycMeta.label} · {detail.kycTier}
              </span>
            </div>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard?.writeText(detail.id)
                pushToast(`Copied · ${detail.id}`, "copy")
              }}
              className="mt-1.5 inline-flex cursor-pointer items-center gap-1.5 font-mono text-xs text-ink3 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              {detail.id}
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden
              >
                <path
                  d="M9 9h10v10H9zM5 15V5h10"
                  stroke="currentColor"
                  strokeWidth="1.8"
                />
              </svg>
            </button>
            {/* Flag chips — the SIM-swap risk flag when detected (else an empty row). */}
            <div className="mt-2 flex flex-wrap gap-1.5">
              {simSwapFlagged && (
                <span className="rounded-full bg-sdn px-2.5 py-[3px] text-[10.5px] font-extrabold text-tdn">
                  SIM-SWAP
                </span>
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {U_ACTIONS.map((a) => {
              // Freeze ↔ Unfreeze mirrors the account status; the rest are static.
              const label = a.key === "freeze" && frozen ? "Unfreeze" : a.label
              return (
                <button
                  key={a.key}
                  type="button"
                  title={label}
                  onClick={() => {
                    if (a.key === "freeze") onFreeze()
                    else if (a.key === "note") onAddNote()
                    else if (a.key === "resend") onResend()
                  }}
                  className={cn(
                    "flex h-9 cursor-pointer items-center gap-[7px] rounded-[10px] border px-[13px] text-[12.5px] font-bold focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                    a.danger
                      ? "border-[#f0d0cb] bg-sdn text-tdn hover:bg-sdn/80"
                      : "border-line bg-card text-ink hover:bg-hov"
                  )}
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    aria-hidden
                  >
                    <path
                      d={a.icon}
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  {label}
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </>
  )
}
