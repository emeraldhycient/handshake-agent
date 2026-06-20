/**
 * Mock data fixtures — exact literals from the prototype
 * (docs/design/_ref/handshake-prototype.html).
 *
 * Asset tint hex values come from ASSET_TINTS (DRY — not re-typed here).
 * These are data values, not theme tokens, so hex is permitted in lib/.
 */

import { ASSET_TINTS, DEPOSIT_ADDRESS } from "@/lib/constants"
import type {
  BalanceView,
  WalletAsset,
  ActivityGroup,
  DepositView,
  EventListItem,
  AppNotification,
  SearchResult,
} from "@/lib/schemas"

// ─── Balance (prototype lines ~1159–1164) ─────────────────────────────────────

export const balanceFixture: BalanceView = {
  kind: "balance",
  total: "≈ ₦72,340",
  assets: [
    {
      sym: "$",
      name: "Tether USD",
      amount: "29.97 USDT",
      value: "₦49,150",
      tint: ASSET_TINTS.USDT,
    },
    {
      sym: "₿",
      name: "Bitcoin",
      amount: "0.00010 BTC",
      value: "₦9,800",
      tint: ASSET_TINTS.BTC,
    },
    {
      sym: "₦",
      name: "Naira balance",
      amount: "₦13,390",
      value: "₦13,390",
      tint: ASSET_TINTS.NGN,
    },
  ],
}

// ─── Wallet assets (prototype lines ~1409–1413) ───────────────────────────────

export const walletAssetsFixture: WalletAsset[] = [
  {
    sym: "$",
    name: "Tether USD",
    sub: "USDT · TRON",
    amount: "29.97 USDT",
    value: "₦49,150",
    change: "+0.1%",
    tint: ASSET_TINTS.USDT,
  },
  {
    sym: "₿",
    name: "Bitcoin",
    sub: "BTC",
    amount: "0.00010 BTC",
    value: "₦9,800",
    change: "+2.4%",
    tint: ASSET_TINTS.BTC,
  },
  {
    sym: "₦",
    name: "Naira",
    sub: "NGN balance",
    amount: "₦13,390",
    value: "₦13,390",
    change: "—",
    tint: ASSET_TINTS.NGN,
  },
]

// ─── Activity (prototype lines ~1414–1423) ────────────────────────────────────
// sCol/sBg from the prototype are replaced with statusTone per the schema.
// Completed → "success", Confirming → "warn"
// The ticket row's icon retains its info tint/col but its statusTone is "success"
// (the ticket transaction completed successfully).

export const activityFixture: ActivityGroup[] = [
  {
    group: "Today",
    items: [
      {
        id: "act-today-1",
        dir: "in",
        icon: "+",
        tint: "#e6f3ec",
        col: "#1f8a5b",
        title: "Bought USDT",
        sub: "2:14pm · ₦50,000",
        amount: "+29.97 USDT",
        status: "Completed",
        statusTone: "success",
      },
      {
        id: "act-today-2",
        dir: "out",
        icon: "↗",
        tint: "#fbeece",
        col: "#9a6a12",
        title: "Sent USDT",
        sub: "2:16pm · to TQn9…gk7r",
        amount: "-26.00 USDT",
        status: "Confirming",
        statusTone: "warn",
      },
    ],
  },
  {
    group: "Yesterday",
    items: [
      {
        id: "act-yest-1",
        dir: "in",
        icon: "↓",
        tint: "#e6f3ec",
        col: "#1f8a5b",
        title: "Received USDT",
        sub: "from Chidi O.",
        amount: "+12.00 USDT",
        status: "Completed",
        statusTone: "success",
      },
      {
        id: "act-yest-2",
        // ticket icon retains info tint/col; status tone is success (payment done)
        dir: "ticket",
        icon: "◇",
        tint: "#eef0fb",
        col: "#3b5bb5",
        title: "Ticket · Afrobeats Live",
        sub: "Regular entry",
        amount: "-₦25,750",
        status: "Completed",
        statusTone: "success",
      },
    ],
  },
]

// ─── Deposit (receive) fixture ────────────────────────────────────────────────

