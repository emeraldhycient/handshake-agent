import { Body, Controller, Post } from '@nestjs/common';
import type { QuoteBuyOutput } from '@handshake-agent/contracts';

import { QuotesService } from '../application/quotes.service';
import { QuoteBuyDto } from './dto/quote-buy.dto';

@Controller('quotes')
export class QuotesController {
  constructor(private readonly quotesService: QuotesService) {}

  /** Read-only: returns an itemized buy quote. No funds move here. */
  @Post('buy')
  buy(@Body() dto: QuoteBuyDto): Promise<QuoteBuyOutput> {
    return this.quotesService.quoteBuy(dto);
  }
}
