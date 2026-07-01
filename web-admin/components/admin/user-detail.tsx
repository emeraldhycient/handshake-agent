"use client"

/**
 * UserDetail — pixel-for-pixel reproduction of the Operator Console user-detail
 * screen (design `docs/design-ref/screens/UserDetail.html`, data logic
 * `vUserDetail()` in `docs/design-ref/logic.js`).
 *
 * DESIGN-ONLY: this screen renders the design's OWN mock content so it looks
 * exactly like the imported design — no TanStack Query / API data. The mock user
 * is the design's default (`curUser()` → `users[0]` = Amara Okeke), with every
 * value computed from the design's seed() (tier_3, kyc pending, no flags, one
 * session). Real-data reintegration is a separate later step.
 *
 * Structure & inline styles are translated 1:1 from the design markup; colours are
 * mapped onto the design tokens. Actions wire to the shared flow modals (reason →
 * step-up → engine / maker-checker / pii-reveal) and table rows navigate to the
 * transaction detail route, exactly as the design does.
 */
import { useState } from "react"
import { useRouter } from "next/navigation"

import { cn } from "@/lib/utils"
import {
  EngineActionModal,
  MakerCheckerModal,
  PiiRevealModal,
  ReasonModal,
  StepUpModal,
} from "@/components/admin/flows"
import type {
  EngineEffectRow,
  EngineLedgerRow,
  MakerCheckerDiffRow,
  UserDetailProps,
} from "@/types/components"

// ─── Design mock data (translated from vUserDetail() + seed(), user index 0) ────────

const RATE = 1064.6887

const CU = {
  name: "Amara Okeke",
  id: "usr_10480",
  initials: "AO",
  avatar: "#2a6f55",
  tier: "tier_3",
  frozen: false,
  email: "amara.okeke@example.com",
  phone: "+234 770 7388 9768",
  country: "NG",
  created: "2024-01-01",
  lastActive: "2m ago",
  nin: "23000000000",
  bvn: "22000000000",
  ngn: 841839,
  sessions: 1,
} as const

const USDT = CU.ngn / RATE

