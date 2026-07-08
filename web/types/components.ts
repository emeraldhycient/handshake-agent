/**
 * Centralized component prop types (§13.4 — no inline prop types).
 * All `XxxProps` interfaces for shared atoms live here and are imported
 * into the component files.
 */

import type {
  QuoteRow,
  StatusTone,
  QuoteView,
  BalanceView,
  DepositView,
  TicketsView,
  TicketOption,
  TransactionsView,
  ReceiptView,
  PayInView,
  SettlingView,
  SwapView,
  NeedsBeneficiaryView,
  ChatMessage,
  ChatAction,
  ConfirmPayload,
  DashboardPage,
  SearchResult,
} from "@/lib/schemas"
import type { Language } from "@/lib/i18n/languages"

// ─── Density ──────────────────────────────────────────────────────────────────

/** Drives sizing/padding/radii variants across all chat message cards. */
export type Density = "mobile" | "desktop"

/** Shared "Load more" / "Show more" paginator button. */
export interface LoadMoreButtonProps {
  onClick: () => void
  isPending: boolean
  /** Active label, e.g. "Load more" or "Show more (10 of 12)". */
  label: string
  /** Shown (and disables the button) while pending. Default "Loading…". */
  pendingLabel?: string
  ariaLabel?: string
  /** Per-site shape (rounded-full pill vs full-width block). */
  className?: string
}

// ─── ActionButton (shared quick-action primitive) ────────────────────────────

/**
 * The one canonical Buy/Send/Receive/Swap quick-action button (§13.1). Used by
 * the overview hero, the wallet page header, and the mobile wallet tab so all
 * three render identically. `layout` switches between the inline pill (desktop)
 * and the stacked icon-tile (mobile wallet). The `label` is always the
 * accessible name; `icon` is decorative (callers pass an aria-hidden glyph).
 */
export interface ActionButtonProps {
  label: string
  /** Decorative glyph/icon node — rendered aria-hidden; the label names the button. */
  icon?: React.ReactNode
  variant?: "primary" | "secondary"
  /** "inline" → icon beside label (default). "stacked" → icon above label (mobile tile). */
  layout?: "inline" | "stacked"
  onClick: () => void
  className?: string
}

// ─── Money (10.1) ─────────────────────────────────────────────────────────────

export interface MoneyProps {
  value: string
  /** Rendered HTML element — defaults to "span" for inline usage */
  as?: "span" | "div" | "p"
  className?: string
}

// ─── DetailRows (10.2) ────────────────────────────────────────────────────────

export interface DetailRowsProps {
  rows: QuoteRow[]
  className?: string
}

// ─── StatusPill (10.3) ────────────────────────────────────────────────────────

export interface StatusPillProps {
  tone: StatusTone
  children: React.ReactNode
  className?: string
}

// ─── AssetIcon (10.4) ─────────────────────────────────────────────────────────

export interface AssetIconProps {
  sym: string
  /** Data tint color — applied via inline style (the one approved hex exception) */
  tint: string
  /**
   * Optional absolute URL to the asset's logo image. When set, the icon renders
   * the logo (lazy, alt=sym); on a missing URL or load error it falls back to
   * the tinted text badge.
   */
  logoUrl?: string
  size?: "sm" | "md"
  className?: string
}

// ─── QrPlaceholder (10.5) ─────────────────────────────────────────────────────

export interface QrPlaceholderProps {
  size?: number
  className?: string
}

// ─── QrCode (real, scannable) ─────────────────────────────────────────────────

/** Real QR primitive (wraps qrcode.react); renders no external calls. */
export interface QrCodeProps {
  /** The URL/string the QR encodes. */
  value: string
  /** Accessible name for the QR image region. */
  label: string
  /** Pixel size of the square QR. Default 180. */
  size?: number
  className?: string
}

// ─── PWA install affordance ───────────────────────────────────────────────────

/** Icon-button that opens the install modal; hides itself once installed. */
export interface InstallButtonProps {
  /** Visual placement — "chrome" (topbar icon) or "header" (dark header icon). */
  tone?: "chrome" | "header"
  className?: string
}

/** Controlled install modal (uses the Dialog primitive — focus trap + Esc). */
export interface InstallModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * Presentational install guidance — the branch shown depends on capability:
 * a native install button (Chromium), iOS "Add to Home Screen" steps, or a
 * generic browser hint. Reused by the install modal and the /download page.
 */
export interface InstallInstructionsProps {
  /** A native prompt is available — render the one-tap install button. */
  canPrompt: boolean
  /** iOS Safari — render manual "Add to Home Screen" steps. */
  isIOS: boolean
  /** The native prompt is in flight — disable the button. */
  installing: boolean
  /** Fire the native prompt. */
  onInstall: () => void
  className?: string
}