export const depositFixture: DepositView = {
  kind: "receive",
  asset: "USDT",
  network: "TRON · TRC-20",
  address: DEPOSIT_ADDRESS,
  minDeposit: "1 USDT",
  creditedEta: "~1 min",
}

// ─── Events (prototype lines ~1474–1477) ─────────────────────────────────────

export const eventsFixture: EventListItem[] = [
  {
    name: "Burna Boy · Live in Lagos",
    meta: "Sat 26 Jul · Tafawa Balewa Square",
    price: "from ₦30,000",
  },
  {
    name: "Tech Connect Conference",
    meta: "Fri 8 Aug · Landmark Centre",
    price: "from ₦15,000",
  },
  {
    name: "Lagos Food & Drink Festival",
    meta: "Sun 17 Aug · Muri Okunola Park",
    price: "from ₦5,000",
  },
]

// ─── Notifications (prototype lines ~1467–1472) ───────────────────────────────

export const notificationsFixture: AppNotification[] = [
  {
    icon: "+",
    tint: "#e6f3ec",
    col: "#1f8a5b",
    title: "Purchase complete",
    sub: "29.97 USDT credited to your wallet",
    time: "2m",
  },
  {
    icon: "↗",
    tint: "#fbeece",
    col: "#9a6a12",
    title: "Transfer confirming",
    sub: "26.00 USDT broadcasting on TRON",
    time: "5m",
  },
  {
    icon: "◇",
    tint: "#eef0fb",
    col: "#3b5bb5",
    title: "Ticket ready",
    sub: "Afrobeats Live 2026 · QR saved to Wallet",
    time: "1h",
  },
  {
    icon: "%",
    tint: "#fbeece",
    col: "#9a6a12",
    title: "Rate alert",
    sub: "USDT buy rate improved by 0.4%",
    time: "3h",
  },
]

// ─── Search catalog (prototype lines ~1452–1463) ──────────────────────────────

export const searchCatalogFixture: SearchResult[] = [
  {
    kind: "Action",
    title: "Buy USDT",
    desc: "Convert naira to USDT",
    icon: "+",
    tint: "#e6f3ec",
    col: "#1f8a5b",
    action: "buy",
    label: "Buy ₦50,000 of USDT",
  },
  {
    kind: "Action",
    title: "Send crypto",
    desc: "Transfer USDT to anyone",
    icon: "↗",
    tint: "#fbeece",
    col: "#9a6a12",
    action: "send",
    label: "Send 25 USDT",
  },
  {
    kind: "Action",
    title: "Receive / Deposit",
    desc: "Show your address & QR",
    icon: "↓",
    tint: "#e6f3ec",
    col: "#1f8a5b",
    action: "receive",
    label: "Show my deposit address",
  },
  {
    kind: "Action",
    title: "Swap",
    desc: "Convert between assets",
    icon: "⇄",
    tint: "#eef0fb",
    col: "#3b5bb5",
    action: "swap",
    label: "Swap 10 USDT to naira",
  },
  {
    kind: "Action",
    title: "Buy event ticket",
    desc: "Afrobeats Live 2026",
    icon: "◇",
    tint: "#eef0fb",
    col: "#3b5bb5",
    action: "ticket",
    label: "Buy an event ticket",
  },
  {
    kind: "Page",
    title: "Wallet",
    desc: "Assets & balances",
    icon: "▦",
    tint: "#f3efe7",
    col: "#16261e",
    page: "wallet",
  },
  {
    kind: "Page",
    title: "Activity",
    desc: "Transaction history",
    icon: "≣",
    tint: "#f3efe7",
    col: "#16261e",
    page: "activity",
  },
  {
    kind: "Page",
    title: "Tickets",
    desc: "Your tickets & events",
    icon: "◇",
    tint: "#f3efe7",
    col: "#16261e",
    page: "tickets",
  },
  {
    kind: "Page",
    title: "Settings",
    desc: "Security · limits · language",
    icon: "⚙",
    tint: "#f3efe7",
    col: "#16261e",
    page: "settings",
  },
  {
    kind: "Transaction",
    title: "Bought USDT",
    desc: "Today · ₦50,000",
    icon: "+",
    tint: "#e6f3ec",
    col: "#1f8a5b",
    page: "activity",
  },
]
