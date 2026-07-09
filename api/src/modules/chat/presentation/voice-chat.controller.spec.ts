/**
 * HTTP-level tests for VoiceChatController (POST /chat/voice).
 *
 * Uses supertest against a compiled testing module (real FileInterceptor, real
 * multer) so the stream-time fileSize ceiling is exercised for real: an
 * oversize multipart body must be aborted mid-stream with 413 — never fully
 * buffered into RAM and never reach the handler. The request-time config gate
 * (the tighter, admin-tunable check), mime-type gate, and happy path are
 * covered through the same HTTP surface.
 *
 * Run with: pnpm --filter @handshake-agent/api test -- --testPathPattern=voice-chat.controller
 */

import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';

import { VoiceChatController } from './voice-chat.controller';
import { JwtAuthGuard } from '../../auth/presentation/jwt-auth.guard';
import { WebChatService } from '../application/web-chat.service';
import { TRANSCRIPTION_PORT } from '../../media/application/ports/transcription.port';
import configuration from '../../../core/config/configuration';

import type { ExecutionContext, INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';

// supertest is a CommonJS module
// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest') as typeof import('supertest');

/** The static JSON-default ceiling the multer interceptor is pinned to. */
const STATIC_CEILING_BYTES = configuration().media.voice.maxUploadBytes;

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

const mockChatService = { handleMessage: jest.fn() };
const mockTranscription = { transcribe: jest.fn() };

/** Per-test mutable media config returned by the mocked ConfigService. */
let mediaConfig: {
  voice: { maxUploadBytes: number; allowedMimeTypes: string[] };
};

const mockConfigService = {
  get: (key: string) => (key === 'media' ? mediaConfig : undefined),
};

const TEST_USER = {
  userId: 'user-uuid',
  sessionId: 'sess-uuid',
  deviceId: null,
};

// ---------------------------------------------------------------------------
// App setup
// ---------------------------------------------------------------------------

describe('VoiceChatController (POST /chat/voice)', () => {
  let app: INestApplication;
  let httpServer: Server;

  beforeEach(async () => {
    jest.clearAllMocks();
    mediaConfig = {
      voice: {
        maxUploadBytes: STATIC_CEILING_BYTES,
        allowedMimeTypes: ['audio/webm', 'audio/mp4'],
      },
    };

    const module = await Test.createTestingModule({
      controllers: [VoiceChatController],
      providers: [
        { provide: WebChatService, useValue: mockChatService },
        { provide: TRANSCRIPTION_PORT, useValue: mockTranscription },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    })
      // JwtAuthGuard has its own dependencies (TokenService, session repo).
      // Override it to always allow and attach the user — guard behaviour is
      // tested separately.
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (ctx: ExecutionContext) => {
          ctx.switchToHttp().getRequest<{ user: unknown }>().user = TEST_USER;
          return true;
        },
      })
      .compile();

    app = module.createNestApplication();
    await app.init();
    httpServer = app.getHttpServer() as Server;
  });

  afterEach(async () => {
    await app.close();
  });

  it('aborts an oversize upload mid-stream with 413 (multer fileSize ceiling)', async () => {
    // One byte over the static ceiling: multer must reject at stream time
    // (LIMIT_FILE_SIZE → PayloadTooLargeException), NOT buffer the whole body
    // and rely on the in-handler size check.
    await request(httpServer)
      .post('/chat/voice')
      .attach('audio', Buffer.alloc(STATIC_CEILING_BYTES + 1), {
        filename: 'note.webm',
        contentType: 'audio/webm',
      })
      .expect(413);

    expect(mockTranscription.transcribe).not.toHaveBeenCalled();
    expect(mockChatService.handleMessage).not.toHaveBeenCalled();
  });

  it('still enforces the tighter request-time configured limit with 400', async () => {
    // The admin-tunable (layered-config) limit can be LOWER than the static
    // multer ceiling — a file passing the stream gate must still be rejected
    // by the per-request check.
    mediaConfig.voice.maxUploadBytes = 16;

    await request(httpServer)
      .post('/chat/voice')
      .attach('audio', Buffer.alloc(1024), {
        filename: 'note.webm',
        contentType: 'audio/webm',
      })
      .expect(400);

    expect(mockTranscription.transcribe).not.toHaveBeenCalled();
  });

  it('returns 400 when the audio file is missing', async () => {
    await request(httpServer).post('/chat/voice').expect(400);
  });

  it('returns 400 for an unsupported mime type', async () => {
    await request(httpServer)
      .post('/chat/voice')
      .attach('audio', Buffer.alloc(64), {
        filename: 'note.txt',
        contentType: 'text/plain',
      })
      .expect(400);

    expect(mockTranscription.transcribe).not.toHaveBeenCalled();
  });

  it('transcribes and forwards the trimmed text to the chat service (200)', async () => {
    mockTranscription.transcribe.mockResolvedValue({ text: '  buy usdt  ' });
    mockChatService.handleMessage.mockResolvedValue({
      conversationId: 'conv-1',
      messages: [],
    });

    const res = await request(httpServer)
      .post('/chat/voice')
      .attach('audio', Buffer.alloc(64), {
        filename: 'note.webm',
        contentType: 'audio/webm',
      })
      .expect(200);

    expect(mockChatService.handleMessage).toHaveBeenCalledWith({
      userId: TEST_USER.userId,
      text: 'buy usdt',
    });
    expect(res.body).toMatchObject({
      conversationId: 'conv-1',
      transcript: 'buy usdt',
    });
  });

  it('feeds the fallback phrase when the transcript is blank', async () => {
    mockTranscription.transcribe.mockResolvedValue({ text: '   ' });
    mockChatService.handleMessage.mockResolvedValue({
      conversationId: 'conv-1',
      messages: [],
    });

    const res = await request(httpServer)
      .post('/chat/voice')
      .attach('audio', Buffer.alloc(64), {
        filename: 'note.webm',
        contentType: 'audio/webm',
      })
      .expect(200);

    expect(mockChatService.handleMessage).toHaveBeenCalledWith({
      userId: TEST_USER.userId,
      text: '(unintelligible audio)',
    });
    expect(res.body).toMatchObject({ transcript: '' });
  });
});
