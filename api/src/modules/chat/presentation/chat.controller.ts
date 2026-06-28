import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import type { WebChatResponse } from '@handshake-agent/contracts';

import {
  JwtAuthGuard,
  type AuthenticatedUser,
} from '../../auth/presentation/jwt-auth.guard';
import { CurrentUser } from '../../auth/presentation/current-user.decorator';
import { WebChatService } from '../application/web-chat.service';
import { ChatMessageDto } from './dto/chat.dto';

@Controller('chat')
@UseGuards(JwtAuthGuard)
export class ChatController {
  constructor(private readonly chatService: WebChatService) {}

  @Post('messages')
  @HttpCode(200)
  async sendMessage(
    @Body() body: ChatMessageDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<WebChatResponse> {
    return this.chatService.handleMessage({
      userId: user.userId,
      text: body.text,
      beneficiaryId: body.beneficiaryId,
    });
  }
}
