import { BulkMessageEventTypeSchema } from "@handshake-agent/contracts"

/** The templated-broadcast event types (the contract's `BulkMessageEventType` enum). */
export const EVENT_TYPES = BulkMessageEventTypeSchema.options

/** The 422 code a large message selection returns until the operator confirms. */
export const BULK_CONFIRM_CODE = "ADMIN_BULK_CONFIRMATION_REQUIRED"
