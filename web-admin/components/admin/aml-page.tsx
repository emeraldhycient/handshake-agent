"use client"

/**
 * AmlPage — the AML / risk screen (design §6.6). Orchestrator: a `1.2fr 1fr` grid of
 * self-contained read-wired cards (risk rules / open cases / Travel Rule / compliance
 * reports), plus the shared step-up-gated write dialogs it opens by tracking which
 * entity is selected. Nothing here moves money (§3.1) — the writes annotation/disposition
 * compliance rows; each dialog carries its own reason → step-up → mutate chain internally.
 */
import { useState } from "react"
import type { AmlRule, ComplianceReport } from "@handshake-agent/contracts"

import { AmlRuleDialog } from "@/components/admin/aml-rule-dialog"
import { ComplianceEventDetail } from "@/components/admin/compliance-event-detail"
import { ComplianceReportDraftDialog } from "@/components/admin/compliance-report-draft-dialog"
import { ComplianceReportSubmitDialog } from "@/components/admin/compliance-report-submit-dialog"
import { RiskRulesCard } from "@/components/admin/aml/risk-rules-card"
import { OpenCasesCard } from "@/components/admin/aml/open-cases-card"
import { TravelRuleCard } from "@/components/admin/aml/travel-rule-card"
import { ReportsCard } from "@/components/admin/aml/reports-card"

export function AmlPage() {
  const [editingRule, setEditingRule] = useState<AmlRule | null>(null)
  const [ruleDialogOpen, setRuleDialogOpen] = useState(false)
  const [draftOpen, setDraftOpen] = useState(false)
  const [caseId, setCaseId] = useState<string | null>(null)
  const [submittingReport, setSubmittingReport] =
    useState<ComplianceReport | null>(null)
  const [submitOpen, setSubmitOpen] = useState(false)

  function openEditRule(rule: AmlRule) {
    setEditingRule(rule)
    setRuleDialogOpen(true)
  }

  function openSubmitReport(report: ComplianceReport) {
    setSubmittingReport(report)
    setSubmitOpen(true)
  }

  return (
    <div className="mx-auto w-full max-w-[1200px] px-[30px] pt-[26px] pb-[60px]">
      <div className="mb-4">
        <h1 className="text-2xl font-extrabold tracking-[-0.02em] text-ink">
          AML / risk
        </h1>
        <p className="mt-[5px] text-[13.5px] text-ink2">
          Rules, case management, SAR/CTR drafting and Travel Rule records.
        </p>
      </div>

      <div className="grid grid-cols-1 items-start gap-[14px] lg:grid-cols-[1.2fr_1fr]">
        <RiskRulesCard onEdit={openEditRule} />
        <div className="flex flex-col gap-[14px]">
          <OpenCasesCard
            onDraftSar={() => setDraftOpen(true)}
            onOpenCase={setCaseId}
          />
          <TravelRuleCard />
          <ReportsCard onSubmit={openSubmitReport} />
        </div>
      </div>

      {/* Compliance writes (Phase 7, step-up-gated dialogs) */}
      <ComplianceEventDetail
        eventId={caseId}
        onOpenChange={(next) => !next && setCaseId(null)}
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