// ─── AvatarPlaceholder (10.6) ─────────────────────────────────────────────────

export interface AvatarPlaceholderProps {
  size?: number
  className?: string
}

// ─── BrandMark (logo) ─────────────────────────────────────────────────────────

export interface BrandMarkProps {
  /**
   * Centre treatment:
   *  - "default" — static dark square (the standing logo mark)
   *  - "spark"   — animated rotating sunburst (Claude-style), for thinking / splash
   */
  variant?: "default" | "spark"
  /** Outer tile size in px. Centre + corner radii scale proportionally. Default 42. */
  size?: number
  /**
   * Accessible name. When set, the mark is exposed as `role="img"` with this
   * label; when omitted the mark is decorative (`aria-hidden`) — it normally
   * sits beside the "Handshake Agent" wordmark.
   */
  ariaLabel?: string
  className?: string
}

// ─── Chat message cards (Phase 11) ────────────────────────────────────────────

/** 11.1 */
export type QuoteCardProps = QuoteView & {
  density: Density
  onConfirm: () => void
  className?: string
}

/** 11.2 */
export type BalanceCardProps = BalanceView & {
  density: Density
  className?: string
}

/** 11.3 */
export type ReceiveCardProps = DepositView & {
  density: Density
  onCopy?: () => void
  className?: string
}

/** 11.4 */
export type TicketsCardProps = TicketsView & {
  density: Density
  onSelect: (opt: TicketOption) => void
  className?: string
}

/** Transaction-history list card. */
export type TransactionsCardProps = TransactionsView & {
  density: Density
  className?: string
}

/** 11.5 */
export type ReceiptCardProps = ReceiptView & {
  density: Density
  onShare?: () => void
  className?: string
}

// ─── Phase 12 chat thread components ──────────────────────────────────────────

/** 12.2 */
export interface ChatMessageViewProps {
  message: ChatMessage
  density: Density
  onConfirm: (m: ChatMessage) => void
  onSelectTicket: (opt: TicketOption) => void
  /**
   * Resolve a needs_beneficiary card — re-asks the sell/send with the new id.
   * `messageId` is the resolving card's id so the store resumes the EXACT intent
   * that card was bound to (not the mutable last-intent). Optional for legacy
   * callers that don't forward it.
   */
  onResolveBeneficiary: (beneficiaryId: string, messageId?: string) => void
}

/** 12.3 */
export interface ChatComposerProps {
  chips: ChatAction[]
  value: string
  onChange: (v: string) => void
  onSubmit: () => void
  onChip: (a: ChatAction) => void
  density: Density
  recording: boolean
  recordSeconds: number
  canRecord: boolean
  onRecordStart: () => void
  onRecordStop: () => void
  onRecordCancel: () => void
}

/** 12.4 */
export interface ChatThreadProps {
  messages: ChatMessage[]
  typing: boolean
  density: Density
  onConfirm: (m: ChatMessage) => void
  onSelectTicket: (opt: TicketOption) => void
  /** Forwarded to each card; `messageId` binds the resume to that exact card. */
  onResolveBeneficiary: (beneficiaryId: string, messageId?: string) => void
}

// ─── Phase 13 overlay components ──────────────────────────────────────────────

/** 13.1 */
export interface ConfirmSheetProps {
  open: boolean
  payload: ConfirmPayload | null
  density: Density
  /** May be async — triggers authorizeProposal in the authenticated flow. */
  onConfirm: () => void | Promise<void>
  onCancel: () => void
  /** Error message shown when authorize fails (wrong state, expired, etc.). */
  error?: string | null
  /** True while authorizeProposal is in flight — disables the CTA. */
  authorizing?: boolean
}

/** 13.2 */
export interface PinPadProps {
  open: boolean
  /** Number of digits entered so far (0–4). Controls filled dot count. */
  pinLength: number
  density: Density
  onDigit: (d: string) => void
  onBack: () => void
  onFaceId: () => void
  onCancel: () => void
  /** Error message shown below the dots after a wrong PIN / expired directive. */
  error?: string | null
  /** Alias for `error` — preferred when passed from the store's `pinError` field. */
  errorText?: string
}

// ─── Pay-in card (Phase 4) ────────────────────────────────────────────────────

/** 11.6 — Bank transfer card shown while a buy order is settling */
export type PayInCardProps = PayInView & {
  density: Density
  className?: string
}

/** Outbound-settlement card shown while a sell payout / send withdrawal is in flight */
export type SettlingCardProps = SettlingView & {
  density: Density
  className?: string
}

/** Swap confirmation card for a live swap proposal from the engine. */
export type SwapCardProps = SwapView & {
  density: Density
  onConfirm: () => void
  className?: string
}

