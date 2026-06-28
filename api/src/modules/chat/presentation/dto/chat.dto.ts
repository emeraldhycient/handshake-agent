import { createZodDto } from 'nestjs-zod';
import { ChatMessageRequestSchema } from '@handshake-agent/contracts';

export class ChatMessageDto extends createZodDto(ChatMessageRequestSchema) {}
