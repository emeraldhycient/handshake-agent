import { createZodDto } from 'nestjs-zod';
import { ClaimPayIdSchema } from '@handshake-agent/contracts';

/**
 * Request DTO for PATCH /profile/payid. `.strict()` (from the shared
 * schema) — no extra fields accepted. The PayID value itself is
 * PayIdSchema-validated (format + reserved-word denylist); the ONE-CHANGE
 * guard and shared-namespace availability are enforced server-side by
 * HandleService (§3.3 — the frontend gate is UX, not the check).
 */
export class ClaimPayIdDto extends createZodDto(ClaimPayIdSchema) {}
