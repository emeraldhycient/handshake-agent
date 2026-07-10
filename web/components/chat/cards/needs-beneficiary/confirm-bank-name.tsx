"use client"

import { bankNameForCode } from "@handshake-agent/contracts/beneficiaries"
import { Button } from "@/components/ui/button"
import type { ConfirmBankNameProps } from "@/types/chat"

/**
 * Name-enquiry confirm step. After a successful add the server returns the
 * resolved account-holder name; we require an explicit "Yes, that's correct"
 * before resolving — a typo'd account paying a stranger is the most expensive
 * beneficiary mistake, so the identity + number are shown `translate="no"` and
 * never auto-resolved.
 */
export function ConfirmBankName({
  beneficiary,
  onConfirm,
  onReenter,
}: ConfirmBankNameProps) {
  return (
    <div
      className="flex flex-col gap-2.5"
      role="group"
      aria-label="Confirm account name"
    >
      <p className="text-[12px] font-medium text-muted-foreground">
        We found this account — is this you?
      </p>
      <div className="rounded-[12px] border border-border bg-background px-3 py-2.5">
        <p className="text-[14px] font-semibold text-foreground" translate="no">
          {beneficiary.accountHolderName ?? beneficiary.label}
        </p>
        <p className="pt-0.5 text-[12px] text-muted-foreground" translate="no">
          {beneficiary.accountNumber ?? ""}
          {beneficiary.bankCode
            ? ` · ${bankNameForCode(beneficiary.bankCode) ?? beneficiary.bankCode}`
            : ""}
        </p>
      </div>
      <p className="text-[11.5px] text-muted-foreground">
        Money sent to the wrong account can&apos;t be recovered — confirm the
        name matches before continuing.
      </p>
      <Button type="button" onClick={onConfirm} className="mt-1">
        Yes, that&apos;s correct
      </Button>
      <Button
        type="button"
        variant="outline"
        onClick={onReenter}
        className="mt-0.5"
      >
        No, re-enter details
      </Button>
    </div>
  )
}
