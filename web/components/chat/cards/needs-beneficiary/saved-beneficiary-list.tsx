"use client"

import { bankNameForCode } from "@handshake-agent/contracts/beneficiaries"
import { cn } from "@/lib/utils"
import {
  useBeneficiaries,
  useDeleteBeneficiary,
} from "@/lib/query/beneficiaries"
import { truncateMiddle } from "@/lib/beneficiaries/format"
import type { SavedBeneficiaryListProps } from "@/types/chat"

/** Existing beneficiaries: loading / error / empty / data, each row selectable + removable. */
export function SavedBeneficiaryList({
  beneficiaryType,
  isBank,
  onSelect,
}: SavedBeneficiaryListProps) {
  const list = useBeneficiaries(beneficiaryType)
  const del = useDeleteBeneficiary()

  return (
    <>
      {list.isPending ? (
        <p className="text-[13px] text-muted-foreground">
          Loading saved destinations…
        </p>
      ) : list.isError ? (
        <p className="text-[13px] text-warn">
          Couldn&apos;t load your saved destinations. You can still add a new
          one below.
        </p>
      ) : list.data && list.data.beneficiaries.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {list.data.beneficiaries.map((b) => (
            <li key={b.id} className="flex items-stretch gap-2">
              <button
                type="button"
                onClick={() => onSelect(b.id)}
                className={cn(
                  "flex min-w-0 flex-1 items-center justify-between rounded-[12px] border border-border",
                  "bg-background px-3 py-2.5 text-left text-[13.5px] text-foreground",
                  "transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                )}
              >
                <span className="truncate font-medium">{b.label}</span>
                <span
                  className="ml-2 shrink-0 text-[12px] text-muted-foreground"
                  translate="no"
                >
                  {isBank
                    ? `${b.accountNumber ?? ""} · ${b.bankCode ? (bankNameForCode(b.bankCode) ?? b.bankCode) : ""}`
                    : truncateMiddle(b.cryptoAddress ?? "")}
                </span>
              </button>
              <button
                type="button"
                aria-label={`Remove ${b.label}`}
                disabled={del.isPending}
                onClick={() => del.mutate(b.id)}
                className={cn(
                  "flex w-10 shrink-0 items-center justify-center rounded-[12px] border border-border",
                  "bg-background text-muted-foreground transition-colors",
                  "hover:bg-muted hover:text-danger focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                  "disabled:opacity-50"
                )}
              >
                <RemoveIcon />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[13px] text-muted-foreground">
          No saved {isBank ? "bank accounts" : "addresses"} yet — add your first
          below.
        </p>
      )}
      {del.isError && (
        <p className="pt-2 text-[12px] text-warn" role="alert">
          Couldn&apos;t remove that destination. Please try again.
        </p>
      )}
    </>
  )
}

function RemoveIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    </svg>
  )
}
