"use client"

/**
 * AccountMenu — the topbar account pill (design chrome §4.2). A DropdownMenu
 * anchored to the pill: the signed-in email + the operator's REAL role at the top
 * (an honest read-only display), and a Sign out item wired to the shell's
 * auth-store `clear`.
 *
 * There is no "view as role" impersonation switcher: the console never re-scopes
 * itself to another role client-side. The role shown is always the operator's own,
 * and RBAC is enforced server-side regardless (§3.3).
 */
import Link from "next/link"
import { DropdownMenu } from "radix-ui"
import { ChevronDown, LogOut, UserRound } from "lucide-react"

import type { AccountMenuProps } from "@/types"

/** Striped operator avatar (design §4.2) — brand-green token, never a hex. */
const STRIPE_AVATAR =
  "repeating-linear-gradient(45deg, color-mix(in srgb, var(--brand-green) 72%, white) 0 5px, var(--brand-green) 5px 10px)"

export function AccountMenu({
  email,
  realRoleLabel,
  onSignOut,
}: AccountMenuProps) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label="Account menu"
          className="ml-0.5 flex h-[42px] items-center gap-[10px] rounded-full py-0 pr-[6px] pl-[4px] transition-colors outline-none hover:bg-hov focus-visible:ring-2 focus-visible:ring-ring/50 data-[state=open]:bg-hov"
        >
          <span
            aria-hidden="true"
            style={{ background: STRIPE_AVATAR }}
            className="size-[34px] flex-none rounded-full"
          />
          <span className="min-w-0 text-left">
            <span className="block max-w-[160px] truncate text-[12.5px] font-bold text-ink">
              {email || "…"}
            </span>
            <span className="flex items-center gap-[5px]">
              <span className="size-[6px] flex-none rounded-full bg-[color:var(--brand-amber)]" />
              <span className="truncate text-[10.5px] font-semibold text-ink2">
                {realRoleLabel}
              </span>
            </span>
          </span>
          <ChevronDown
            aria-hidden="true"
            className="size-[15px] flex-none text-ink3"
          />
        </button>
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={8}
          className="z-50 w-[260px] overflow-hidden rounded-2xl border border-line bg-card p-[6px] shadow-flow outline-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
        >
          {/* Signed-in identity — honest email + real role (no impersonation). */}
          <div className="px-[10px] pt-[8px] pb-[10px]">
            <div className="truncate text-[12.5px] font-bold text-ink">
              {email || "…"}
            </div>
            <div className="mt-0.5 text-[11.5px] font-medium text-ink2">
              {realRoleLabel}
            </div>
          </div>

          <DropdownMenu.Separator className="my-[2px] h-px bg-line" />

          {/* My account — self-service profile (edit own display name) */}
          <DropdownMenu.Item asChild>
            <Link
              href="/account"
              className="flex cursor-pointer items-center gap-[9px] rounded-xl px-[10px] py-[8px] text-[13px] font-semibold text-ink outline-none data-[highlighted]:bg-hov"
            >
              <UserRound aria-hidden="true" className="size-[15px] flex-none" />
              My account
            </Link>
          </DropdownMenu.Item>

          {/* Sign out */}
          <DropdownMenu.Item
            onSelect={onSignOut}
            className="flex cursor-pointer items-center gap-[9px] rounded-xl px-[10px] py-[8px] text-[13px] font-semibold text-[color:var(--destructive)] outline-none data-[highlighted]:bg-[color:var(--danger-muted)]"
          >
            <LogOut aria-hidden="true" className="size-[15px] flex-none" />
            Sign out
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
