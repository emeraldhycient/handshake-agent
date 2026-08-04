import { Skeleton } from "@/components/ui/skeleton"
import { useWhatsAppConfig } from "@/lib/query/hooks"
import { toneClass, wiringRows } from "@/lib/whatsapp/rows"
import type { WhatsAppHealthRowProps } from "@/types"

function CheckIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className="text-tok"
    >
      <path
        d="m5 12 5 5L20 7"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
    </svg>
  )
}

/** One key/value health row (design markup) — label + tinted mono value. */
function HealthRow({ row }: WhatsAppHealthRowProps) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-line2 py-[9px]">
      <dt className="text-[12.5px] text-ink2">{row.label}</dt>
      <dd
        className={`max-w-[55%] truncate font-mono text-xs font-bold ${toneClass(row.tone)}`}
      >
        {row.value}
      </dd>
    </div>
  )
}

/** Skeleton wiring rows for the loading branch (matches the row rhythm). */
function HealthRowsSkeleton() {
  return (
    <div aria-busy="true">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="flex items-center justify-between gap-4 border-b border-line2 py-[9px]"
        >
          <Skeleton className="h-3 w-28" />
          <Skeleton className="h-3 w-24" />
        </div>
      ))}
    </div>
  )
}

/**
 * Number & webhook health — real Cloud-API / Flows wiring + secret-presence (from
 * `useWhatsAppConfig`), closed by the "Official Cloud API only" note. The design's
 * operational signals have no read endpoint yet, so instead of fabricating them the
 * card carries an honest shape-gap note. Four async branches.
 */
export function HealthCard() {
  const { data, isLoading, isError, refetch } = useWhatsAppConfig()

  return (
    <div className="rounded-2xl border border-line bg-card px-5 py-[18px]">
      <h2 className="mb-3 text-[13px] font-extrabold text-ink">
        Number &amp; webhook health
      </h2>

      <dl>
        {isLoading && <HealthRowsSkeleton />}

        {isError && (
          <div className="my-2 rounded-[9px] border border-sdn bg-sdn/40 px-3 py-[11px] text-center">
            <p className="text-[12px] font-bold text-tdn">
              Couldn&apos;t load WhatsApp config
            </p>
            <button
              type="button"
              onClick={() => refetch()}
              className="mt-1 cursor-pointer rounded-md px-1 text-[11.5px] font-bold text-tif hover:bg-hov focus-visible:outline focus-visible:outline-2 focus-visible:outline-tif"
            >
              Retry
            </button>
          </div>
        )}

        {data &&
          wiringRows(data).map((row) => (
            <HealthRow key={row.label} row={row} />
          ))}
      </dl>

      {data && (
        <p className="mt-2 text-[11px] leading-snug text-ink3">
          Operational signals (quality rating, messaging-limit tier, webhook
          subscription, template rejections) have no read endpoint yet and are
          intentionally omitted rather than shown as sample data.
        </p>
      )}

      <div className="mt-3 flex items-center gap-2 rounded-[9px] bg-sok px-3 py-[9px]">
        <CheckIcon />
        <span className="text-[11.5px] font-semibold text-tok">
          Official Cloud API only · ban-risk: low
        </span>
      </div>
    </div>
  )
}
