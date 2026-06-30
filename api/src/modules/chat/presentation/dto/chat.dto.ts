import { createZodDto } from 'nestjs-zod';
import {
  ChatMessageRequestSchema,
  ChatHistoryQuerySchema,
} from '@handshake-agent/contracts';

export class ChatMessageDto extends createZodDto(ChatMessageRequestSchema) {}

export class ChatHistoryQueryDto extends createZodDto(ChatHistoryQuerySchema) {}
