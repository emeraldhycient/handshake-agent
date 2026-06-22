import { Test, TestingModule } from '@nestjs/testing';

import {
  WHATSAPP_SENDER,
  type IWhatsAppSender,
} from './ports/whatsapp-sender.port';
import {
  INBOUND_HANDLER,
  type InboundMessage,
} from './ports/inbound-handler.port';
import { EchoInboundHandler } from './echo-inbound.handler';

describe('EchoInboundHandler', () => {
  let handler: EchoInboundHandler;
  let senderMock: jest.Mocked<IWhatsAppSender>;

  beforeEach(async () => {
    senderMock = {
      sendText: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'wamid.test' }),
      sendTemplate: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        { provide: INBOUND_HANDLER, useClass: EchoInboundHandler },
        { provide: WHATSAPP_SENDER, useValue: senderMock },
      ],
    }).compile();

    handler = module.get<EchoInboundHandler>(INBOUND_HANDLER);
  });

  describe('handleInbound', () => {
    it('calls sender.sendText exactly once with fromAddress and echoed text', async () => {
      const msg: InboundMessage = {
        externalMessageId: 'wamid.abc123',
        fromAddress: '2348001234567',
        phoneNumberId: 'ph123',
        waName: 'Alice',
        text: 'Hello world',
        timestamp: '1700000000',
        channel: 'whatsapp',
      };

      await handler.handleInbound(msg);

      expect(senderMock.sendText).toHaveBeenCalledTimes(1);
      expect(senderMock.sendText).toHaveBeenCalledWith(
        msg.fromAddress,
        `You said: ${msg.text}`,
      );
    });

    it('echoes the correct text when message text contains special characters', async () => {
      const msg: InboundMessage = {
        externalMessageId: 'wamid.xyz',
        fromAddress: '2348009876543',
        phoneNumberId: 'ph456',
        waName: undefined,
        text: 'Hello "World" & <more>',
        timestamp: '1700000001',
        channel: 'whatsapp',
      };

      await handler.handleInbound(msg);

      expect(senderMock.sendText).toHaveBeenCalledWith(
        msg.fromAddress,
        `You said: ${msg.text}`,
      );
    });
  });
});
