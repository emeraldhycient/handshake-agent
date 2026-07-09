import { createZodDto } from 'nestjs-zod';
import { UpdateProfileRequestSchema } from '@handshake-agent/contracts';

/**
 * Request DTO for PATCH /profile.
 * Strict schema — KYC-owned identity fields are rejected at the boundary; the
 * fiat currency is additionally re-validated server-side against the live
 * catalog (AssetRegistry) in ProfileSettingsService (§3.3).
 */
export class UpdateProfileDto extends createZodDto(
  UpdateProfileRequestSchema,
) {}
