"use client"

/**
 * UsersPage — the end-user directory (design §6, `docs/design-ref/screens/Users.html`
 * + `vUsers()` / `seed()` in `docs/design-ref/logic.js`).
 *
 * PIXEL-FAITHFUL DESIGN REPRODUCTION. This screen renders the design's OWN mock
 * dataset (the 28-user `seed()` records translated to a module-level const below) so
 * it looks exactly like the design — it deliberately does NOT wire real API data
 * (no TanStack Query). Real-data reintegration is a separate later step.
 *
 * Header (total · shown counts) + Export CSV · a filter row (search pill, KYC / tier
 * / country selects, three risk-toggle chips) · a dark bulk-action bar when rows are
 * selected · the 7-column customer table (checkbox / Customer / KYC / Country /
 * Balance / Risk / Last active) · Pagination (10/page). Row click → `/users/[id]`.
 *
 * Bulk actions surface the shared flow modals (reason → step-up → engine) as the
 * design's audited-action pattern — presentation only; nothing here moves money
 * (root §3.1).
 */
import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"

import { cn } from "@/lib/utils"
import { FilterSelect } from "@/components/admin/filter-select"
import { Pagination } from "@/components/admin/pagination"
import {
  ReasonModal,
  StepUpModal,
  EngineActionModal,
} from "@/components/admin/flows"
import type {
  UserKycStatus,
  UserRiskChip,
  UserRiskFlag,
  UserTableRow,
} from "@/types/components"

const PAGE_SIZE = 10
const MAX_WIDTH = "1360px"

