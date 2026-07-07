"use client"

import { Popover } from "radix-ui"

import { AML_RULE_TYPE_EXAMPLES } from "@/constants/aml"

/** The "?" help popover listing the example rule types (accessible, tokens only). */
export function AmlRuleTypesHelp() {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label="Example AML rule types"
          className="inline-flex size-[18px] items-center justify-center rounded-full border border-line text-[11px] font-bold text-ink3 transition-colors outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-ring/50 data-[state=open]:ring-2 data-[state=open]:ring-ring/50"
        >
          ?
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={8}
          className="z-50 w-[320px] rounded-2xl border border-line bg-card p-[14px] shadow-flow outline-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 motion-reduce:animate-none motion-reduce:transition-none"
        >
          <div className="text-[12.5px] font-bold text-ink">
            Example rule types
          </div>
          <p className="mt-[6px] text-[11.5px] leading-relaxed text-ink2">
            Rules are admin-authored — add the ones your policy needs. The
            engine understands, among others:
          </p>
          <ul className="mt-[10px] flex flex-col gap-[9px]">
            {AML_RULE_TYPE_EXAMPLES.map((ex) => (
              <li key={ex.key}>
                <code className="rounded-[5px] bg-bg px-[5px] py-[1px] font-mono text-[11px] font-semibold text-ink">
                  {ex.key}
                </code>
                <span className="mt-[2px] block text-[11.5px] leading-snug text-ink2">
                  {ex.desc}
                </span>
              </li>
            ))}
          </ul>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
