/**
 * HTTP-level tests for McpController (POST/GET/DELETE /mcp) — Wave C.
 *
 * Uses supertest against a compiled testing module with the REAL PatAuthGuard
 * (PAT repository faked) so the surface's auth semantics are exercised for
 * real: only `Bearer hsk_pat_…` tokens pass; session JWTs and anonymous
 * requests are 401 before any MCP handling. The McpToolsService is faked with
 * a minimal real MCP Server so the stateless streamable-HTTP round-trip
 * (initialize / tools/list / tools/call) runs over the actual transport.
 */

import { createHash } from 'node:crypto';

import { Test } from '@nestjs/testing';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { PAT_REPOSITORY } from '../../auth/application/ports/pat.repository.port';
import type { IPatRepository } from '../../auth/application/ports/pat.repository.port';
import { PatAuthGuard } from '../../auth/presentation/pat-auth.guard';
import { McpToolsService } from '../application/mcp-tools.service';
import type { McpPrincipal } from '../application/mcp-tool-types';
import { McpController } from './mcp.controller';

import type { INestApplication } from '@nestjs/common';
import type { Server as HttpServer } from 'node:http';

// supertest is a CommonJS module
// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest') as typeof import('supertest');

const RAW_PAT = `hsk_pat_${'ab'.repeat(32)}`;
const RAW_PAT_HASH = createHash('sha256').update(RAW_PAT, 'utf8').digest('hex');
const MCP_ACCEPT = 'application/json, text/event-stream';

const patRepo: Pick<IPatRepository, 'findActiveByTokenHash' | 'touchLastUsed'> =
  {
    findActiveByTokenHash: jest.fn((hash: string) =>
      Promise.resolve(
        hash === RAW_PAT_HASH
          ? { patId: 'pat-1', userId: 'user-1', scopes: ['read'] }
          : null,
      ),
    ),
    touchLastUsed: jest.fn().mockResolvedValue(undefined),
  };

/** Records the principal each request built a server for. */
const seenPrincipals: McpPrincipal[] = [];

function buildEchoServer(principal: McpPrincipal): Server {
  seenPrincipals.push(principal);
  const server = new Server(
    { name: 'handshake-agent-test', version: '0.0.1' },
    { capabilities: { tools: {} } },
  );
  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: [
      {
        name: 'echo_principal',
        description: 'echo',
        inputSchema: { type: 'object' as const },
      },
    ],
  }));
  server.setRequestHandler(
    CallToolRequestSchema,
    (): CallToolResult => ({
      content: [{ type: 'text', text: JSON.stringify(principal) }],
    }),
  );
  return server;
}

const fakeToolsService = {
  buildServer: jest.fn((principal: McpPrincipal) => buildEchoServer(principal)),
};

describe('McpController (/mcp)', () => {
  let app: INestApplication;
  let httpServer: HttpServer;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [McpController],
      providers: [
        PatAuthGuard,
        { provide: PAT_REPOSITORY, useValue: patRepo },
        { provide: McpToolsService, useValue: fakeToolsService },
      ],
    }).compile();

    app = module.createNestApplication();
    await app.init();
    httpServer = app.getHttpServer() as HttpServer;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    seenPrincipals.length = 0;
    jest.clearAllMocks();
  });

  const initializeBody = {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'spec', version: '0' },
    },
  };

  it('401s an anonymous POST before any MCP handling', async () => {
    await request(httpServer).post('/mcp').send(initializeBody).expect(401);
    expect(fakeToolsService.buildServer).not.toHaveBeenCalled();
  });

  it('401s a session-JWT-shaped bearer (PATs only on this surface, §3.5)', async () => {
    await request(httpServer)
      .post('/mcp')
      .set('Authorization', 'Bearer eyJhbGciOiJIUzI1NiJ9.e30.sig')
      .send(initializeBody)
      .expect(401);
    expect(patRepo.findActiveByTokenHash).not.toHaveBeenCalled();
    expect(fakeToolsService.buildServer).not.toHaveBeenCalled();
  });

  it('completes a stateless initialize round-trip for a valid PAT', async () => {
    const res = await request(httpServer)
      .post('/mcp')
      .set('Authorization', `Bearer ${RAW_PAT}`)
      .set('Accept', MCP_ACCEPT)
      .send(initializeBody)
      .expect(200);

    const body = res.body as {
      result: { serverInfo: { name: string } };
      id: number;
    };
    expect(body.result.serverInfo.name).toBe('handshake-agent-test');
    expect(body.id).toBe(1);
    // The per-request server is built for the PAT's principal.
    expect(seenPrincipals).toEqual([
      { userId: 'user-1', patId: 'pat-1', scopes: ['read'] },
    ]);
  });

  it('serves tools/list as an independent stateless request', async () => {
    const res = await request(httpServer)
      .post('/mcp')
      .set('Authorization', `Bearer ${RAW_PAT}`)
      .set('Accept', MCP_ACCEPT)
      .send({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
      .expect(200);

    const body = res.body as { result: { tools: Array<{ name: string }> } };
    expect(body.result.tools.map((t) => t.name)).toEqual(['echo_principal']);
  });

  it('routes tools/call through the per-principal server', async () => {
    const res = await request(httpServer)
      .post('/mcp')
      .set('Authorization', `Bearer ${RAW_PAT}`)
      .set('Accept', MCP_ACCEPT)
      .send({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'echo_principal', arguments: {} },
      })
      .expect(200);

    const body = res.body as {
      result: { content: Array<{ text: string }> };
    };
    expect(JSON.parse(body.result.content[0].text)).toMatchObject({
      userId: 'user-1',
      scopes: ['read'],
    });
  });

  it.each(['get', 'delete'] as const)(
    '%s /mcp → 405 JSON-RPC error (stateless mode has no session channel)',
    async (method) => {
      const res = await request(httpServer)
        [method]('/mcp')
        .set('Authorization', `Bearer ${RAW_PAT}`)
        .expect(405);
      expect(res.body).toEqual({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Method not allowed.' },
        id: null,
      });
      expect(fakeToolsService.buildServer).not.toHaveBeenCalled();
    },
  );
});
