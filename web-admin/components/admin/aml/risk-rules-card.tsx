"use client"

import { Skeleton } from "@/components/ui/skeleton"
import { useAmlRules } from "@/lib/query/hooks"
import {
  CardShell,
  EditPencilIcon,
  InlineError,
} from "@/components/admin/aml/aml-shells"
import { AmlRuleTypesHelp } from "@/components/admin/aml/aml-rule-types-help"
import { thresholdFromParameters } from "@/lib/aml/format"
import type { RiskRulesCardProps } from "@/types"

/** Risk-rules card (design lines 5–8) — read-wired to `useAmlRules`. */
export function RiskRulesCard({ onEdit }: RiskRulesCardProps) {
  const query = useAmlRules()
  const rules = query.data?.rules ?? []

  return (
    <CardShell>
      <div className="mb-3 flex items-center gap-[7px] text-[13px] font-extrabold text-ink">
        <span>
          Risk rules{" "}
          <span className="font-semibold text-ink3">
            · thresholds are maker-checker
          </span>
        </span>
        <AmlRuleTypesHelp />
      </div>

      {query.isLoading ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          <Skeleton className="h-[44px] rounded-[10px]" />
          <Skeleton className="h-[44px] rounded-[10px]" />
          <Skeleton className="h-[44px] rounded-[10px]" />
        </div>
      ) : query.isError ? (
        <InlineError
          label="Couldn't load risk rules."
          onRetry={() => query.refetch()}
        />
      ) : rules.length === 0 ? (
        <p className="py-2 text-[12px] text-ink3">No risk rules configured.</p>
      ) : (
        <div>
          {rules.map((rule) => (
            <div
              key={rule.id}
              className="flex items-center gap-3 border-b border-line2 py-[11px] last:border-b-0"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12.5px] font-bold text-ink">
                  {rule.name}
                </div>
                <div className="truncate text-[11px] text-ink3">
                  {rule.description}
                </div>
              </div>
              <span className="font-mono text-[12.5px] font-bold text-ink tabular-nums">
                {thresholdFromParameters(rule.parameters)}
              </span>
              <button
                type="button"
                onClick={() => onEdit(rule)}
                aria-label={`Edit rule ${rule.name}`}
                className="flex size-7 flex-none items-center justify-center rounded-lg border border-line text-ink2 transition-colors hover:bg-hov focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                <EditPencilIcon />
              </button>
            </div>
          ))}
        </div>
      )}
    </CardShell>
  )
}