// ─── Design-faithful mock dataset (the design's `seed()` 28-user records) ───────────
// Translated verbatim from docs/design-ref/logic.js `seed()` (deterministic
// `Math.sin`-seeded generator). Module-level const — no fetching (design reproduction).
const USERS: readonly UserTableRow[] = [
  {
    id: "usr_10480",
    name: "Amara Okeke",
    email: "amara.okeke@example.com",
    initials: "AO",
    avatar: "#2a6f55",
    kyc: "pending",
    tier: "tier_3",
    country: "NG",
    ngn: 841839,
    flags: [],
    lastActive: "2m ago",
  },
  {
    id: "usr_10487",
    name: "Chidi Adeyemi",
    email: "chidi.adeyemi@example.com",
    initials: "CA",
    avatar: "#c07a2a",
    kyc: "pending",
    tier: "tier_2",
    country: "NG",
    ngn: 4096697,
    flags: [],
    lastActive: "3m ago",
  },
  {
    id: "usr_10494",
    name: "Ngozi Balogun",
    email: "ngozi.balogun@example.com",
    initials: "NB",
    avatar: "#3a6ea5",
    kyc: "pending",
    tier: "tier_1",
    country: "NG",
    ngn: 3181964,
    flags: ["simSwap"],
    lastActive: "4m ago",
  },
  {
    id: "usr_10501",
    name: "Emeka Okonkwo",
    email: "emeka.okonkwo@example.com",
    initials: "EO",
    avatar: "#8a4b8a",
    kyc: "pending",
    tier: "tier_3",
    country: "NG",
    ngn: 3550576,
    flags: [],
    lastActive: "5m ago",
  },
  {
    id: "usr_10508",
    name: "Ifeoma Eze",
    email: "ifeoma.eze@example.com",
    initials: "IE",
    avatar: "#b0563f",
    kyc: "needs_info",
    tier: "tier_1",
    country: "NG",
    ngn: 3638646,
    flags: ["velocity"],
    lastActive: "6m ago",
  },
  {
    id: "usr_10515",
    name: "Tunde Bello",
    email: "tunde.bello@example.com",
    initials: "TB",
    avatar: "#4a8a6a",
    kyc: "rejected",
    tier: "tier_1",
    country: "NG",
    ngn: 2447858,
    flags: ["sanctions"],
    lastActive: "7m ago",
  },
  {
    id: "usr_10522",
    name: "Bola Nwosu",
    email: "bola.nwosu@example.com",
    initials: "BN",
    avatar: "#7a6aa0",
    kyc: "verified",
    tier: "tier_3",
    country: "NG",
    ngn: 777880,
    flags: [],
    lastActive: "4h ago",
  },
  {
    id: "usr_10529",
    name: "Yusuf Abubakar",
    email: "yusuf.abubakar@example.com",
    initials: "YA",
    avatar: "#a0834a",
    kyc: "pending",
    tier: "tier_1",
    country: "RW",
    ngn: 3314843,
    flags: [],
    lastActive: "5h ago",
  },
  {
    id: "usr_10536",
    name: "Fatima Ojo",
    email: "fatima.ojo@example.com",
    initials: "FO",
    avatar: "#2a6f55",
    kyc: "verified",
    tier: "tier_3",
    country: "NG",
    ngn: 412825,
    flags: [],
    lastActive: "6h ago",
  },
  {
    id: "usr_10543",
    name: "Kelechi Danjuma",
    email: "kelechi.danjuma@example.com",
    initials: "KD",
    avatar: "#c07a2a",
    kyc: "verified",
    tier: "tier_3",
    country: "NG",
    ngn: 1138944,
    flags: ["simSwap"],
    lastActive: "7h ago",
  },
  {
    id: "usr_10550",
    name: "Adaeze Ibrahim",
    email: "adaeze.ibrahim@example.com",
    initials: "AI",
    avatar: "#3a6ea5",
    kyc: "verified",
    tier: "tier_1",
    country: "NG",
    ngn: 2817047,
    flags: [],
    lastActive: "8h ago",
  },
  {
    id: "usr_10557",
    name: "Obinna Chukwu",
    email: "obinna.chukwu@example.com",
    initials: "OC",
    avatar: "#8a4b8a",
    kyc: "pending",
    tier: "tier_1",
    country: "NG",
    ngn: 310439,
    flags: [],
    lastActive: "9h ago",
  },
  {
    id: "usr_10564",
    name: "Zainab Mohammed",
    email: "zainab.mohammed@example.com",
    initials: "ZM",
    avatar: "#b0563f",
    kyc: "needs_info",
    tier: "tier_3",
    country: "NG",
    ngn: 3690787,
    flags: ["velocity"],
    lastActive: "10h ago",
  },
  {
    id: "usr_10571",
    name: "Segun Adebayo",
    email: "segun.adebayo@example.com",
    initials: "SA",
    avatar: "#4a8a6a",
    kyc: "rejected",
    tier: "tier_2",
    country: "NG",
    ngn: 4062200,
    flags: [],
    lastActive: "11h ago",
  },
  {
    id: "usr_10578",
    name: "Chinwe Okafor",
    email: "chinwe.okafor@example.com",
    initials: "CO",
    avatar: "#7a6aa0",
    kyc: "verified",
    tier: "tier_2",
    country: "NG",
    ngn: 106841,
    flags: [],
    lastActive: "4d ago",
  },
  {
    id: "usr_10585",
    name: "Uche Yakubu",
    email: "uche.yakubu@example.com",
    initials: "UY",
    avatar: "#a0834a",
    kyc: "pending",
    tier: "tier_2",
    country: "NG",
    ngn: 537136,
    flags: [],
    lastActive: "5d ago",
  },
  {
    id: "usr_10592",
    name: "Aisha Lawal",
    email: "aisha.lawal@example.com",
    initials: "AL",
    avatar: "#2a6f55",
    kyc: "verified",
    tier: "tier_3",
    country: "NG",
    ngn: 3244306,
    flags: [],
    lastActive: "6d ago",
  },
  {
    id: "usr_10599",
    name: "Kunle Obi",
    email: "kunle.obi@example.com",
    initials: "KO",
    avatar: "#c07a2a",
    kyc: "verified",
    tier: "tier_1",
    country: "NG",
    ngn: 1902031,
    flags: ["sanctions"],
    lastActive: "7d ago",
  },
  {
    id: "usr_10606",
    name: "Ada Sani",
    email: "ada.sani@example.com",
    initials: "AS",
    avatar: "#3a6ea5",
    kyc: "verified",
    tier: "tier_2",
    country: "NG",
    ngn: 2338319,
    flags: [],
    lastActive: "8d ago",
  },
  {
    id: "usr_10613",
    name: "Musa Uche",
    email: "musa.uche@example.com",
    initials: "MU",
    avatar: "#8a4b8a",
    kyc: "pending",
    tier: "tier_2",
    country: "RW",
    ngn: 2046510,
    flags: [],
    lastActive: "9d ago",
  },
  {
    id: "usr_10620",
    name: "Blessing Oluwaseun",
    email: "blessing.oluwaseun@example.com",
    initials: "BO",
    avatar: "#b0563f",
    kyc: "needs_info",
    tier: "tier_3",
    country: "NG",
    ngn: 3344525,
    flags: [],
    lastActive: "10d ago",
  },
  {
    id: "usr_10627",
    name: "Ibrahim Aliyu",
    email: "ibrahim.aliyu@example.com",
    initials: "IA",
    avatar: "#4a8a6a",
    kyc: "rejected",
    tier: "tier_1",
    country: "NG",
    ngn: 910296,
    flags: ["velocity"],
    lastActive: "11d ago",
  },
  {
    id: "usr_10634",
    name: "Halima Nnamdi",
    email: "halima.nnamdi@example.com",
    initials: "HN",
    avatar: "#7a6aa0",
    kyc: "verified",
    tier: "tier_2",
    country: "NG",
    ngn: 2027996,
    flags: [],
    lastActive: "12d ago",
  },
  {
    id: "usr_10641",
    name: "Femi Kalu",
    email: "femi.kalu@example.com",
    initials: "FK",
    avatar: "#a0834a",
    kyc: "pending",
    tier: "tier_3",
    country: "NG",
    ngn: 2456420,
    flags: [],
    lastActive: "13d ago",
  },
  {
    id: "usr_10648",
    name: "Nneka Effiong",
    email: "nneka.effiong@example.com",
    initials: "NE",
    avatar: "#2a6f55",
    kyc: "verified",
    tier: "tier_2",
    country: "NG",
    ngn: 3190493,
    flags: [],
    lastActive: "14d ago",
  },
  {
    id: "usr_10655",
    name: "Chuka Musa",
    email: "chuka.musa@example.com",
    initials: "CM",
    avatar: "#c07a2a",
    kyc: "verified",
    tier: "tier_1",
    country: "NG",
    ngn: 244609,
    flags: [],
    lastActive: "15d ago",
  },
  {
    id: "usr_10662",
    name: "Damilola Onyeka",
    email: "damilola.onyeka@example.com",
    initials: "DO",
    avatar: "#3a6ea5",
    kyc: "verified",
    tier: "tier_1",
    country: "NG",
    ngn: 2778363,
    flags: [],
    lastActive: "16d ago",
  },
  {
    id: "usr_10669",
    name: "Grace Adewale",
    email: "grace.adewale@example.com",
    initials: "GA",
    avatar: "#8a4b8a",
    kyc: "pending",
    tier: "tier_3",
    country: "NG",
    ngn: 2873288,
    flags: [],
    lastActive: "17d ago",
  },
]

