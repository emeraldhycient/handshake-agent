import { AmlRuleCreateRequestSchema } from "@handshake-agent/contracts"

/** The engine rule types (immutable on edit) — the contract's `ruleType` enum. */
export const RULE_TYPES = AmlRuleCreateRequestSchema.shape.ruleType.options

/** The disposition actions a rule can take — the contract's `action` enum. */
export const ACTIONS = AmlRuleCreateRequestSchema.shape.action.options

/** The parameters JSON textarea styling (mono, monospace input). */
export const PARAMS_TEXTAREA_CLASS =
  "min-h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-2.5 py-1.5 font-mono text-xs shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30"
