import { Panel } from "@/components/admin/user-detail/panel"
import { NOT_PROVIDED } from "@/constants/user-detail"
import type { UdKycIdentityPanelProps } from "@/types/components"

/**
 * The KYC tab's left column — identity documents (NIN/BVN shown as last-4 only; the
 * full value is never fetched or revealed, §3.4), the ID/selfie placeholders, and
 * the liveness & document result. Read-only.
 */
export function KycIdentityPanel({ kyc }: UdKycIdentityPanelProps) {
  // Last-4 PII from the KYC submission — the full value is never sent by the API.
  const ninShown = kyc?.ninLast4 ? "••• ••• ••" + kyc.ninLast4.slice(-2) : "—"
  const bvnShown = kyc?.bvnLast4 ? "••• ••• ••" + kyc.bvnLast4.slice(-2) : "—"

  return (
    <div className="flex flex-col gap-3.5">
      <Panel>
        <div className="mb-3 text-[13px] font-extrabold">
          Identity documents
        </div>
        <div className="flex flex-col gap-2.5">
          {/* NIN */}
          <div className="flex items-center gap-[13px] rounded-xl border border-line p-[12px_14px]">
            <span className="flex size-[38px] flex-none items-center justify-center rounded-[10px] bg-card2 text-ink2">
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden
              >
                <rect
                  x="3"
                  y="5"
                  width="18"
                  height="14"
                  rx="2"
                  stroke="currentColor"
                  strokeWidth="1.6"
                />
                <path d="M3 9h18" stroke="currentColor" strokeWidth="1.6" />
              </svg>
            </span>
            <div className="flex-1">
              <div className="text-xs font-semibold text-ink3">NIN</div>
              <div className="font-mono text-[15px] font-bold">{ninShown}</div>
            </div>
            {/* Last-4 only — the full NIN is never fetched or revealed (§3.4). */}
            <span className="rounded-full bg-sok px-2.5 py-[5px] text-[11px] font-bold text-tok">
              Encrypted at rest
            </span>
          </div>
          {/* BVN */}
          <div className="flex items-center gap-[13px] rounded-xl border border-line p-[12px_14px]">
            <span className="flex size-[38px] flex-none items-center justify-center rounded-[10px] bg-card2 text-ink2">
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden
              >
                <rect
                  x="3"
                  y="5"
                  width="18"
                  height="14"
                  rx="2"
                  stroke="currentColor"
                  strokeWidth="1.6"
                />
                <circle
                  cx="8.5"
                  cy="11"
                  r="2"
                  stroke="currentColor"
                  strokeWidth="1.6"
                />
                <path
                  d="M13 10h5M13 14H7"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                />
              </svg>
            </span>
            <div className="flex-1">
              <div className="text-xs font-semibold text-ink3">BVN</div>
              <div className="font-mono text-[15px] font-bold">{bvnShown}</div>
            </div>
            <span className="rounded-full bg-sok px-2.5 py-[5px] text-[11px] font-bold text-tok">
              Encrypted at rest
            </span>
          </div>
          {/* ID + selfie placeholders */}
          <div className="flex gap-2.5">
            <div className="flex h-24 flex-1 items-end justify-center rounded-xl border border-line bg-[repeating-linear-gradient(45deg,var(--card2)_0_7px,var(--card)_7px_14px)] pb-2">
              <span className="font-mono text-[10px] text-ink3">
                ID_FRONT.jpg
              </span>
            </div>
            <div className="flex h-24 flex-1 items-end justify-center rounded-xl border border-line bg-[repeating-linear-gradient(45deg,var(--card2)_0_7px,var(--card)_7px_14px)] pb-2">
              <span className="font-mono text-[10px] text-ink3">
                SELFIE.jpg
              </span>
            </div>
          </div>
        </div>
      </Panel>
      <Panel>
        <div className="mb-2.5 text-[13px] font-extrabold">
          Liveness & document
        </div>
        <div className="flex items-center gap-[11px] rounded-xl bg-sok p-[11px_13px]">
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden
            className="text-tok"
          >
            <path
              d="m5 12 5 5L20 7"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <div>
            <div className="text-[12.5px] font-bold text-tok">
              Liveness · {kyc?.livenessResult ?? NOT_PROVIDED}
            </div>
            <div className="text-[11.5px] text-ink2">
              Identity document: {kyc?.idDocumentType ?? NOT_PROVIDED}.
            </div>
          </div>
        </div>
      </Panel>
    </div>
  )
}