// KYC bucket → pill tokens (design `kycMeta`, logic.js line 496). Tailwind token
// utilities, not raw hex. Colour is never the sole signal — the label carries state.
const KYC_META: Record<
  UserKycStatus,
  { label: string; bg: string; fg: string }
> = {
  verified: { label: "Verified", bg: "bg-sok", fg: "text-tok" },
  pending: { label: "Pending", bg: "bg-swn", fg: "text-twn" },
  needs_info: { label: "Needs info", bg: "bg-sif", fg: "text-tif" },
  rejected: { label: "Rejected", bg: "bg-sdn", fg: "text-tdn" },
}

// Risk flag → badge label + tokens (design `flagMeta`, logic.js line 497).
const FLAG_META: Record<
  UserRiskFlag,
  { label: string; full: string; bg: string; fg: string }
> = {
  simSwap: {
    label: "SIM-SWAP",
    full: "SIM-swap risk detected",
    bg: "bg-sdn",
    fg: "text-tdn",
  },
  sanctions: {
    label: "SANCTIONS",
    full: "Sanctions screening hit",
    bg: "bg-sdn",
    fg: "text-tdn",
  },
  velocity: {
    label: "VELOCITY",
    full: "Velocity cap breach",
    bg: "bg-swn",
    fg: "text-twn",
  },
}

// Filter-select option sets (design `uFilters`, logic.js line 507).
const KYC_OPTIONS = [
  { value: "all", label: "All KYC" },
  { value: "verified", label: "Verified" },
  { value: "pending", label: "Pending" },
  { value: "needs_info", label: "Needs info" },
  { value: "rejected", label: "Rejected" },
] as const

const TIER_OPTIONS = [
  { value: "all", label: "All tiers" },
  { value: "tier_1", label: "tier_1" },
  { value: "tier_2", label: "tier_2" },
  { value: "tier_3", label: "tier_3" },
] as const

const COUNTRY_OPTIONS = [
  { value: "all", label: "All countries" },
  { value: "NG", label: "Nigeria" },
  { value: "RW", label: "Rwanda" },
] as const

