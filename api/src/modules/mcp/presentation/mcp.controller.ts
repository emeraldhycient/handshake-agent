/**
 * McpController — the stateless streamable-HTTP MCP endpoint (Wave C).
 *
 * POST /mcp
 *   Authenticated ONLY by PatAuthGuard (`Bearer hsk_pat_…`) — session JWTs are
 *   rejected before any lookup (§3.5); PATs conversely never work on the
 *   JwtAuthGuard surfaces. Each request drives a FRESH per-principal MCP
 *   Server over a stateless StreamableHTTPServerTransport (no session ids,
 *   plain JSON responses) — horizontal scaling needs no sticky routing.
 *
 * GET/DELETE /mcp
 *   405 JSON-RPC error: stateless mode has no SSE notification stream and no
 *   session to terminate.
 *
 * The app-wide throttler guard (APP_GUARD) stays active here — deliberately
 * no @SkipThrottle. Tool-level scope enforcement lives in the application
 * layer (McpToolsService); §3.1 execution stays on web/WhatsApp.
 */

import {
  Controller,
  Delete,
  Get,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Request, Response } from 'express';

import {
  CurrentPat,
  PatAuthGuard,
  type PatPrincipal,
} from '../../auth/presentation/pat-auth.guard';
import { McpToolsService } from '../application/mcp-tools.service';

const METHOD_NOT_ALLOWED_BODY = {
  jsonrpc: '2.0' as const,
  error: { code: -32000, message: 'Method not allowed.' },
  id: null,
};

@Controller('mcp')
@UseGuards(PatAuthGuard)
export class McpController {
  constructor(private readonly toolsService: McpToolsService) {}

  @Post()
  async handle(
    @CurrentPat() pat: PatPrincipal,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    // Fresh server + transport per request (stateless mode): tools and data
    // are scoped to THIS PAT's user; nothing is shared across requests.
    const server = this.toolsService.buildServer(pat);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    // Body already parsed by the global JSON body parser — pass it through.
    await transport.handleRequest(req, res, req.body);
  }

  @Get()
  rejectGet(@Res() res: Response): void {
    res.status(405).json(METHOD_NOT_ALLOWED_BODY);
  }

  @Delete()
  rejectDelete(@Res() res: Response): void {
    res.status(405).json(METHOD_NOT_ALLOWED_BODY);
  }
}
