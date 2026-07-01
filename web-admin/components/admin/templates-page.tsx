"use client"

/**
 * TemplatesPage — the Configuration group's notification-template screen
 * (operator-console design system §6.19, `docs/design-ref/screens/Templates.html`).
 *
 * Reproduces the design 1:1: a `1fr 1fr` grid of template preview cards, each
 * carrying a channel chip (status-token color pair) + mono template name +
 * approval pill, a `locale · vars` line, and a body preview inset in a `bg-card2`
 * box. Email (Resend) + WhatsApp approved-template management.
 *
 * DATA is design-faithful (markup-first reproduction): `docs/design-ref/logic.js`
 * does NOT carry the `vTemplates()` view method (truncated), so the card content is
 * representative sample data matching the markup + the seed() dataset shapes (real
 * operator-facing template keys/bodies). It is module-level const — no fetching,
 * no query hooks — so the screen renders exactly what the design shows. Re-wiring to
 * the real `GET /admin/notification-templates` endpoint is a separate later step.
 *
 * The design markup renders static cards (no click handler / no editor trigger on
 * the screen itself), so this reproduction is read-only — no dialog is opened from
 * a card. Nothing here moves money (§3.1).
 */
import { cn } from "@/lib/utils"
import type {
  TemplateApproval,
  TemplateCardRow,
  TemplateChannel,
} from "@/types/components"

// ─── Token maps (§5 status→token pairs) ─────────────────────────────────────────────

/** Channel chip → status-token surface + text pair (WhatsApp=success, Email=info). */
const CHANNEL_CLASS: Record<TemplateChannel, string> = {
  WhatsApp: "bg-sok text-tok",
  Email: "bg-sif text-tif",
}

/** Approval pill → status-token surface + text pair (Approved/Pending/Rejected). */
const APPROVAL_CLASS: Record<TemplateApproval, string> = {
  Approved: "bg-sok text-tok",
  Pending: "bg-swn text-twn",
  Rejected: "bg-sdn text-tdn",
}

// ─── Design-faithful sample content (no view method in logic.js) ────────────────────
// design-faithful: `vTemplates()` is truncated from logic.js, so these are
// representative rows matching the Templates.html markup + the seed() dataset shapes
// (Email via Resend + WhatsApp approved templates, real operator-facing keys/bodies).
const TEMPLATE_ROWS: ReadonlyArray<TemplateCardRow> = [
  {
    id: "wa_kyc_verified_v2",
    channel: "WhatsApp",
    name: "kyc_verified_v2",
    approval: "Approved",
    locale: "en",
    vars: 2,
    body: "Hi {{1}}, your identity is verified. Your account is now Tier {{2}} — you can buy, sell and send. Reply MENU to get started.",
  },
  {
    id: "email_tx_receipt",
    channel: "Email",
    name: "tx_receipt",
    approval: "Approved",
    locale: "en",
    vars: 4,
    body: "Your {{type}} of {{amount}} settled on {{date}}. Reference {{ref}}. This receipt is signed and available in your activity history.",
  },
  {
    id: "wa_pin_reset_otp",
    channel: "WhatsApp",
    name: "pin_reset_otp",
    approval: "Approved",
    locale: "en",
    vars: 1,
    body: "Your Handshake Agent verification code is {{1}}. It expires in 5 minutes. Never share this code — we will never ask for it.",
  },
  {
    id: "email_kyc_needs_info",
    channel: "Email",
    name: "kyc_needs_info",
    approval: "Pending",
    locale: "en_NG",
    vars: 3,
    body: "Hi {{name}}, we need one more thing to verify your account: {{reason}}. Tap {{link}} to continue — it takes under two minutes.",
  },
  {
    id: "wa_ticket_purchase",
    channel: "WhatsApp",
    name: "ticket_purchase_confirm",
    approval: "Pending",
    locale: "en",
    vars: 3,
    body: "You're going to {{1}}! {{2}} ticket(s) confirmed. Your entry QR is attached and saved in this chat. Ref {{3}}.",
  },
  {
    id: "email_low_balance",
    channel: "Email",
    name: "low_balance_nudge",
    approval: "Approved",
    locale: "en",
    vars: 2,
    body: "Heads up {{name}} — your USDT balance is now {{amount}}. Top up in a tap to keep sending and paying without interruption.",
  },
]

// ─── Sub-components ─────────────────────────────────────────────────────────────────

/**
 * One template preview card — matches the Templates.html markup exactly: a header
 * row (channel chip · mono name · approval pill), a `locale · vars` meta line, and a
 * body preview inset in a `bg-card2` box.
 */
function TemplateCard({ row }: { row: TemplateCardRow }) {
  return (
    <div className="rounded-[16px] border border-line bg-card px-5 py-[18px]">
      {/* ── Header row: channel chip · mono name · approval pill ─────────────── */}
      <div className="mb-2.5 flex items-center gap-2.5">
        <span
          className={cn(
            "shrink-0 rounded-md px-[9px] py-[3px] text-[11px] font-bold",
            CHANNEL_CLASS[row.channel]
          )}
        >
          {row.channel}
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-[13px] font-bold text-ink">
          {row.name}
        </span>
        <span
          className={cn(
            "shrink-0 rounded-full px-[9px] py-[3px] text-[10.5px] font-bold",
            APPROVAL_CLASS[row.approval]
          )}
        >
          {row.approval}
        </span>
      </div>

      {/* ── locale · vars line ──────────────────────────────────────────────── */}
      <div className="mb-2 text-[11px] text-ink3">
        locale {row.locale} · vars: {row.vars}
      </div>

      {/* ── Body preview inset (bg-card2) ───────────────────────────────────── */}
      <div className="rounded-[10px] bg-card2 px-[13px] py-[11px] text-[12px] leading-[1.5] text-ink2">
        {row.body}
      </div>
    </div>
  )
}

// ─── Page ───────────────────────────────────────────────────────────────────────

export function TemplatesPage() {
  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-[1200px] px-[30px] pt-[26px] pb-[60px]">
        {/* ── Header ────────────────────────────────────────────────────────── */}
        <div className="mb-4">
          <h1 className="text-[24px] font-extrabold tracking-[-0.02em] text-ink">
            Templates
          </h1>
          <p className="mt-[5px] text-[13.5px] text-ink2">
            Email (Resend) and WhatsApp approved-template management.
          </p>
        </div>

        {/* ── 1fr 1fr grid of template preview cards ────────────────────────── */}
        <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2">
          {TEMPLATE_ROWS.map((row) => (
            <TemplateCard key={row.id} row={row} />
          ))}
        </div>
      </div>
    </div>
  )
}
