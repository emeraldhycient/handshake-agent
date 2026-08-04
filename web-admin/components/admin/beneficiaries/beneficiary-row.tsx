import { Landmark, Wallet } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { BeneficiaryOverride } from "@/components/admin/beneficiary-override"
import {
  formatDate,
  typeLabel,
  verificationVariant,
} from "@/lib/beneficiaries/rows"
import type { BeneficiaryRowProps } from "@/types"

/**
 * One beneficiary row — icon tile · label + type · name-enquiry pill · cooling-off
 * badge (only while the first-use lock is active) · the step-up-gated override action.
 */
export function BeneficiaryRow({ beneficiary: b }: BeneficiaryRowProps) {
  const Icon = b.type === "bank_account" ? Landmark : Wallet
  return (
    <div className="flex items-center gap-3.5 border-b border-line2 py-4 last:border-b-0">
      <span className="flex size-[38px] shrink-0 items-center justify-center rounded-[10px] bg-card2 text-ink2">
        <Icon aria-hidden="true" className="size-[17px]" />
      </span>

      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-bold text-ink">{b.label}</div>
        <div className="truncate font-mono text-[11.5px] text-ink3">
          {typeLabel(b.type)}
        </div>
      </div>

      <Badge variant={verificationVariant(b.verificationStatus)}>
        {b.verificationStatus}
      </Badge>

      {b.coolingOffActive ? (
        <Badge variant="warn">
          Cooling-off until {formatDate(b.firstUseLockedUntil)}
        </Badge>
      ) : (
        <span className="text-[11.5px] font-semibold text-ink3">Cleared</span>
      )}

      <BeneficiaryOverride beneficiary={b} />
    </div>
  )
}
