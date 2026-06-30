import { createZodDto } from 'nestjs-zod';
import {
  AdminInvitationAcceptRequestSchema,
  AdminInvitationCreateRequestSchema,
} from '@handshake-agent/contracts';

/** Request DTO for POST /admin/invitations. */
export class AdminInvitationCreateDto extends createZodDto(
  AdminInvitationCreateRequestSchema,
) {}

/** Request DTO for POST /admin/invitations/accept. */
export class AdminInvitationAcceptDto extends createZodDto(
  AdminInvitationAcceptRequestSchema,
) {}
