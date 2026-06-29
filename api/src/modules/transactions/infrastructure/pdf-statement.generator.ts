import { Injectable } from '@nestjs/common';
// pdfkit is CommonJS (module.exports = PDFDocument) and esModuleInterop is off,
// so a default import resolves to `.default` (undefined). Use import-equals for
// correct CJS interop under tsc + ts-jest.
// eslint-disable-next-line @typescript-eslint/no-require-imports
import PDFDocument = require('pdfkit');

import type {
  IStatementGenerator,
  StatementFile,
  StatementModel,
} from '../application/ports/statement-generator.port';

/**
 * Renders a StatementModel to a PDF Buffer with pdfkit (built-in Helvetica, no
 * external font files). Deterministic: CreationDate comes from the model's
 * generatedAt (set from CLOCK upstream), never wall-clock.
 */
@Injectable()
export class PdfStatementGenerator implements IStatementGenerator {
  async generate(model: StatementModel): Promise<StatementFile> {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 40,
      info: {
        Title: model.title,
        Producer: 'Handshake Agent',
        CreationDate: new Date(model.generatedAt),
      },
    });

    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    const done = new Promise<Buffer>((resolve) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
    });

    // Header
    doc.fontSize(18).text(model.title, { align: 'left' });
    doc.moveDown(0.3);
    doc.fontSize(10).fillColor('#555555');
    doc.text(`Account: ${model.accountLabel}`);
    doc.text(`Period: ${model.windowLabel}`);
    doc.text(`Generated: ${model.generatedAt}`);
    doc.moveDown(0.6);
    doc.fillColor('#000000');

    // Rows
    if (model.rows.length === 0) {
      doc.fontSize(11).text('No transactions in this period.');
    } else {
      for (const r of model.rows) {
        doc
          .fontSize(10)
          .text(
            `${r.date}   ${r.type.toUpperCase()}   ${r.amount}   [${r.status}]   ${r.reference}`,
          );
      }
    }

    // Footer / truncation notice (no silent caps — surface it).
    doc.moveDown(0.6).fontSize(9).fillColor('#555555');
    if (model.truncated) {
      doc.text(
        `Showing the latest ${model.rows.length} of ${model.totalCount} transactions. Narrow the date range for the rest.`,
      );
    } else {
      doc.text(`${model.totalCount} transaction(s).`);
    }

    doc.end();
    const buffer = await done;
    return { buffer, contentType: 'application/pdf', filename: model.filename };
  }
}
