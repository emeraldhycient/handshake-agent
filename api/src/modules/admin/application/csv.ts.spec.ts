import { buildCsv } from './csv';

describe('buildCsv', () => {
  it('emits a header row followed by one row per record, CRLF-separated', () => {
    const csv = buildCsv(
      ['id', 'email'],
      [
        ['u1', 'ada@example.com'],
        ['u2', 'ben@example.com'],
      ],
    );
    expect(csv).toBe(
      'id,email\r\nu1,ada@example.com\r\nu2,ben@example.com\r\n',
    );
  });

  it('emits only the header row (terminated) when there are no data rows', () => {
    expect(buildCsv(['id', 'email'], [])).toBe('id,email\r\n');
  });

  it('quotes a field containing a comma (RFC 4180)', () => {
    expect(buildCsv(['name'], [['Doe, Jane']])).toBe('name\r\n"Doe, Jane"\r\n');
  });

  it('quotes a field containing a double-quote and doubles the quote', () => {
    expect(buildCsv(['note'], [['say "hi"']])).toBe('note\r\n"say ""hi"""\r\n');
  });

  it('quotes a field containing a CR and/or LF', () => {
    expect(buildCsv(['note'], [['line1\nline2']])).toBe(
      'note\r\n"line1\nline2"\r\n',
    );
    expect(buildCsv(['note'], [['line1\r\nline2']])).toBe(
      'note\r\n"line1\r\nline2"\r\n',
    );
  });

  it('renders null and undefined cells as an empty field (never the string "null")', () => {
    expect(buildCsv(['a', 'b'], [[null, undefined]])).toBe('a,b\r\n,\r\n');
  });

  it('renders number and boolean cells via String()', () => {
    expect(buildCsv(['n', 'flag'], [[42, true]])).toBe('n,flag\r\n42,true\r\n');
  });

  it('quotes header cells that themselves need escaping', () => {
    expect(buildCsv(['a,b', 'c'], [])).toBe('"a,b",c\r\n');
  });

  it('does not quote a plain field', () => {
    expect(buildCsv(['x'], [['plain']])).toBe('x\r\nplain\r\n');
  });
});
