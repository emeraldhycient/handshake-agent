import {
  ArrowLeftRight,
  Ban,
  Banknote,
  Bell,
  BookText,
  BookUser,
  Cable,
  CircleCheckBig,
  Coins,
  FileSearch,
  Flag,
  Gauge,
  KeyRound,
  LayoutGrid,
  LineChart,
  List,
  Mail,
  MessageSquare,
  MonitorSmartphone,
  Plug,
  Scale,
  ScanSearch,
  Server,
  Settings,
  ShieldCheck,
  ShieldUser,
  SlidersHorizontal,
  Sparkles,
  Tag,
  Ticket,
  TriangleAlert,
  Users,
  Vault,
  Webhook,
} from "lucide-react"

import type { NavGroup } from "@/types/components"

/**
 * Design nav groups (§4.1) mapped onto the web-admin routes + the live `menu.*`
 * RBAC resourceIds. Every destination in the design is present; per-item gating
 * reuses the existing menu resourceIds (no new perms minted). A nav item renders
 * only when its `menu` gate is satisfied by the granted `menus` (UX only — the API
 * still enforces every route); Dashboard + Admin settings (`menu: null`) always show.
 */
export const NAV_GROUPS: readonly NavGroup[] = [
  {
    label: "Overview",
    items: [
      { href: "/", label: "Dashboard", icon: LayoutGrid, menu: null },
      {
        href: "/metrics",
        label: "Metrics & analytics",
        icon: LineChart,
        menu: "menu.metrics",
      },
    ],
  },
  {
    label: "Customers",
    items: [
      { href: "/users", label: "Users", icon: Users, menu: "menu.users" },
      {
        href: "/beneficiaries",
        label: "Beneficiaries",
        icon: BookUser,
        menu: "menu.users",
      },
    ],
  },
  {
    label: "Compliance",
    items: [
      {
        href: "/kyc",
        label: "KYC review",
        icon: ShieldCheck,
        menu: ["menu.kyc", "menu.compliance"],
        badge: "kyc",
      },
      {
        href: "/sanctions",
        label: "Sanctions & screening",
        icon: ScanSearch,
        menu: ["menu.kyc", "menu.compliance"],
      },
      {
        href: "/aml",
        label: "AML / risk",
        icon: TriangleAlert,
        menu: ["menu.kyc", "menu.compliance"],
      },
      {
        href: "/blocked",
        label: "Blocked list",
        icon: Ban,
        menu: ["menu.kyc", "menu.compliance"],
      },
      {
        href: "/compliance",
        label: "Compliance hub",
        icon: FileSearch,
        menu: ["menu.kyc", "menu.compliance"],
      },
    ],
  },
  {
    label: "Money",
    items: [
      {
        href: "/transactions",
        label: "Transactions",
        icon: ArrowLeftRight,
        menu: "menu.transactions",
        badge: "stuck",
      },
      { href: "/ledger", label: "Ledger", icon: BookText, menu: "menu.ledger" },
      {
        href: "/reconciliation",
        label: "Reconciliation",
        icon: Scale,
        menu: "menu.transactions",
        badge: "recon",
      },
      {
        href: "/treasury",
        label: "Treasury",
        icon: Vault,
        menu: "menu.treasury",
      },
    ],
  },
  {
    label: "Configuration",
    items: [
      {
        href: "/settings",
        label: "Settings",
        icon: SlidersHorizontal,
        menu: "menu.config",
      },
      { href: "/pricing", label: "Pricing", icon: Tag, menu: "menu.config" },
      {
        href: "/limits",
        label: "Limits & velocity",
        icon: Gauge,
        menu: "menu.config",
      },
      {
        href: "/capabilities",
        label: "Capabilities",
        icon: Plug,
        menu: "menu.config",
      },
      {
        href: "/assets",
        label: "Asset catalog",
        icon: Coins,
        menu: "menu.config",
      },
      {
        href: "/currencies",
        label: "Currency catalog",
        icon: Banknote,
        menu: "menu.config",
      },
      {
        href: "/providers",
        label: "Providers",
        icon: Cable,
        menu: "menu.config",
      },
      {
        href: "/templates",
        label: "Templates",
        icon: Mail,
        menu: "menu.notifications",
      },
      {
        href: "/flags",
        label: "Feature flags",
        icon: Flag,
        menu: "menu.config",
      },
    ],
  },
  {
    label: "Channels",
    items: [
      {
        href: "/whatsapp",
        label: "WhatsApp",
        icon: MessageSquare,
        menu: "menu.whatsapp",
      },
      {
        href: "/notifications",
        label: "Notifications",
        icon: Bell,
        menu: "menu.notifications",
      },
    ],
  },
  {
    label: "Commerce",
    items: [
      {
        href: "/tickets",
        label: "Ticketing",
        icon: Ticket,
        menu: "menu.tickets",
      },
    ],
  },
  {
    label: "Agent",
    items: [
      {
        href: "/agent",
        label: "Agent config",
        icon: Sparkles,
        menu: "menu.agent",
      },
    ],
  },
  {
    label: "Platform",
    items: [
      {
        href: "/admins",
        label: "Admins & roles",
        icon: ShieldUser,
        menu: "menu.access",
      },
      {
        href: "/roles",
        label: "Roles & permissions",
        icon: KeyRound,
        menu: "menu.access",
      },
      {
        href: "/sessions",
        label: "Sessions",
        icon: MonitorSmartphone,
        menu: "menu.access",
      },
      { href: "/audit", label: "Audit log", icon: List, menu: "menu.audit" },
      {
        // Gated on the CHECKER grant (menu.approvals — held by ops, compliance,
        // finance and support), not menu.access: the maker-checker inbox must be
        // reachable by the second-admin roles that approve changes (four-eyes).
        href: "/approvals",
        label: "Approvals",
        icon: CircleCheckBig,
        menu: "menu.approvals",
        badge: "approvals",
      },
      { href: "/ops", label: "System / ops", icon: Server, menu: "menu.audit" },
      {
        href: "/webhooks",
        label: "Webhooks",
        icon: Webhook,
        menu: "menu.webhooks",
      },
      {
        href: "/admin-settings",
        label: "Admin settings",
        icon: Settings,
        menu: null,
      },
    ],
  },
]

/**
 * The sidebar's fixed dark-green brand gradient (§4.1) — identical in both themes
 * via the brand-green tokens, never `bg-card`.
 */
export const RAIL_BG =
  "linear-gradient(168deg, var(--brand-green) 0%, var(--brand-green-deep) 100%)"
