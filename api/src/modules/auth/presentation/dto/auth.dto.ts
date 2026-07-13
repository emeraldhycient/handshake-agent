import { createZodDto } from 'nestjs-zod';
import {
  LoginRequestSchema,
  LoginVerifyRequestSchema,
  RefreshRequestSchema,
  SignupRequestSchema,
  SignupVerifyRequestSchema,
  VerifyEmailRequestSchema,
} from '@handshake-agent/contracts';

export class SignupDto extends createZodDto(SignupRequestSchema) {}
export class VerifyEmailDto extends createZodDto(VerifyEmailRequestSchema) {}
export class LoginDto extends createZodDto(LoginRequestSchema) {}
export class LoginVerifyDto extends createZodDto(LoginVerifyRequestSchema) {}
export class RefreshDto extends createZodDto(RefreshRequestSchema) {}
// Reuses LoginRequestSchema — signup/request and login/request share the same
// { email } shape (Task 2.2).
export class SignupOtpRequestDto extends createZodDto(LoginRequestSchema) {}
export class SignupVerifyDto extends createZodDto(SignupVerifyRequestSchema) {}
