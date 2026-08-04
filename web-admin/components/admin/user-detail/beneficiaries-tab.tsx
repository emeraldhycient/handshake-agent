import { beneVerificationMeta } from "@/lib/users/user-detail"
import { BANK_ICON, CRYPTO_ICON } from "@/constants/user-detail"
import type { UdBeneficiariesTabProps } from "@/types"

/** The Beneficiaries tab — saved beneficiaries with a name-enquiry pill + per-row remove. */
export function BeneficiariesTab({
  beneficiaries,
  onRemove,
}: UdBeneficiariesTabProps) {
  return (
    <div className="rounded-2xl border border-line bg-card p-[6px_20px]">
      {beneficiaries.length === 0 ? (
        <div className="py-8 text-center text-[12.5px] text-ink3">
          No saved beneficiaries.
        </div>
      ) : (
        beneficiaries.map((b) => {
          const ne = beneVerificationMeta(b.verificationStatus)
          return (
            <div
              key={b.id}
              className="flex items-center gap-[13px] border-b border-line2 py-[15px]"
            >
              <span className="flex size-[38px] flex-none items-center justify-center rounded-[10px] bg-card2 text-ink2">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path
                    d={b.type === "bank_account" ? BANK_ICON : CRYPTO_ICON}
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-bold">{b.label}</div>
                <div className="font-mono text-[11.5px] text-ink3 capitalize">
                  {b.type.replace(/_/g, " ")}
                </div>
              </div>
              <span
                className="rounded-full px-2.5 py-1 text-[10.5px] font-bold"
                style={{ background: ne.bg, color: ne.fg }}
              >
                {ne.label}
              </span>
              <button
                type="button"
                onClick={() => onRemove(b.id)}
                className="cursor-pointer text-[11.5px] font-bold text-ink3 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                Remove
              </button>
            </div>
          )
        })
      )}
    </div>
  )
}
