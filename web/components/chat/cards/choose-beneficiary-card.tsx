/**
 * ChooseBeneficiaryCard — pick-one list shown when a recipient nickname matched
 * MORE THAN ONE saved beneficiary (choose_beneficiary outcome).
 *
 * Selecting a candidate calls `onResolve(beneficiaryId, messageId)` — the SAME
 * resolve loop the needs_beneficiary card uses: the store re-sends the intent
 * this card was bound to with the chosen beneficiaryId, and the server creates
 * the proposal only after re-validating ownership/type/limits (§3.1). Candidate
 * `detail` arrives masked from the server; this card never sees a full
 * destination. Pure presentational — no hooks, no fetching.
 */
import { cn } from "@/lib/utils"
import { ChatCardShell } from "@/components/chat/cards/chat-card-shell"
import type { ChooseBeneficiaryCardProps } from "@/types"

export function ChooseBeneficiaryCard({
  beneficiaryType,
  nickname,
  candidates,
  messageId,
  onResolve,
  density,
  className,
}: ChooseBeneficiaryCardProps) {
  const isMobile = density === "mobile"
  const isBank = beneficiaryType === "bank_account"

  return (
    <ChatCardShell density={density} desktopShadow className={className}>
      <div
        className={cn(
          isMobile ? "px-4 pt-3.5 pb-3.5" : "px-[15px] pt-[13px] pb-[13px]"
        )}
      >
        <span className="text-[11px] font-bold tracking-widest text-muted-foreground-subtle uppercase">
          {isBank ? "Choose a bank account" : "Choose a recipient"}
        </span>
        <p
          className={cn(
            "pt-1 text-muted-foreground",
            isMobile ? "text-[13px]" : "text-[12px]"
          )}
        >
          You have {candidates.length} saved as &ldquo;{nickname}&rdquo;. Which
          one did you mean?
        </p>

        {/* Candidate list — label prominent, masked detail secondary (same
            visual pattern as the saved-beneficiary list). */}
        <ul className="flex flex-col gap-2 pt-3">
          {candidates.map((candidate) => (
            <li key={candidate.id} className="flex">
              <button
                type="button"
                onClick={() => onResolve(candidate.id, messageId)}
                className={cn(
                  "flex min-w-0 flex-1 items-center justify-between rounded-[12px] border border-border",
                  "bg-background px-3 py-2.5 text-left text-[13.5px] text-foreground",
                  "transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                )}
              >
                <span className="truncate font-medium">{candidate.label}</span>
                <span
                  className="ml-2 shrink-0 text-[12px] text-muted-foreground"
                  translate="no"
                >
                  {candidate.detail}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </ChatCardShell>
  )
}
