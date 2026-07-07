/**
 * Left panel — Vendor ports. There is NO vendor-port registry endpoint yet (only the
 * single `ticketing.enabled` + `ticketing.commissionBps` settings keys), so instead of
 * fabricating per-vendor rows this panel renders an HONEST shape-gap note. Wiring it
 * needs a backend registry enrichment (deferred).
 */
export function VendorPortsCard() {
  return (
    <div className="rounded-[16px] border border-line bg-card px-5 py-[18px]">
      <div className="mb-3 text-[13px] font-extrabold text-ink">
        Vendor ports
      </div>
      <div className="rounded-[12px] border border-dashed border-line2 px-4 py-6 text-center">
        <p className="text-[13px] font-bold text-ink">
          No vendor-port registry yet
        </p>
        <p className="mt-1 text-[12px] leading-snug text-ink2">
          There is no vendor-port registry endpoint to enumerate ticketing
          vendors — only the global <span className="font-mono">ticketing</span>{" "}
          enablement + commission settings. Per-vendor status will appear here
          once a backend registry is added.
        </p>
      </div>
    </div>
  )
}