/** Inline add/select-beneficiary card shown for a needs_beneficiary outcome */
export type NeedsBeneficiaryCardProps = NeedsBeneficiaryView & {
  density: Density
  /**
   * This card's chat-message id. Forwarded to `onResolve` so the store resumes
   * the EXACT intent this card was created for (not the mutable last-intent).
   */
  messageId?: string
  /**
   * Called with the chosen/added beneficiary id once the user resolves it; the
   * card forwards its own `messageId` as the second arg for per-card binding.
   */
  onResolve: (beneficiaryId: string, messageId?: string) => void
  className?: string
}

/** 13.3 */
export interface SuccessOverlayProps {
  open: boolean
  text: string
}

// ─── Phase 14 onboarding ──────────────────────────────────────────────────────

/** 14.1 — presentational; no router dependency */
export interface KycSummaryProps {
  onFinish: () => void
}

/** 14.2 — single verification row inside KycSummary */
export interface VerificationRowProps {
  /**
   * Left-slot override. When provided, renders `iconNode` directly instead of
   * the default icon-box wrapper. Used for the selfie circular thumbnail.
   */
  iconNode?: React.ReactNode
  /** Icon element rendered inside the default square icon-box (ignored when `iconNode` is set). */
  icon?: React.ReactNode
  label: string
  value: string
  /** Apply font-mono to the value (masked numbers). */
  valueMono?: boolean
  pillLabel: string
}

// ─── Phase 16 desktop components ─────────────────────────────────────────────

/**
 * Shared prop shape for full-page desktop views that expose a quick-action
 * entry-point into the chat rail. All three desktop pages
 * (OverviewPage / WalletPage / TicketsPage) satisfy this interface exactly.
 */
export interface PageWithQuickActionProps {
  onQuickAction: (action: ChatAction, label: string) => void
  className?: string
}

/** 16.1 */
export interface DashboardSidebarProps {
  active: DashboardPage
  onNavigate: (p: DashboardPage) => void
  className?: string
}

/** 16.2 */
export interface DashboardTopbarProps {
  onSearchSelect: (r: SearchResult) => void
  onQuickAction: (action: ChatAction, label: string) => void
  className?: string
}

/** 16.4 */
export interface ChatRailProps {
  store?: import("@/lib/store/chat-store").ChatStore
  className?: string
}

// ─── Shared FocusTrap (Step 0 extraction) ────────────────────────────────────

export interface FocusTrapProps {
  ariaLabel: string
  children: React.ReactNode
  className?: string
}

// ─── KYC web-handoff form (Fix H) ────────────────────────────────────────────

/** Props for the KycForm feature component. */
export interface KycFormProps {
  /** Single-use handoff token from the URL query param `t`. */
  token: string
}

// ─── Auth forms ──────────────────────────────────────────────────────────────

/** Props for SignupForm — no required props; self-contained. */
export interface SignupFormProps {
  className?: string
}

/** Props for VerifyEmailForm — token comes from the URL query param. */
export interface VerifyEmailFormProps {
  token: string
}

/** Props for LoginForm — no required props; self-contained. */
export interface LoginFormProps {
  className?: string
}

/** Props for RequireVerified — wraps children that require verified KYC status. */
export interface RequireVerifiedProps {
  children: React.ReactNode
}

// ─── Phase 15 mobile components ───────────────────────────────────────────────

/** 15.1 — presentational; no state */
export interface ChatHeaderProps {
  className?: string
}

/** 15.1 — bottom navigation tabbar */
export type MobileTabId = "chat" | "wallet" | "activity" | "settings"
export interface MobileTabbarProps {
  active: MobileTabId
  onSelect: (tab: MobileTabId) => void
  className?: string
}

/** 15.2 — wallet tab data + callbacks (placeholder until Task 15.2) */
export interface WalletTabProps {
  onQuickAction: (
    action: import("@/lib/schemas").ChatAction,
    label: string
  ) => void
}

/** 15.2 — activity tab */
export interface ActivityTabProps {
  className?: string
}

/** 15.3 — MobileShell accepts an optional injected store for tests */
export interface MobileShellProps {
  store?: import("@/lib/store/chat-store").ChatStore
}

// ─── Multi-language (TranslationProvider) ────────────────────────────────────

export interface TranslationContextValue {
  language: Language
  languages: readonly Language[]
  setLanguage: (code: string) => void
  resetLanguage: () => void
}

export interface LanguageSelectorProps {
  className?: string
}

// ─── Shared SettingsPanel (Task 7) ────────────────────────────────────────────

export interface SettingsPanelProps {
  density?: "desktop" | "mobile"
  className?: string
}
