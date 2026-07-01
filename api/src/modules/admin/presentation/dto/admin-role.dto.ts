import { createZodDto } from 'nestjs-zod';
import {
  RoleCreateRequestSchema,
  RoleUpdateRequestSchema,
} from '@handshake-agent/contracts';

/** Request DTO for POST /admin/roles. */
export class RoleCreateDto extends createZodDto(RoleCreateRequestSchema) {}

/** Request DTO for PATCH /admin/roles/:id. */
export class RoleUpdateDto extends createZodDto(RoleUpdateRequestSchema) {}
