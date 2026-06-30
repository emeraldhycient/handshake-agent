import { createZodDto } from 'nestjs-zod';
import { ExecuteProposalRequestSchema } from '@handshake-agent/contracts';

export class ExecuteProposalDto extends createZodDto(
  ExecuteProposalRequestSchema,
) {}
