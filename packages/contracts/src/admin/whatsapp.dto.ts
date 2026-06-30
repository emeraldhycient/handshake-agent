import { z } from "zod";

// Read-only WhatsApp configuration view for the admin Comms console. Surfaces the
// NON-SECRET WhatsApp Cloud-API / Flows wiring (graph version + ids) plus boolean
// presence flags for each secret — the secret VALUES never cross this boundary
// (root CLAUDE.md §3.5: PIN/KYC secrets travel only via Flow E2E, never plaintext).

export const WhatsAppConfigViewSchema = z.object({
  graphVersion: z.string(),
  graphBaseUrl: z.string(),
  phoneNumberId: z.string(),
  flowId: z.string(),
  beneficiaryFlowId: z.string(),
  wabaId: z.string(),
  appId: z.string(),
  /** True iff WHATSAPP_APP_SECRET is configured — the value is never returned. */
  hasAppSecret: z.boolean(),
  /** True iff WHATSAPP_FLOW_PRIVATE_KEY is configured. */
  hasFlowPrivateKey: z.boolean(),
  /** True iff WHATSAPP_VERIFY_TOKEN is configured. */
  hasVerifyToken: z.boolean(),
});
export type WhatsAppConfigView = z.infer<typeof WhatsAppConfigViewSchema>;
