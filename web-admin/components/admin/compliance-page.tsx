"use client"

/**
 * CompliancePage — the compliance console (Phase 3). Orchestrator: a five-tab strip
 * (Events / AML Rules / Travel Rule / Reports / Sanctions) over self-contained read
 * tabs, plus the shared step-up-gated write dialogs it opens by tracking which entity is
 * selected. Each data-tab renders its own four async branches; the writes annotate /
 * disposition compliance rows (dialogs carry their own reason → step-up chain internally).
 */
import { useState } from "react"
import type { AmlRule, ComplianceReport } from "@handshake-agent/contracts"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { ComplianceEventDetail } from "@/components/admin/compliance-event-detail"
import { AmlRuleDialog } from "@/components/admin/aml-rule-dialog"
import { ComplianceReportDraftDialog } from "@/components/admin/compliance-report-draft-dialog"
import { ComplianceReportSubmitDialog } from "@/components/admin/compliance-report-submit-dialog"
import { EventsTab } from "@/components/admin/compliance/events-tab"
import { AmlRulesTab } from "@/components/admin/compliance/aml-rules-tab"
import { TravelRuleTab } from "@/components/admin/compliance/travel-rule-tab"
import { ReportsTab } from "@/components/admin/compliance/reports-tab"
import { SanctionsTab } from "@/components/admin/compliance/sanctions-tab"
import { TABS } from "@/constants/compliance"
import type { ComplianceTab } from "@/types"

export function CompliancePage() {
  const [active, setActive] = useState<ComplianceTab>("Events")
  const [eventId, setEventId] = useState<string | null>(null)
  const [editingRule, setEditingRule] = useState<AmlRule | null>(null)
  const [ruleDialogOpen, setRuleDialogOpen] = useState(false)
  const [draftOpen, setDraftOpen] = useState(false)
  const [submittingReport, setSubmittingReport] =
    useState<ComplianceReport | null>(null)
  const [submitOpen, setSubmitOpen] = useState(false)

  function openNewRule() {
    setEditingRule(null)
    setRuleDialogOpen(true)
  }

  function openEditRule(rule: AmlRule) {
    setEditingRule(rule)
    setRuleDialogOpen(true)
  }

  function openSubmit(report: ComplianceReport) {
    setSubmittingReport(report)
    setSubmitOpen(true)
  }

  return (
    <div className="mx-auto flex w-full max-w-[1120px] flex-1 flex-col gap-5 overflow-y-auto px-8 py-7">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-[-0.02em] text-ink">
            Compliance
          </h1>
          <p className="mt-1 text-[13.5px] text-ink2">
            Events, AML rules, Travel Rule records, SAR/STR filings and
            screening history.
          </p>
        </div>
        {active === "AML Rules" && (
          <Button size="sm" onClick={openNewRule}>
            + New rule
          </Button>
        )}
        {active === "Reports" && (
          <Button size="sm" onClick={() => setDraftOpen(true)}>
            + Draft report
          </Button>
        )}
      </div>

      {/* Tab strip (§5 pill tabs) */}
      <div
        role="tablist"
        aria-label="Compliance surfaces"
        className="flex flex-wrap gap-2"
      >
        {TABS.map((tab) => {
          const selected = tab === active
          return (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setActive(tab)}
              className={cn(
                "h-9 rounded-[10px] border px-4 text-[13px] font-bold transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                selected
                  ? "border-btn-dark bg-btn-dark text-white"
                  : "border-line bg-card text-ink2 hover:bg-hov"
              )}
            >
              {tab}
            </button>
          )
        })}
      </div>

      {/* Tab content */}
      {active === "Events" && <EventsTab onOpen={setEventId} />}
      {active === "AML Rules" && <AmlRulesTab onEdit={openEditRule} />}
      {active === "Travel Rule" && <TravelRuleTab />}
      {active === "Reports" && <ReportsTab onSubmit={openSubmit} />}
      {active === "Sanctions" && <SanctionsTab />}

      <ComplianceEventDetail
        eventId={eventId}
        onOpenChange={(open) => {
          if (!open) setEventId(null)
        }}
      />
      <AmlRuleDialog
        open={ruleDialogOpen}
        onOpenChange={setRuleDialogOpen}
        rule={editingRule}
      />
      <ComplianceReportDraftDialog
        open={draftOpen}
        onOpenChange={setDraftOpen}
      />
      <ComplianceReportSubmitDialog
        open={submitOpen}
        onOpenChange={setSubmitOpen}
        report={submittingReport}
      />
    </div>
  )
}
