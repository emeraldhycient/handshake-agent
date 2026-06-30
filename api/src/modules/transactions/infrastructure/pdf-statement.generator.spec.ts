import { PdfStatementGenerator } from './pdf-statement.generator';
import type { StatementModel } from '../application/ports/statement-generator.port';

const model: StatementModel = {
  title: 'Transaction Statement',
  accountLabel: 'u***@test.com',
  windowLabel: 'This month',
  generatedAt: '2026-06-29T10:00:00.000Z',
  filename: 'handshake-statement-2026-06-01_2026-06-29.pdf',
  totalCount: 1,
  truncated: false,
  rows: [
    {
      date: '2026-06-10T10:00:00.000Z',
      type: 'buy',
      status: 'completed',
      direction: 'in',
      amount: '+29.97 USDT',
      reference: 'HS-2026-000001',
    },
  ],
};

describe('PdfStatementGenerator', () => {
  it('produces a valid PDF buffer with the right content-type and filename', async () => {
    const gen = new PdfStatementGenerator();
    const file = await gen.generate(model);
    expect(file.contentType).toBe('application/pdf');
    expect(file.filename).toBe(model.filename);
    expect(file.buffer.length).toBeGreaterThan(100);
    expect(file.buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('handles an empty / truncated statement', async () => {
    const gen = new PdfStatementGenerator();
    const file = await gen.generate({
      ...model,
      rows: [],
      totalCount: 150,
      truncated: true,
    });
    expect(file.buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });
});
