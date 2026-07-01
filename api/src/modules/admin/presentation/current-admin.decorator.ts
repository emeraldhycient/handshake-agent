import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/** The authenticated admin principal, attached to the request by AdminSessionGuard. */
export interface AdminContext {
  adminId: string;
  sessionId: string;
  roleId: string;
  email: string;
}

export const CurrentAdmin = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AdminContext =>
    ctx.switchToHttp().getRequest<{ admin: AdminContext }>().admin,
);