/** ₦ formatter (logic.js `ngn()`, line 332). */
function ngn(n: number): string {
  return (
    "₦" +
    Number(n).toLocaleString("en-NG", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  )
}

/** KYC status → { label, bg-token, fg-token } (vUserDetail kycMeta, line 578). */
const KYC_META = {
  label: "Pending",
  bg: "var(--swn)",
  fg: "var(--twn)",
} as const

type Tab =
  | "profile"
  | "kyc"
  | "devices"
  | "security"
  | "wallets"
  | "bene"
  | "tx"
  | "chat"
  | "limits"

const TABS: readonly { id: Tab; label: string }[] = [
  { id: "profile", label: "Profile" },
  { id: "kyc", label: "KYC" },
  { id: "devices", label: "Devices" },
  { id: "security", label: "Security" },
  { id: "wallets", label: "Wallets & balances" },
  { id: "bene", label: "Beneficiaries" },
  { id: "tx", label: "Transactions" },
  { id: "chat", label: "Chat history" },
  { id: "limits", label: "Limits" },
]

/** Header action buttons (vUserDetail uActions, line 584). */
const U_ACTIONS: readonly { label: string; icon: string; danger?: boolean }[] =
  [
    {
      label: "Freeze",
      icon: "M6 10V8a6 6 0 0 1 12 0v2M5 10h14v10H5z",
      danger: true,
    },
    { label: "Add note", icon: "M12 5v14M5 12h14" },
    { label: "Resend", icon: "M4 4h16v12H8l-4 4z" },
    {
      label: "View as",
      icon: "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z",
    },
  ]

// ── Profile ────────────────────────────────────────────────────────────────────────

const CONTACT: readonly { k: string; v: string; mono: boolean }[] = [
  { k: "Email", v: CU.email, mono: false },
  { k: "Phone", v: CU.phone, mono: true },
  { k: "Country", v: "Nigeria", mono: false },
  { k: "Locale", v: "en-NG", mono: false },
  { k: "Marketing consent", v: "Opted in", mono: false },
  { k: "Created", v: CU.created, mono: true },
]

const TIMELINE: readonly { text: string; meta: string; dot: string }[] = [
  { text: "Signed up via WhatsApp", meta: CU.created, dot: "#8b948a" },
  { text: "Completed liveness selfie", meta: CU.created, dot: "#8b948a" },
]

// ── Devices (line 607) ───────────────────────────────────────────────────────────────

const DEVICES: readonly {
  name: string
  fp: string
  seen: string
  simSwap: boolean
  simTime?: string
}[] = [
  {
    name: "iPhone 14 · iOS 18.2",
    fp: "fp_9a2c•4e1",
    seen: CU.lastActive,
    simSwap: false,
    simTime: "2d ago",
  },
  { name: "Chrome · macOS", fp: "fp_71bd•c0", seen: "3d ago", simSwap: false },
]

// ── Security (lines 608-609) ──────────────────────────────────────────────────────────

const SECURITY: readonly { k: string; v: string; fg: string }[] = [
  { k: "PIN status", v: "Set · last set 12d ago", fg: "var(--tok)" },
  { k: "Failed-PIN lockouts", v: "0", fg: "var(--ink)" },
  { k: "OTP lockouts", v: "0", fg: "var(--ink)" },
  { k: "2FA", v: "Enrolled", fg: "var(--tok)" },
]

const SESSIONS: readonly {
  ua: string
  ip: string
  when: string
  dot: string
}[] = [
  {
    ua: "iPhone 14 · Lagos",
    ip: "102.89.34.19",
    when: CU.lastActive,
    dot: "#1f8a5b",
  },
  { ua: "Chrome · macOS", ip: "197.210.7.12", when: "3d ago", dot: "#8b948a" },
].slice(0, Math.max(1, CU.sessions))

// ── Wallets (lines 610-615) ────────────────────────────────────────────────────────

const WALLETS: readonly {
  label: string
  avail: string
  pending: string
  bg: string
  line: string
  ink: string
  sub: string
}[] = [
  {
    label: "USDT · TRON",
    avail: USDT.toFixed(6),
    pending: "0.000000",
    bg: "linear-gradient(150deg,#1a4536,#0e241c)",
    line: "transparent",
    ink: "#fff",
    sub: "rgba(214,226,219,0.65)",
  },
  {
    label: "TRX · TRON",
    avail: (USDT * 0.4).toFixed(6),
    pending: (USDT * 0.01).toFixed(6),
    bg: "var(--card)",
    line: "var(--line)",
    ink: "var(--ink)",
    sub: "var(--ink3)",
  },
  {
    label: "≈ Total (NGN)",
    avail: ngn(CU.ngn),
    pending: ngn(0),
    bg: "var(--card)",
    line: "var(--line)",
    ink: "var(--ink)",
    sub: "var(--ink3)",
  },
]

const ADDRESSES: readonly { asset: string; addr: string; bal: string }[] = [
  {
    asset: "USDT",
    addr: "TJ0480Rb9kQx2fLp7YvN3sD8mWc1aZ",
    bal: USDT.toFixed(2),
  },
  {
    asset: "TRX",
    addr: "TQ0480Hs4nMp2kLd9YvB3xR7wE5tGa",
    bal: (USDT * 0.4).toFixed(2),
  },
]

// ── Beneficiaries (line 616) ────────────────────────────────────────────────────────

const BENEFICIARIES: readonly {
  name: string
  detail: string
  ne: string
  neBg: string
  neFg: string
  icon: string
}[] = [
  {
    name: "GTBank · Amara Okeke",
    detail: "0usr_10480",
    ne: "Name match",
    neBg: "var(--sok)",
    neFg: "var(--tok)",
    icon: "M4 9h16M6 9v9M18 9v9M3 21h18M12 3l8 6H4z",
  },
  {
    name: "USDT address",
    detail: "TJx8••••9kQ2",
    ne: "Unverified",
    neBg: "var(--swn)",
    neFg: "var(--twn)",
    icon: "M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM9 12h6",
  },
]

// ── Transactions (cuTx, lines 591-595) ────────────────────────────────────────────────
// utx = txns for this user; when empty the design pushes txns[0] + txns[3]. Reproduced
// faithfully as a buy (settled) + swap (pending) with the design's stMeta pill mapping
// and TYPE_ICON glyphs.

const TYPE_ICON: Record<string, string> = {
  buy: "M4 8h13l-3-3",
  sell: "M20 16H7l3 3",
  send: "M4 12h13l-4-4M4 12l9 5",
  swap: "M4 8h13l-3-3M20 16H7l3 3",
  receive: "M12 4v13l-4-4M12 17l4-4",
  ticket: "M4 9h16v6H4z",
}

const ST_META: Record<string, { l: string; bg: string; fg: string }> = {
  settled: { l: "Settled", bg: "var(--sok)", fg: "var(--tok)" },
  pending_settlement: { l: "Pending", bg: "var(--swn)", fg: "var(--twn)" },
  failed: { l: "Failed", bg: "var(--sdn)", fg: "var(--tdn)" },
  refunded: { l: "Refunded", bg: "var(--sif)", fg: "var(--tif)" },
}

const TXNS: readonly {
  type: string
  id: string
  usdt: string
  ngn: string
  status: keyof typeof ST_META
}[] = [
  {
    type: "buy",
    id: "tx_48210",
    usdt: "100.00 USDT",
    ngn: ngn(106469),
    status: "settled",
  },
  {
    type: "swap",
    id: "tx_48231",
    usdt: "250.00 USDT",
    ngn: ngn(266172),
    status: "pending_settlement",
  },
]

// ── Chat (lines 618-623) ──────────────────────────────────────────────────────────────

const CHAT: readonly {
  text: string
  justify: "flex-start" | "flex-end"
  bg: string
  fg: string
  intent?: string
  proposal?: string
}[] = [
  {
    text: "I want to buy 100 USDT",
    justify: "flex-end",
    bg: "#1a4536",
    fg: "#fff",
  },
  {
    text: "Sure — 100 USDT at ₦1,064.69 = ₦106,469. Fee ₦1,178. Confirm with your PIN?",
    justify: "flex-start",
    bg: "var(--card2)",
    fg: "var(--ink)",
    intent: "crypto.buy",
    proposal: "proposal #p_8841",
  },
  { text: "Confirmed ✅", justify: "flex-end", bg: "#1a4536", fg: "#fff" },
  {
    text: "Done! 100 USDT is in your wallet. [receipt link redacted]",
    justify: "flex-start",
    bg: "var(--card2)",
    fg: "var(--ink)",
  },
]

// ── Limits (lines 624-625) ────────────────────────────────────────────────────────────

const LIMITS: readonly { k: string; v: string; override: boolean }[] = [
  { k: "Daily send cap", v: "₦10,000,000", override: false },
  { k: "Weekly cap", v: "₦50,000,000", override: false },
  { k: "Per-tx cap", v: "₦5,000,000", override: false },
  { k: "Tx count / day", v: "50", override: false },
]

const VELOCITY: readonly {
  k: string
  used: string
  cap: string
  pct: string
  bar: string
  fg: string
}[] = [
  {
    k: "Daily send used",
    used: ngn(CU.ngn * 0.3),
    cap: "₦2,000,000",
    pct: "42%",
    bar: "#1a4536",
    fg: "var(--ink2)",
  },
  {
    k: "Tx count (24h)",
    used: "6",
    cap: "10",
    pct: "60%",
    bar: "#f5a623",
    fg: "var(--twn)",
  },
  {
    k: "Swap volume (24h)",
    used: "12 USDT",
    cap: "1,000 USDT",
    pct: "8%",
    bar: "#2a6f55",
    fg: "var(--ink2)",
  },
]

// Engine-action effect/ledger for the Manual credit flow (vUserDetail manualCredit, 567).
const CREDIT_AMT = 25
const CREDIT_NGN = CREDIT_AMT * RATE
const CREDIT_EFFECT: EngineEffectRow[] = [
  { k: "Credit to", v: CU.id },
  { k: "Amount", v: CREDIT_AMT.toFixed(6) + " USDT" },
  { k: "≈ Fiat", v: ngn(CREDIT_NGN) },
  { k: "Proposal type", v: "manual_credit" },
]
const CREDIT_LEDGER: EngineLedgerRow[] = [
  { acct: "treasury:USDT", dir: "DR", amt: CREDIT_AMT.toFixed(6) },
  { acct: CU.id + ":USDT", dir: "CR", amt: CREDIT_AMT.toFixed(6) },
]
const TIER_DIFF: MakerCheckerDiffRow[] = [
  { field: "KYC tier", from: CU.tier, to: "tier_2" },
]

// ─── Small presentational helper: the design card/panel ─────────────────────────────

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-line bg-card p-[18px_20px]">
      {children}
    </div>
  )
}

