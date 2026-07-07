import { ShapeGapNote } from "./shape-gap-note"

/**
 * Flows (E2E encrypted) — the config view exposes only `flowId` + `beneficiaryFlowId`,
 * with no per-flow registry (name/description/live status) to enumerate. Rather than
 * fabricate KYC/confirm/PIN flow rows, this shows an honest shape-gap note (deferred).
 */
export function FlowsCard() {
  return (
    <div className="rounded-2xl border border-line bg-card px-5 py-[18px]">
      <h2 className="mb-3 text-[13px] font-extrabold text-ink">
        Flows (E2E encrypted)
      </h2>
      <ShapeGapNote title="No Flows registry yet">
        There is no per-flow read endpoint yet — the config view exposes only
        the flow ids. The E2E-encrypted KYC, itemized-confirmation and PIN flows
        will be listed here once a registry is added.
      </ShapeGapNote>
    </div>
  )
}
