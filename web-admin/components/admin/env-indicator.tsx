"use client"

/**
 * EnvIndicator — the topbar environment chip (design chrome §4.2). In the
 * design the TESTNET chip is static; here it is click-responsive but HONEST: a
 * small read-only Popover that states the environment. It does NOT fake a
 * mainnet switch — mainnet is provisioned at launch, not toggled from the UI.
 *
 * The pulsing-dot + TESTNET label styling is preserved exactly.
 */
import { Popover } from "radix-ui"

export function EnvIndicator() {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label="Environment: Testnet"
          className="flex h-[32px] items-center gap-[7px] rounded-full bg-[color:var(--warn-muted)] px-[12px] text-[11.5px] font-extrabold tracking-[0.05em] text-[color:var(--warn)] outline-none focus-visible:ring-2 focus-visible:ring-ring/50 data-[state=open]:ring-2 data-[state=open]:ring-ring/50"
        >
          <span className="size-[7px] animate-hs-pulse rounded-full bg-current" />
          TESTNET
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={8}
          className="z-50 w-[260px] rounded-2xl border border-line bg-card p-[14px] shadow-flow outline-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
        >
          <div className="flex items-center gap-[7px] text-[12.5px] font-bold text-ink">
            <span className="size-[7px] rounded-full bg-[color:var(--warn)]" />
            Environment: Testnet
          </div>
          <p className="mt-[8px] text-[12px] leading-relaxed text-ink2">
            This console operates against the testnet environment. Mainnet is
            provisioned at launch.
          </p>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