// ─── Flow-modal orchestration (design runFlow: reason → step-up → engine / maker) ────

type FlowStep = "reason" | "stepup" | "engine" | "maker" | "pii"

interface FlowConfig {
  title: string
  steps: FlowStep[]
  effect?: EngineEffectRow[]
  ledger?: EngineLedgerRow[]
  diff?: MakerCheckerDiffRow[]
  piiLabel?: string
  /** When the flow completes, reveal decrypted PII (the reveal-NIN flow). */
  reveals?: boolean
}

export function UserDetail(_props: UserDetailProps) {
  // `userId` from the route is intentionally unused: this is a design reproduction
  // that renders the design's canonical mock user (design curUser() falls back to
  // users[0] = Amara Okeke). Real-data lookup by id is a later step.
  void _props

  const router = useRouter()
  const [tab, setTab] = useState<Tab>("profile")
  const [piiRevealed, setPiiRevealed] = useState(false)

  // Sequential flow-modal machine: the active step index walks the config's steps.
  const [flow, setFlow] = useState<FlowConfig | null>(null)
  const [flowStep, setFlowStep] = useState(0)

  function runFlow(config: FlowConfig) {
    setFlow(config)
    setFlowStep(0)
  }
  function advance() {
    if (!flow) return
    if (flowStep + 1 >= flow.steps.length) {
      // Completed the last step.
      if (flow.reveals) setPiiRevealed(true)
      setFlow(null)
      setFlowStep(0)
      return
    }
    setFlowStep(flowStep + 1)
  }
  function cancelFlow() {
    setFlow(null)
    setFlowStep(0)
  }

  const current: FlowStep | null = flow ? flow.steps[flowStep] : null

  function openTx(id: string) {
    router.push(`/transactions/${id}`)
  }

  // Actions — mapped to the same runFlow destinations as vUserDetail.
  const freezeUser = () =>
    runFlow({ title: "Freeze account", steps: ["reason", "stepup"] })
  const revealNin = () => {
    if (piiRevealed) {
      setPiiRevealed(false)
      return
    }
    runFlow({
      title: "Reveal NIN",
      steps: ["pii", "stepup"],
      piiLabel: "NIN & BVN",
      reveals: true,
    })
  }
  const kycApprove = () =>
    runFlow({
      title: "Approve KYC · tier_3",
      steps: ["reason", "stepup", "maker"],
      diff: [{ field: "KYC status", from: "pending", to: "verified" }],
    })
  const kycInfo = () =>
    runFlow({ title: "Request more info", steps: ["reason"] })
  const kycReject = () => runFlow({ title: "Reject KYC", steps: ["reason"] })
  const overrideTier = () =>
    runFlow({
      title: "Override tier tier_3 → tier_2",
      steps: ["reason", "stepup", "maker"],
      diff: TIER_DIFF,
    })
  const forceReKyc = () =>
    runFlow({ title: "Force re-KYC", steps: ["reason", "stepup"] })
  const resetPin = () =>
    runFlow({ title: "Reset PIN directive", steps: ["reason", "stepup"] })
  const revokeAll = () =>
    runFlow({ title: "Revoke all sessions", steps: ["stepup"] })
  const unbindDevice = () =>
    runFlow({ title: "Unbind device", steps: ["reason", "stepup"] })
  const manualCredit = () =>
    runFlow({
      title: "Manual credit · 25.00 USDT",
      steps: ["reason", "stepup", "engine", "maker"],
      effect: CREDIT_EFFECT,
      ledger: CREDIT_LEDGER,
      diff: [
        {
          field: "USDT available",
          from: (CU.ngn / RATE).toFixed(2) + " USDT",
          to: (CU.ngn / RATE + CREDIT_AMT).toFixed(2) + " USDT",
        },
      ],
    })

  const revealLabel = piiRevealed ? "Hide" : "Reveal"
  const revealIcon = piiRevealed
    ? "M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.4 5.2A9 9 0 0 1 21 12a17 17 0 0 1-2.2 3M6.2 6.2A17 17 0 0 0 3 12s3.5 7 9 7a9 9 0 0 0 3-.5"
    : "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"
  const ninShown = piiRevealed ? CU.nin : "••• ••• ••" + CU.nin.slice(-2)
  const bvnShown = piiRevealed ? CU.bvn : "••• ••• ••" + CU.bvn.slice(-2)

  return (
    <div
      data-screen-label="User detail"
      className="mx-auto w-full max-w-[1200px] overflow-y-auto px-[30px] pt-[22px] pb-[60px]"
    >
      {/* Back-link */}
      <button
        type="button"
        onClick={() => router.push("/users")}
        className="mb-3.5 inline-flex cursor-pointer items-center gap-[7px] text-[12.5px] font-bold text-ink2 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path
            d="M14 6l-6 6 6 6"
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        All users
      </button>

      {/* HEADER */}
      <div className="mb-3.5 rounded-[18px] border border-line bg-card p-[20px_22px]">
        <div className="flex flex-wrap items-start gap-4">
          <span
            className="flex size-14 flex-none items-center justify-center rounded-full text-xl font-extrabold text-white"
            style={{ background: CU.avatar }}
          >
            {CU.initials}
          </span>
          <div className="min-w-[200px] flex-1">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-[21px] font-extrabold tracking-[-0.02em]">
                {CU.name}
              </h1>
              {CU.frozen && (
                <span className="rounded-full bg-sdn px-2.5 py-[3px] text-[11px] font-extrabold text-tdn">
                  FROZEN
                </span>
              )}
              <span
                className="inline-flex items-center gap-[5px] rounded-full px-2.5 py-[3px] text-[11px] font-bold"
                style={{ background: KYC_META.bg, color: KYC_META.fg }}
              >
                {KYC_META.label} · {CU.tier}
              </span>
            </div>
            <button
              type="button"
              onClick={() => void navigator.clipboard?.writeText(CU.id)}
              className="mt-1.5 inline-flex cursor-pointer items-center gap-1.5 font-mono text-xs text-ink3 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              {CU.id}
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden
              >
                <path
                  d="M9 9h10v10H9zM5 15V5h10"
                  stroke="currentColor"
                  strokeWidth="1.8"
                />
              </svg>
            </button>
            {/* Flag chips — none for this user (design renders an empty row) */}
            <div className="mt-2 flex flex-wrap gap-1.5" />
          </div>
          <div className="flex flex-wrap gap-2">
            {U_ACTIONS.map((a) => (
              <button
                key={a.label}
                type="button"
                title={a.label}
                onClick={() => {
                  if (a.label === "Freeze") freezeUser()
                }}
                className={cn(
                  "flex h-9 cursor-pointer items-center gap-[7px] rounded-[10px] border px-[13px] text-[12.5px] font-bold focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                  a.danger
                    ? "border-[#f0d0cb] bg-sdn text-tdn hover:bg-sdn/80"
                    : "border-line bg-card text-ink hover:bg-hov"
                )}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  aria-hidden
                >
                  <path
                    d={a.icon}
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                {a.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* TABS (underline) */}
      <div className="scr mb-4 flex gap-[3px] overflow-x-auto border-b border-line">
        {TABS.map((t) => {
          const active = tab === t.id
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex-none cursor-pointer border-b-2 px-[15px] py-2.5 text-[13px] font-bold whitespace-nowrap focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                active
                  ? "border-brand-amber text-ink"
                  : "border-transparent text-ink3"
              )}
            >
              {t.label}
            </button>
          )
        })}
      </div>

      {/* PII BANNER */}
      {piiRevealed && (
        <div className="mb-3.5 flex items-center gap-2.5 rounded-xl border border-[#f2cfc9] bg-sdn px-[15px] py-[11px]">
          <svg
            width="17"
            height="17"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden
            className="text-tdn"
          >
            <path
              d="M12 3l7 3v5c0 5-3.5 8-7 9-3.5-1-7-4-7-9V6z"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinejoin="round"
            />
          </svg>
          <span className="flex-1 text-[12.5px] font-semibold text-tdn">
            Decrypted PII is visible · this access is logged to the audit trail.
            Auto-remasking in 20s.
          </span>
          <button
            type="button"
            onClick={() => setPiiRevealed(false)}
            className="cursor-pointer text-xs font-bold text-tdn underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            Re-mask now
          </button>
        </div>
      )}

      {/* ===== PROFILE ===== */}
      {tab === "profile" && (
        <div className="grid grid-cols-2 gap-3.5">
          <Panel>
            <div className="mb-3 text-[13px] font-extrabold">
              Contact & locale
            </div>
            {CONTACT.map((c) => (
              <div
                key={c.k}
                className="flex justify-between gap-3 border-b border-line2 py-2"
              >
                <span className="text-[12.5px] text-ink3">{c.k}</span>
                <span
                  className={cn(
                    "text-right text-[12.5px] font-bold",
                    c.mono && "font-mono"
                  )}
                >
                  {c.v}
                </span>
              </div>
            ))}
          </Panel>
          <Panel>
            <div className="mb-3 flex items-center justify-between">
              <div className="text-[13px] font-extrabold">
                Admin action timeline
              </div>
              <button
                type="button"
                className="cursor-pointer text-xs font-bold text-tif focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                + Add note
              </button>
            </div>
            {TIMELINE.map((t, i) => (
              <div
                key={i}
                className="flex gap-[11px] border-b border-line2 py-[9px]"
              >
                <span
                  className="mt-[5px] size-2 flex-none rounded-full"
                  style={{ background: t.dot }}
                />
                <div className="flex-1">
                  <div className="text-[12.5px] font-semibold">{t.text}</div>
                  <div className="text-[11px] text-ink3">{t.meta}</div>
                </div>
              </div>
            ))}
          </Panel>
        </div>
      )}

      {/* ===== KYC ===== */}
      {tab === "kyc" && (
        <div className="grid grid-cols-[1.3fr_1fr] items-start gap-3.5">
          <div className="flex flex-col gap-3.5">
            <Panel>
              <div className="mb-3 text-[13px] font-extrabold">
                Identity documents
              </div>
              <div className="flex flex-col gap-2.5">
                {/* NIN */}
                <div className="flex items-center gap-[13px] rounded-xl border border-line p-[12px_14px]">
                  <span className="flex size-[38px] flex-none items-center justify-center rounded-[10px] bg-card2 text-ink2">
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      aria-hidden
                    >
                      <rect
                        x="3"
                        y="5"
                        width="18"
                        height="14"
                        rx="2"
                        stroke="currentColor"
                        strokeWidth="1.6"
                      />
                      <path
                        d="M3 9h18"
                        stroke="currentColor"
                        strokeWidth="1.6"
                      />
                    </svg>
                  </span>
                  <div className="flex-1">
                    <div className="text-xs font-semibold text-ink3">NIN</div>
                    <div className="font-mono text-[15px] font-bold">
                      {ninShown}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={revealNin}
                    className={cn(
                      "flex cursor-pointer items-center gap-1.5 rounded-[9px] border px-3 py-[7px] text-xs font-bold focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                      piiRevealed
                        ? "border-[#f0d0cb] bg-sdn text-tdn"
                        : "border-line bg-card text-ink"
                    )}
                  >
                    <svg
                      width="13"
                      height="13"
                      viewBox="0 0 24 24"
                      fill="none"
                      aria-hidden
                    >
                      <path
                        d={revealIcon}
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                    {revealLabel}
                  </button>
                </div>
                {/* BVN */}
                <div className="flex items-center gap-[13px] rounded-xl border border-line p-[12px_14px]">
                  <span className="flex size-[38px] flex-none items-center justify-center rounded-[10px] bg-card2 text-ink2">
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      aria-hidden
                    >
                      <rect
                        x="3"
                        y="5"
                        width="18"
                        height="14"
                        rx="2"
                        stroke="currentColor"
                        strokeWidth="1.6"
                      />
                      <circle
                        cx="8.5"
                        cy="11"
                        r="2"
                        stroke="currentColor"
                        strokeWidth="1.6"
                      />
                      <path
                        d="M13 10h5M13 14H7"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                      />
                    </svg>
                  </span>
                  <div className="flex-1">
                    <div className="text-xs font-semibold text-ink3">BVN</div>
                    <div className="font-mono text-[15px] font-bold">
                      {bvnShown}
                    </div>
                  </div>
                  <span className="rounded-full bg-sok px-2.5 py-[5px] text-[11px] font-bold text-tok">
                    Encrypted at rest
                  </span>
                </div>
                {/* ID + selfie placeholders */}
                <div className="flex gap-2.5">
                  <div className="flex h-24 flex-1 items-end justify-center rounded-xl border border-line bg-[repeating-linear-gradient(45deg,var(--card2)_0_7px,var(--card)_7px_14px)] pb-2">
                    <span className="font-mono text-[10px] text-ink3">
                      ID_FRONT.jpg
                    </span>
                  </div>
                  <div className="flex h-24 flex-1 items-end justify-center rounded-xl border border-line bg-[repeating-linear-gradient(45deg,var(--card2)_0_7px,var(--card)_7px_14px)] pb-2">
                    <span className="font-mono text-[10px] text-ink3">
                      SELFIE.jpg
                    </span>
                  </div>
                </div>
              </div>
            </Panel>
            <Panel>
              <div className="mb-2.5 text-[13px] font-extrabold">
                Name-enquiry
              </div>
              <div className="flex items-center gap-[11px] rounded-xl bg-sok p-[11px_13px]">
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  aria-hidden
                  className="text-tok"
                >
                  <path
                    d="m5 12 5 5L20 7"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                <div>
                  <div className="text-[12.5px] font-bold text-tok">
                    Match · {CU.name}
                  </div>
                  <div className="text-[11.5px] text-ink2">
                    Bank name-enquiry returned an exact match on account holder.
                  </div>
                </div>
              </div>
            </Panel>
          </div>
          <Panel>
            <div className="mb-1 text-[13px] font-extrabold">
              Review decision
            </div>
            <div className="mb-3.5 text-xs text-ink2">
              Decisions are audited. Tier 2/3 require a second approver.
            </div>
            <div className="flex flex-col gap-[9px]">
              <button
                type="button"
                onClick={kycApprove}
                className="flex cursor-pointer items-center justify-center gap-2 rounded-[11px] bg-[#1f8a5b] p-3 text-[13.5px] font-extrabold text-white focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  aria-hidden
                >
                  <path
                    d="m5 12 5 5L20 7"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                Approve · tier_3 (maker-checker)
              </button>
              <div className="flex gap-[9px]">
                <button
                  type="button"
                  onClick={kycInfo}
                  className="flex-1 cursor-pointer rounded-[11px] border border-line p-[11px] text-center text-[12.5px] font-bold text-ink transition-colors hover:bg-hov focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                >
                  Request info
                </button>
                <button
                  type="button"
                  onClick={kycReject}
                  className="flex-1 cursor-pointer rounded-[11px] border border-[#f0d0cb] p-[11px] text-center text-[12.5px] font-bold text-tdn transition-colors hover:bg-sdn focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                >
                  Reject
                </button>
              </div>
            </div>
            <div className="my-4 h-px bg-line2" />
            <div className="mb-[9px] text-xs font-extrabold">Tier controls</div>
            <button
              type="button"
              onClick={overrideTier}
              className="mb-2 flex w-full cursor-pointer items-center gap-2 rounded-[10px] border border-line p-[10px_12px] text-[12.5px] font-bold text-ink transition-colors hover:bg-hov focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden
              >
                <path
                  d="M12 3l2.5 6H21l-5 4 2 7-6-4-6 4 2-7-5-4h6.5z"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinejoin="round"
                />
              </svg>
              Override tier · maker-checker
            </button>
            <button
              type="button"
              onClick={forceReKyc}
              className="flex w-full cursor-pointer items-center gap-2 rounded-[10px] border border-line p-[10px_12px] text-[12.5px] font-bold text-ink transition-colors hover:bg-hov focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden
              >
                <path
                  d="M4 12a8 8 0 1 1 2.3 5.6M4 20v-4h4"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              Force re-KYC
            </button>
          </Panel>
        </div>
      )}

      {/* ===== DEVICES ===== */}
      {tab === "devices" && (
        <div className="rounded-2xl border border-line bg-card p-[6px_20px]">
          {DEVICES.map((d, i) => (
            <div
              key={i}
              className="flex items-center gap-3.5 border-b border-line2 py-4"
            >
              <span className="flex size-[42px] flex-none items-center justify-center rounded-[11px] bg-card2 text-ink2">
                <svg
                  width="19"
                  height="19"
                  viewBox="0 0 24 24"
                  fill="none"
                  aria-hidden
                >
                  <rect
                    x="6"
                    y="2.5"
                    width="12"
                    height="19"
                    rx="2.5"
                    stroke="currentColor"
                    strokeWidth="1.6"
                  />
                  <path
                    d="M10.5 18.5h3"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                  />
                </svg>
              </span>
              <div className="flex-1">
                <div className="text-[13.5px] font-bold">{d.name}</div>
                <div className="font-mono text-[11.5px] text-ink3">
                  {d.fp} · last seen {d.seen}
                </div>
              </div>
              {d.simSwap && (
                <span className="rounded-full bg-sdn px-2.5 py-1 text-[10.5px] font-extrabold text-tdn">
                  SIM-SWAP {d.simTime}
                </span>
              )}
              <button
                type="button"
                onClick={unbindDevice}
                className="cursor-pointer rounded-[9px] border border-line px-[13px] py-2 text-xs font-bold text-ink transition-colors hover:bg-hov focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                Unbind
              </button>
            </div>
          ))}
          <div className="flex items-center gap-[9px] py-3.5 text-xs text-ink3">
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden
            >
              <path
                d="M7 11V8a5 5 0 0 1 10 0v3"
                stroke="currentColor"
                strokeWidth="1.6"
              />
              <rect
                x="5"
                y="11"
                width="14"
                height="9"
                rx="2"
                stroke="currentColor"
                strokeWidth="1.6"
              />
            </svg>
            Identity = verified KYC + bound device + PIN. A phone number alone
            never authenticates a session.
          </div>
        </div>
      )}

      {/* ===== SECURITY ===== */}
      {tab === "security" && (
        <div className="grid grid-cols-2 items-start gap-3.5">
          <Panel>
            <div className="mb-3 text-[13px] font-extrabold">
              PIN & authentication
            </div>
            {SECURITY.map((s) => (
              <div
                key={s.k}
                className="flex justify-between gap-3 border-b border-line2 py-[9px]"
              >
                <span className="text-[12.5px] text-ink3">{s.k}</span>
                <span
                  className="text-[12.5px] font-bold"
                  style={{ color: s.fg }}
                >
                  {s.v}
                </span>
              </div>
            ))}
            <button
              type="button"
              onClick={resetPin}
              className="mt-3.5 flex w-full cursor-pointer items-center justify-center gap-2 rounded-[11px] border border-line p-[11px] text-[12.5px] font-bold text-ink transition-colors hover:bg-hov focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden
              >
                <path
                  d="M4 12a8 8 0 1 1 2.3 5.6M4 20v-4h4"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              Reset PIN directive · step-up
            </button>
          </Panel>
          <Panel>
            <div className="mb-3 flex items-center justify-between">
              <div className="text-[13px] font-extrabold">Active sessions</div>
              <button
                type="button"
                onClick={revokeAll}
                className="cursor-pointer text-xs font-bold text-tdn focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                Revoke all
              </button>
            </div>
            {SESSIONS.map((s, i) => (
              <div
                key={i}
                className="flex items-center gap-[11px] border-b border-line2 py-2.5"
              >
                <span
                  className="size-2 flex-none rounded-full"
                  style={{ background: s.dot }}
                />
                <div className="flex-1">
                  <div className="text-[12.5px] font-semibold">{s.ua}</div>
                  <div className="font-mono text-[11px] text-ink3">
                    {s.ip} · {s.when}
                  </div>
                </div>
                <button
                  type="button"
                  className="cursor-pointer text-[11.5px] font-bold text-ink2 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                >
                  Revoke
                </button>
              </div>
            ))}
          </Panel>
        </div>
      )}

      {/* ===== WALLETS ===== */}
      {tab === "wallets" && (
        <div className="flex flex-col gap-3.5">
          <div className="grid grid-cols-3 gap-3">
            {WALLETS.map((w) => (
              <div
                key={w.label}
                className="rounded-2xl border p-[16px_18px]"
                style={{ background: w.bg, borderColor: w.line, color: w.ink }}
              >
                <div className="text-xs font-semibold" style={{ color: w.sub }}>
                  {w.label}
                </div>
                <div className="mt-[5px] font-mono text-[22px] font-extrabold tabular-nums">
                  {w.avail}
                </div>
                <div
                  className="mt-[3px] text-[11.5px] tabular-nums"
                  style={{ color: w.sub }}
                >
                  {w.pending} pending
                </div>
              </div>
            ))}
          </div>
          <Panel>
            <div className="mb-3 flex items-center justify-between">
              <div className="text-[13px] font-extrabold">
                On-chain deposit addresses{" "}
                <span className="font-semibold text-ink3">
                  · child addresses
                </span>
              </div>
              <button
                type="button"
                onClick={manualCredit}
                className="flex cursor-pointer items-center gap-[7px] rounded-[10px] border border-line bg-card px-[13px] py-2 text-[12.5px] font-bold text-ink transition-colors hover:bg-hov focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  aria-hidden
                >
                  <path
                    d="M12 5v14M5 12h14"
                    stroke="currentColor"
                    strokeWidth="1.9"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                Manual credit
              </button>
            </div>
            {ADDRESSES.map((a) => (
              <div
                key={a.asset}
                className="flex items-center gap-3 border-b border-line2 py-[11px]"
              >
                <span className="rounded-md bg-card2 px-2 py-[3px] text-[11px] font-bold text-ink2">
                  {a.asset}
                </span>
                <button
                  type="button"
                  onClick={() => void navigator.clipboard?.writeText(a.addr)}
                  className="flex-1 cursor-pointer overflow-hidden text-left font-mono text-xs text-ellipsis whitespace-nowrap text-ink2 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                >
                  {a.addr}
                </button>
                <span className="font-mono text-xs font-bold tabular-nums">
                  {a.bal}
                </span>
              </div>
            ))}
          </Panel>
        </div>
      )}

      {/* ===== BENEFICIARIES ===== */}
      {tab === "bene" && (
        <div className="rounded-2xl border border-line bg-card p-[6px_20px]">
          {BENEFICIARIES.map((b, i) => (
            <div
              key={i}
              className="flex items-center gap-[13px] border-b border-line2 py-[15px]"
            >
              <span className="flex size-[38px] flex-none items-center justify-center rounded-[10px] bg-card2 text-ink2">
                <svg
                  width="17"
                  height="17"
                  viewBox="0 0 24 24"
                  fill="none"
                  aria-hidden
                >
                  <path
                    d={b.icon}
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-bold">{b.name}</div>
                <div className="font-mono text-[11.5px] text-ink3">
                  {b.detail}
                </div>
              </div>
              <span
                className="rounded-full px-2.5 py-1 text-[10.5px] font-bold"
                style={{ background: b.neBg, color: b.neFg }}
              >
                {b.ne}
              </span>
              <button
                type="button"
                className="cursor-pointer text-[11.5px] font-bold text-ink3 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}

      {/* ===== TRANSACTIONS ===== */}
      {tab === "tx" && (
        <div className="overflow-hidden rounded-2xl border border-line bg-card">
          {TXNS.map((t) => {
            const sm = ST_META[t.status]
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => openTx(t.id)}
                className="grid w-full cursor-pointer grid-cols-[1.2fr_1fr_1fr_1fr] items-center gap-3 border-b border-line2 p-[13px_18px] text-left transition-colors hover:bg-hov focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                <div className="flex items-center gap-[9px]">
                  <span className="flex size-[30px] flex-none items-center justify-center rounded-lg bg-card2 text-ink2">
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      aria-hidden
                    >
                      <path
                        d={TYPE_ICON[t.type] ?? TYPE_ICON.buy}
                        stroke="currentColor"
                        strokeWidth="1.9"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </span>
                  <div>
                    <div className="text-[12.5px] font-bold capitalize">
                      {t.type}
                    </div>
                    <div className="font-mono text-[10.5px] text-ink3">
                      {t.id}
                    </div>
                  </div>
                </div>
                <div className="font-mono text-[12.5px] font-bold tabular-nums">
                  {t.usdt}
                </div>
                <div className="text-xs text-ink2 tabular-nums">{t.ngn}</div>
                <div>
                  <span
                    className="rounded-full px-[9px] py-[3px] text-[10.5px] font-bold"
                    style={{ background: sm.bg, color: sm.fg }}
                  >
                    {sm.l}
                  </span>
                </div>
              </button>
            )
          })}
        </div>
      )}

      {/* ===== CHAT ===== */}
      {tab === "chat" && (
        <div className="max-w-[720px] rounded-2xl border border-line bg-card p-5">
          <div className="mb-4 flex items-center gap-[9px] text-xs text-ink3">
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden
            >
              <path
                d="M7 11V8a5 5 0 0 1 10 0v3"
                stroke="currentColor"
                strokeWidth="1.6"
              />
              <rect
                x="5"
                y="11"
                width="14"
                height="9"
                rx="2"
                stroke="currentColor"
                strokeWidth="1.6"
              />
            </svg>
            Read-only transcript · secrets redacted · WhatsApp + web
          </div>
          {CHAT.map((m, i) => (
            <div
              key={i}
              className="mb-3 flex"
              style={{ justifyContent: m.justify }}
            >
              <div className="max-w-[75%]">
                <div
                  className="rounded-[14px] p-[10px_13px] text-[13px] leading-[1.45]"
                  style={{ background: m.bg, color: m.fg }}
                >
                  {m.text}
                </div>
                {m.intent && (
                  <div className="mt-[5px] inline-flex items-center gap-1.5 rounded-full bg-sif px-[9px] py-[3px] text-[10.5px] font-bold text-tif">
                    <svg
                      width="11"
                      height="11"
                      viewBox="0 0 24 24"
                      fill="none"
                      aria-hidden
                    >
                      <path
                        d="M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2z"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinejoin="round"
                      />
                    </svg>
                    intent: {m.intent} → {m.proposal}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ===== LIMITS ===== */}
      {tab === "limits" && (
        <div className="grid grid-cols-2 items-start gap-3.5">
          <Panel>
            <div className="mb-1 text-[13px] font-extrabold">
              Effective limits · {CU.tier}
            </div>
            <div className="mb-3.5 text-[11.5px] text-ink3">
              Per-tier caps with this user&apos;s overrides applied.
            </div>
            {LIMITS.map((l) => (
              <div
                key={l.k}
                className="flex justify-between gap-3 border-b border-line2 py-[9px]"
              >
                <span className="text-[12.5px] text-ink2">{l.k}</span>
                <span className="font-mono text-[12.5px] font-bold tabular-nums">
                  {l.v}{" "}
                  {l.override && (
                    <span className="rounded-[5px] bg-sif px-1.5 py-px text-[9.5px] font-extrabold text-tif">
                      OVERRIDE
                    </span>
                  )}
                </span>
              </div>
            ))}
          </Panel>
          <Panel>
            <div className="mb-3.5 text-[13px] font-extrabold">
              Current velocity usage
            </div>
            {VELOCITY.map((v) => (
              <div key={v.k} className="mb-[15px]">
                <div className="mb-1.5 flex justify-between">
                  <span className="text-xs font-semibold text-ink2">{v.k}</span>
                  <span
                    className="font-mono text-[11.5px] font-bold tabular-nums"
                    style={{ color: v.fg }}
                  >
                    {v.used} / {v.cap}
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-md bg-card2">
                  <div
                    className="h-full rounded-md"
                    style={{ width: v.pct, background: v.bar }}
                  />
                </div>
              </div>
            ))}
          </Panel>
        </div>
      )}

      {/* ===== FLOW MODALS (reason → step-up → engine / maker / pii) ===== */}
      <ReasonModal
        open={current === "reason"}
        onOpenChange={(o) => !o && cancelFlow()}
        title={flow?.title ?? ""}
        onContinue={() => advance()}
      />
      <StepUpModal
        open={current === "stepup"}
        onOpenChange={(o) => !o && cancelFlow()}
        title={flow?.title ?? ""}
        onComplete={() => advance()}
      />
      <PiiRevealModal
        open={current === "pii"}
        onOpenChange={(o) => !o && cancelFlow()}
        piiLabel={flow?.piiLabel ?? "NIN & BVN"}
        onContinue={() => advance()}
      />
      <EngineActionModal
        open={current === "engine"}
        onOpenChange={(o) => !o && cancelFlow()}
        title={flow?.title ?? ""}
        effect={flow?.effect ?? []}
        ledger={flow?.ledger ?? []}
        idempotencyKey="idem_9f31c0a2"
        cta="Execute via engine"
        onExecute={() => advance()}
      />
      <MakerCheckerModal
        open={current === "maker"}
        onOpenChange={(o) => !o && cancelFlow()}
        title={flow?.title ?? ""}
        diff={flow?.diff ?? []}
        onSubmit={() => advance()}
      />
    </div>
  )
}
