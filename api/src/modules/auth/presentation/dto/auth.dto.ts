import { createZodDto } from 'nestjs-zod';
import {
  LoginRequestSchema,
  LoginVerifyRequestSchema,
  RefreshRequestSchema,
  SignupRequestSchema,
  VerifyEmailRequestSchema,
} from '@handshake-agent/contracts';

export class SignupDto extends createZodDto(SignupRequestSchema) {}
export class VerifyEmailDto extends createZodDto(VerifyEmailRequestSchema) {}
export class LoginDto extends createZodDto(LoginRequestSchema) {}
export class LoginVerifyDto extends createZodDto(LoginVerifyRequestSchema) {}
export class RefreshDto extends createZodDto(RefreshRequestSchema) {}
