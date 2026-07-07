"use client"

/**
 * ProvidersPage — the provider-adapters operator screen (design §6.27). Composition
 * only: the provider registry read drives a grid of provider cards + a mock→live
 * readiness checklist, all under `components/admin/providers/*`.
 *
 * FUNDS-SAFETY / SECRETS (§3.4/§3.5): the API returns secret-PRESENCE booleans only —
 * key VALUES never cross the boundary — so this screen shows whether each provider's
 * key is configured, never the key itself. Read-only; the "Test connection" probe is
 * credential-free, step-up-gated, and moves no money (§3.1).
 */
import { useProviderRegistry } from "@/lib/query/hooks"
import { ProviderCard } from "@/components/admin/providers/provider-card"
import { ProviderCardSkeleton } from "@/components/admin/providers/provider-card-skeleton"
import { ReadinessCard } from "@/components/admin/providers/readiness-card"

export function ProvidersPage() {
  const query = useProviderRegistry()

  return (
    <div className="mx-auto w-full max-w-[1200px] px-[30px] pt-[26px] pb-[60px]">
      {/* ── Header (design markup line 3) ──────────────────────────────────────── */}
      <div className="mb-4">
        <h1 className="text-[24px] font-extrabold tracking-[-0.02em] text-ink">
          Providers
        </h1>
        <p className="mt-[5px] text-[13.5px] text-ink2">
          Provider adapters per capability. Status is derived from configuration
          posture; API keys are never revealed — only their presence is shown.
        </p>
      </div>

      {/* Error branch (§5) */}
      {query.isError && (
        <div className="mb-4 rounded-xl border border-sdn bg-sdn/40 px-4 py-3.5 text-center">
          <p className="text-xs font-bold text-tdn">
            Couldn&apos;t load the provider registry
          </p>
          <button
            type="button"
            onClick={() => query.refetch()}
            className="mt-1.5 cursor-pointer rounded-md px-1.5 text-[11.5px] font-bold text-tif hover:bg-hov focus-visible:outline focus-visible:outline-2 focus-visible:outline-tif"
          >
            Retry
          </button>
        </div>
      )}

      {/* Loading branch (§5) */}
      {query.isLoading && (
        <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2">
          <ProviderCardSkeleton />
          <ProviderCardSkeleton />
          <ProviderCardSkeleton />
          <ProviderCardSkeleton />
        </div>
      )}

      {/* Data / empty branches (§5) */}
      {query.data && (
        <>
          {query.data.providers.length === 0 ? (
            <div className="mb-4 rounded-2xl border border-line bg-card px-5 py-8 text-center">
              <p className="text-[12.5px] text-ink3">
                No provider adapters registered.
              </p>
            </div>
          ) : (
            <div className="mb-4 grid grid-cols-1 gap-3.5 md:grid-cols-2">
              {query.data.providers.map((provider) => (
                <ProviderCard key={provider.key} provider={provider} />
              ))}
            </div>
          )}

          <ReadinessCard items={query.data.readiness} />
        </>
      )}
    </div>
  )
}
