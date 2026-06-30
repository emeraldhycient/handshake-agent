import { createZodDto } from 'nestjs-zod';

import { MetricsRangeQuerySchema } from '@handshake-agent/contracts';

/**
 * Query DTO for the GET /admin/metrics/* routes: optional ISO `from`/`to` date
 * strings. The service defaults to the last 30 days when omitted and clamps the
 * window at 366 days.
 */
export class MetricsRangeQueryDto extends createZodDto(
  MetricsRangeQuerySchema,
) {}
