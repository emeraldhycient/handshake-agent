"use client"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useAmlRules } from "@/lib/query/hooks"
import {
  ErrorPanel,
  LoadingRows,
  EmptyNote,
} from "@/components/admin/compliance/compliance-shells"
import type { AmlRulesTabProps } from "@/types"

/** AML Rules tab (§6.6 risk-rule layout) — the engine rules list + edit pencil. */
export function AmlRulesTab({ onEdit }: AmlRulesTabProps) {
  const rules = useAmlRules()

  if (rules.isLoading) return <LoadingRows />
  if (rules.isError) return <ErrorPanel what="AML rules" />
  if (rules.isSuccess && rules.data.rules.length === 0) {
    return <EmptyNote>No AML rules.</EmptyNote>
  }
  if (!rules.isSuccess) return null

  return (
    <div className="rounded-2xl border border-line bg-card p-5">
      <div className="mb-3 text-[13px] font-extrabold text-ink">
        Risk rules{" "}
        <span className="font-semibold text-ink3">
          · thresholds are maker-checker
        </span>
      </div>
      <ul>
        {rules.data.rules.map((rule) => (
          <li
            key={rule.id}
            className="flex items-center gap-3 border-b border-line2 py-3 last:border-b-0"
          >
            <div className="min-w-0 flex-1">
              <div className="truncate font-mono text-xs font-bold text-ink">
                {rule.ruleKey}
              </div>
              <div className="truncate text-[11px] text-ink3">
                {rule.name} · {rule.ruleType}
              </div>
            </div>
            <Badge variant={rule.action === "block" ? "danger" : "warn"}>
              {rule.action}
            </Badge>
            {rule.enabled ? (
              <Badge variant="success">on</Badge>
            ) : (
              <Badge variant="neutral">off</Badge>
            )}
            <span className="font-mono text-xs font-bold text-ink2 tabular-nums">
              v{rule.version}
            </span>
            <Button
              size="icon-sm"
              variant="outline"
              aria-label={`Edit rule ${rule.ruleKey}`}
              onClick={() => onEdit(rule)}
            >
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden="true"
              >
                <path
                  d="M4 20h4l10-10-4-4L4 16z"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinejoin="round"
                />
              </svg>
            </Button>
          </li>
        ))}
      </ul>
    </div>
  )
}
