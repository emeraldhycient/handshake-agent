"use client"

/**
 * AccountMenu — the topbar account / role switcher (design chrome §4.2
 * `toggleRoleMenu`). A DropdownMenu anchored to the account pill: the signed-in
 * email + current role at the top, a "View as role" section that scopes the
 * console banner + role label (a UX affordance — real RBAC is untouched), and a
 * Sign out item wired to the shell's auth-store `clear`.
 *
 * State is lifted: the shell owns `viewAs`; this component reports selections up.
 */
import { DropdownMenu } from "radix-ui"
import { ChevronDown, Eye, LogOut } from "lucide-react"

import { cn } from "@/lib/utils"
import { pushToast } from "@/lib/store/toast-store"
import type { AccountMenuProps, ViewAsRole } from "@/types/components"

/** The impersonatable roles offered in the menu (design chrome view-as list). */
const VIEW_AS_ROLES: readonly ViewAsRole[] = [
  { id: "super_admin", label: "Super Admin" },
  { id: "operations", label: "Operations" },
  { id: "compliance", label: "Compliance" },
  { id: "finance", label: "Finance" },
  { id: "support", label: "Support" },
]

/** Striped operator avatar (design §4.2) — brand-green token, never a hex. */
const STRIPE_AVATAR =
  "repeating-linear-gradient(45deg, color-mix(in srgb, var(--brand-green) 72%, white) 0 5px, var(--brand-green) 5px 10px)"

export function AccountMenu({
  email,
  realRoleLabel,
  viewAs,
  onViewAs,
  onSignOut,
}: AccountMenuProps) {
  // The role shown on the pill: the view-as role while active, else the real one.
  const activeRoleLabel = viewAs?.label ?? realRoleLabel
  const activeRoleId = viewAs?.id ?? "super_admin"

  function selectRole(role: ViewAsRole) {
    onViewAs(role)
    pushToast(`Now viewing as ${role.label}`, "ok")
  }

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
                {activeRoleLabel}
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
          {/* Signed-in identity */}
          <div className="px-[10px] pt-[8px] pb-[10px]">
            <div className="truncate text-[12.5px] font-bold text-ink">
              {email || "…"}
            </div>
            <div className="mt-0.5 text-[11.5px] font-medium text-ink2">
              {realRoleLabel}
            </div>
          </div>

          <DropdownMenu.Separator className="my-[2px] h-px bg-line" />

          {/* View-as roles */}
          <DropdownMenu.Label className="px-[10px] pt-[6px] pb-[4px] text-[11px] font-bold tracking-[0.06em] text-ink3 uppercase">
            View as role
          </DropdownMenu.Label>
          {VIEW_AS_ROLES.map((role) => {
            const isActive = role.id === activeRoleId
            return (
              <DropdownMenu.Item
                key={role.id}
                onSelect={() => selectRole(role)}
                className={cn(
                  "flex cursor-pointer items-center gap-[9px] rounded-xl px-[10px] py-[8px] text-[13px] font-semibold outline-none data-[highlighted]:bg-hov",
                  isActive ? "text-ink" : "text-ink2"
                )}
              >
                <Eye
                  aria-hidden="true"
                  className={cn(
                    "size-[15px] flex-none",
                    isActive ? "text-[color:var(--brand-amber)]" : "text-ink3"
                  )}
                />
                <span className="flex-1">{role.label}</span>
                {isActive && (
                  <span
                    aria-hidden="true"
                    className="size-[6px] flex-none rounded-full bg-[color:var(--brand-amber)]"
                  />
                )}
              </DropdownMenu.Item>
            )
          })}

          <DropdownMenu.Separator className="my-[2px] h-px bg-line" />

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