// Risk-toggle chips (design `riskDef`, logic.js line 512).
const RISK_DEFS: ReadonlyArray<{ value: UserRiskFlag; label: string }> = [
  { value: "simSwap", label: "SIM-swap" },
  { value: "sanctions", label: "Sanctions" },
  { value: "velocity", label: "Velocity" },
]

// The design's filter-select className: sits on the `--card` surface (not `--field`),
// with the 12.5px/600 filter type and 11px radius from Users.html line 20.
const FILTER_SELECT_CLASS =
  "h-[38px] w-auto min-w-0 rounded-[11px] border-line bg-card py-0 pr-[30px] pl-3 text-[12.5px] font-semibold"

// Shared 7-column grid (Users.html lines 44/52): checkbox · Customer · KYC · Country
// · Balance · Risk · Last active. Used verbatim by the header row and every body row.
const GRID_COLS =
  "grid grid-cols-[38px_2fr_1.1fr_0.9fr_1.2fr_1fr_1fr] items-center gap-3"

// Design `ngn()` formatter (logic.js line 332) — ₦ + en-NG grouping, 2 fraction digits.
function ngn(n: number): string {
  return (
    "₦" +
    Number(n).toLocaleString("en-NG", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  )
}

export function UsersPage() {
  const router = useRouter()

  const [search, setSearch] = useState("")
  const [kyc, setKyc] = useState("all")
  const [tier, setTier] = useState("all")
  const [country, setCountry] = useState("all")
  const [risk, setRisk] = useState<UserRiskFlag | "">("")
  const [selected, setSelected] = useState<readonly string[]>([])
  const [page, setPage] = useState(1)

  // filteredUsers() — the design's client-side filter (logic.js line 268).
  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return USERS.filter((u) => {
      if (
        q &&
        !(
          u.name.toLowerCase().includes(q) ||
          u.email.includes(q) ||
          u.id.includes(q)
        )
      )
        return false
      if (kyc !== "all" && u.kyc !== kyc) return false
      if (tier !== "all" && u.tier !== tier) return false
      if (country !== "all" && u.country !== country) return false
      if (risk && !u.flags.includes(risk)) return false
      return true
    })
  }, [search, kyc, tier, country, risk])

  const pageRows = useMemo(
    () => filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [filtered, page]
  )

  const allSelected = selected.length >= filtered.length && filtered.length > 0
  const hasSelection = selected.length > 0

  const riskChips: UserRiskChip[] = RISK_DEFS.map((r) => ({
    value: r.value,
    label: r.label,
    active: risk === r.value,
  }))

  function toggleRisk(value: UserRiskFlag) {
    setRisk((prev) => (prev === value ? "" : value))
    setPage(1)
  }

  function toggleSelect(id: string) {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    )
  }

  function toggleSelectAll() {
    setSelected((prev) =>
      prev.length >= filtered.length ? [] : filtered.map((u) => u.id)
    )
  }

  function openUser(id: string) {
    router.push(`/users/${id}`)
  }

  // ── Bulk action flow (design's audited-action chain: reason → step-up → engine) ──
  const [flowStep, setFlowStep] = useState<
    null | "reason" | "stepup" | "engine"
  >(null)
  const flowCount = selected.length || filtered.length
  const flowNoun = `${flowCount} user${flowCount === 1 ? "" : "s"}`

  return (
    <div
      data-screen-label="Users"
      className="mx-auto px-[30px] pt-[26px] pb-[60px]"
      style={{ maxWidth: MAX_WIDTH }}
    >
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="mb-[18px] flex flex-wrap items-end justify-between gap-5">
        <div>
          <h1 className="m-0 text-[24px] font-extrabold tracking-[-0.02em] text-ink">
            Users
          </h1>
          <p className="mt-[5px] mb-0 text-[13.5px] text-ink2">
            <span className="tabular-nums">{USERS.length}</span> customers ·{" "}
            <span className="tabular-nums">{filtered.length}</span> shown
          </p>
        </div>
        <div className="flex gap-[9px]">
          <button
            type="button"
            onClick={() => setFlowStep("reason")}
            className="flex h-[38px] items-center gap-[7px] rounded-[11px] border border-line bg-card px-[15px] text-[13px] font-bold text-ink transition-colors hover:bg-hov focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden
            >
              <path
                d="M12 3v12m0 0 4-4m-4 4-4-4M5 21h14"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Export CSV
          </button>
        </div>
      </div>

      {/* ── Filters ────────────────────────────────────────────────────────── */}
      <div className="mb-[14px] flex flex-wrap items-center gap-[10px]">
        <div className="flex h-[38px] min-w-[230px] items-center gap-2 rounded-[11px] border border-line bg-card px-3">
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden
            className="text-ink3"
          >
            <circle
              cx="11"
              cy="11"
              r="7"
              stroke="currentColor"
              strokeWidth="1.8"
            />
            <path
              d="m20 20-3.5-3.5"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </svg>
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setPage(1)
            }}
            placeholder="Name, email, phone…"
            aria-label="Search users by name, email or phone"
            className="min-w-0 flex-1 border-none bg-transparent text-[13px] text-ink outline-none placeholder:text-ink3"
          />
        </div>

        <FilterSelect
          label="Filter by KYC status"
          options={KYC_OPTIONS}
          value={kyc}
          onChange={(e) => {
            setKyc(e.target.value)
            setPage(1)
          }}
          className={FILTER_SELECT_CLASS}
        />
        <FilterSelect
          label="Filter by tier"
          options={TIER_OPTIONS}
          value={tier}
          onChange={(e) => {
            setTier(e.target.value)
            setPage(1)
          }}
          className={FILTER_SELECT_CLASS}
        />
        <FilterSelect
          label="Filter by country"
          options={COUNTRY_OPTIONS}
          value={country}
          onChange={(e) => {
            setCountry(e.target.value)
            setPage(1)
          }}
          className={FILTER_SELECT_CLASS}
        />

        {riskChips.map((c) => (
          <button
            key={c.value}
            type="button"
            aria-pressed={c.active}
            onClick={() => toggleRisk(c.value)}
            className={cn(
              "flex h-[38px] items-center gap-[6px] rounded-[11px] border px-[13px] text-[12.5px] font-bold transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none",
              c.active
                ? "border-btn-dark bg-btn-dark text-white"
                : "border-line bg-card text-ink2 hover:bg-hov"
            )}
          >
            {c.label}
          </button>
        ))}
      </div>

      {/* ── Bulk bar ───────────────────────────────────────────────────────── */}
      {hasSelection && (
        <div className="mb-3 flex items-center gap-[14px] rounded-[13px] bg-btn-dark px-4 py-[11px] text-white motion-safe:animate-hs-in">
          <span className="text-[13px] font-bold tabular-nums">
            {selected.length} selected
          </span>
          <div className="h-[18px] w-px bg-white/20" />
          <button
            type="button"
            onClick={() => setFlowStep("reason")}
            className="text-[12.5px] font-semibold opacity-90 transition-opacity hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none"
          >
            Export
          </button>
          <button
            type="button"
            onClick={() => setFlowStep("reason")}
            className="text-[12.5px] font-semibold opacity-90 transition-opacity hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none"
          >
            Tag
          </button>
          <button
            type="button"
            onClick={() => setFlowStep("reason")}
            className="text-[12.5px] font-semibold opacity-90 transition-opacity hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none"
          >
            Message
          </button>
          <div className="flex-1" />
          <button
            type="button"
            onClick={() => setSelected([])}
            className="text-[12.5px] font-semibold opacity-70 transition-opacity hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none"
          >
            Clear
          </button>
        </div>
      )}

      {/* ── Table ──────────────────────────────────────────────────────────── */}
      <div className="overflow-hidden rounded-[16px] border border-line bg-card">
        {/* Header row */}
        <div
          className={cn(
            GRID_COLS,
            "border-b border-line bg-card2 px-[18px] py-[11px] text-[11px] font-bold tracking-[0.04em] text-ink3 uppercase"
          )}
        >
          <button
            type="button"
            onClick={toggleSelectAll}
            aria-label={allSelected ? "Deselect all" : "Select all"}
            aria-pressed={allSelected}
            className="cursor-pointer justify-self-start focus-visible:outline-none"
          >
            <span
              aria-hidden
              className={cn(
                "inline-block size-4 rounded-[5px] border-[1.5px]",
                allSelected
                  ? "border-brand-green bg-brand-green"
                  : "border-line"
              )}
            />
          </button>
          <div>Customer</div>
          <div>KYC</div>
          <div>Country</div>
          <div className="text-right">Balance</div>
          <div>Risk</div>
          <div>Last active</div>
        </div>

        {/* Empty */}
        {filtered.length === 0 && (
          <div className="px-5 py-[60px] text-center text-ink3">
            <div className="text-[14px] font-bold text-ink2">
              No users match these filters
            </div>
            <div className="mt-1 text-[12.5px]">
              Try clearing the risk chips or search.
            </div>
          </div>
        )}

        {/* Rows */}
        {pageRows.map((u) => {
          const km = KYC_META[u.kyc]
          const isSelected = selected.includes(u.id)
          return (
            <div
              key={u.id}
              role="button"
              tabIndex={0}
              onClick={() => openUser(u.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault()
                  openUser(u.id)
                }
              }}
              aria-label={`Open ${u.name}`}
              className={cn(
                GRID_COLS,
                "min-h-[52px] cursor-pointer border-b border-line2 px-[18px] transition-colors last:border-b-0 hover:bg-hov focus-visible:bg-hov focus-visible:outline-none"
              )}
            >
              {/* Checkbox */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  toggleSelect(u.id)
                }}
                aria-label={
                  isSelected ? `Deselect ${u.name}` : `Select ${u.name}`
                }
                aria-pressed={isSelected}
                className="justify-self-start focus-visible:outline-none"
              >
                <span
                  aria-hidden
                  className={cn(
                    "inline-block size-4 rounded-[5px] border-[1.5px]",
                    isSelected
                      ? "border-brand-green bg-brand-green"
                      : "border-line"
                  )}
                />
              </button>

              {/* Customer */}
              <div className="flex min-w-0 items-center gap-[11px]">
                <span
                  aria-hidden
                  className="flex size-8 flex-none items-center justify-center rounded-full text-[12px] font-extrabold text-white"
                  style={{ background: u.avatar }}
                >
                  {u.initials}
                </span>
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-bold text-ink">
                    {u.name}
                  </div>
                  <div className="truncate text-[11px] text-ink3">
                    {u.email}
                  </div>
                </div>
              </div>

              {/* KYC */}
              <div>
                <span
                  className={cn(
                    "inline-flex items-center gap-[5px] rounded-full px-[9px] py-[3px] text-[11px] font-bold",
                    km.bg,
                    km.fg
                  )}
                >
                  {km.label}
                </span>
                <div className="mt-0.5 text-[10px] text-ink3">{u.tier}</div>
              </div>

              {/* Country */}
              <div className="text-[12px] font-semibold text-ink2">
                {u.country}
              </div>

              {/* Balance */}
              <div className="text-right text-[12.5px] font-bold text-ink tabular-nums">
                {ngn(u.ngn)}
              </div>

              {/* Risk */}
              <div className="flex flex-wrap gap-[4px]">
                {u.flags.map((fl) => {
                  const fm = FLAG_META[fl]
                  return (
                    <span
                      key={fl}
                      title={fm.full}
                      className={cn(
                        "rounded-[5px] px-[6px] py-[2px] text-[9.5px] font-extrabold tracking-[0.03em]",
                        fm.bg,
                        fm.fg
                      )}
                    >
                      {fm.label}
                    </span>
                  )
                })}
              </div>

              {/* Last active */}
              <div className="text-[11.5px] text-ink2 tabular-nums">
                {u.lastActive}
              </div>
            </div>
          )
        })}
      </div>

      {/* ── Pagination (shared §5) ─────────────────────────────────────────── */}
      <Pagination
        total={filtered.length}
        pageSize={PAGE_SIZE}
        page={page}
        onPageChange={setPage}
        maxWidth={MAX_WIDTH}
      />

      {/* ── Shared flow modals (audited bulk-action chain: reason → step-up → engine) ── */}
      <ReasonModal
        open={flowStep === "reason"}
        onOpenChange={(o) => setFlowStep(o ? "reason" : null)}
        title={`Message ${flowNoun}`}
        onContinue={() => setFlowStep("stepup")}
      />
      <StepUpModal
        open={flowStep === "stepup"}
        onOpenChange={(o) => setFlowStep(o ? "stepup" : null)}
        title={`Message ${flowNoun}`}
        onComplete={() => setFlowStep("engine")}
      />
      <EngineActionModal
        open={flowStep === "engine"}
        onOpenChange={(o) => setFlowStep(o ? "engine" : null)}
        title="Broadcast message"
        effect={[
          { k: "Audience", v: flowNoun },
          { k: "Channel", v: "In-app + email" },
          { k: "Directive", v: "notify.broadcast" },
        ]}
        ledger={[]}
        idempotencyKey="idem_broadcast_users"
        cta="Send broadcast"
        onExecute={() => {
          setFlowStep(null)
          setSelected([])
        }}
      />
    </div>
  )
}
