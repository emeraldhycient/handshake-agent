"use client"

/**
 * NeedsBeneficiaryCard — inline add/select payout-destination UI (orchestrator).
 *
 * Rendered when a sell (bank account) or send (crypto address) needs a saved
 * beneficiary the user doesn't have yet. Composes the saved list + the add form;
 * on resolve, `onResolve(beneficiaryId, messageId)` re-asks the agent so the
 * sell/send proposal can be created (root §16). Pure UI + lib hooks only.
 */
import { cn } from "@/lib/utils"
import { ChatCardShell } from "@/components/chat/cards/chat-card-shell"
import { SavedBeneficiaryList } from "@/components/chat/cards/needs-beneficiary/saved-beneficiary-list"
import { AddBankForm } from "@/components/chat/cards/needs-beneficiary/add-bank-form"
import { AddCryptoForm } from "@/components/chat/cards/needs-beneficiary/add-crypto-form"
import type { NeedsBeneficiaryCardProps } from "@/types/components"

export function NeedsBeneficiaryCard({
  beneficiaryType,
  note,
  messageId,
  onResolve,
  density,
  className,
}: NeedsBeneficiaryCardProps) {
  const isMobile = density === "mobile"
  const isBank = beneficiaryType === "bank_account"

  // Bind onResolve to this card's message id so the right pending intent resumes.
  const resolve = (beneficiaryId: string) => onResolve(beneficiaryId, messageId)

  return (
    <ChatCardShell density={density} desktopShadow className={className}>
      <div className={cn(isMobile ? "px-4 pt-3.5" : "px-[15px] pt-[13px]")}>
        <span className="text-[11px] font-bold tracking-widest text-muted-foreground-subtle uppercase">
          {isBank ? "Add a bank account" : "Add a crypto address"}
        </span>
        <p
          className={cn(
            "pt-1 text-muted-foreground",
            isMobile ? "text-[13px]" : "text-[12px]"
          )}
        >
          {/* The server's targeted copy (e.g. a nickname that matched nothing)
              replaces the generic line when present. */}
          {note ??
            (isBank
              ? "Choose where you'd like the sale paid out, or add a new bank account."
              : "Choose where to send your crypto, or add a new address.")}
        </p>
      </div>

      {/* Existing beneficiaries */}
      <div className={cn(isMobile ? "px-4 pt-3" : "px-[15px] pt-[11px]")}>
        <SavedBeneficiaryList
          beneficiaryType={beneficiaryType}
          isBank={isBank}
          onSelect={resolve}
        />
      </div>

      {/* Divider */}
      <div
        className={cn("mt-3 h-px bg-border", isMobile ? "mx-4" : "mx-[15px]")}
      />

      {/* Add form */}
      <div className={cn(isMobile ? "px-4 py-3.5" : "px-[15px] py-[13px]")}>
        {isBank ? (
          <AddBankForm onResolve={resolve} />
        ) : (
          <AddCryptoForm onResolve={resolve} />
        )}
      </div>
    </ChatCardShell>
  )
}
