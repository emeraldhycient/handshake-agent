import { createZodDto } from 'nestjs-zod';
import {
  AdminLoginRequestSchema,
  AdminStepUpRequestSchema,
} from '@handshake-agent/contracts';

/** Request DTO for POST /admin/auth/login. */
export class AdminLoginDto extends createZodDto(AdminLoginRequestSchema) {}

/** Request DTO for POST /admin/auth/step-up. */
export class AdminStepUpDto extends createZodDto(AdminStepUpRequestSchema) {}
