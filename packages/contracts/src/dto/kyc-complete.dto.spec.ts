import { KycSubmitRequestSchema } from './kyc-complete.dto';

describe('KycSubmitRequestSchema', () => {
  it('parses a valid submit request with optional fields omitted', () => {
    const parsed = KycSubmitRequestSchema.parse({
      firstName: 'A',
      lastName: 'B',
      pin: '1234',
    });
    expect(parsed.firstName).toBe('A');
    expect(parsed.lastName).toBe('B');
    expect(parsed.pin).toBe('1234');
    expect(parsed.nin).toBeUndefined();
    expect(parsed.bvn).toBeUndefined();
    expect(parsed.dateOfBirth).toBeUndefined();
  });

  it('parses a valid submit request with all optional fields provided', () => {
    const parsed = KycSubmitRequestSchema.parse({
      firstName: 'Chidi',
      lastName: 'Okeke',
      nin: '11223344556',
      bvn: '22334455667',
      dateOfBirth: '1990-01-15',
      pin: '5678',
    });
    expect(parsed.nin).toBe('11223344556');
    expect(parsed.bvn).toBe('22334455667');
    expect(parsed.dateOfBirth).toBe('1990-01-15');
  });

  it('throws when firstName is missing', () => {
    expect(() =>
      KycSubmitRequestSchema.parse({ lastName: 'B', pin: '1234' }),
    ).toThrow();
  });

  it('throws when lastName is missing', () => {
    expect(() =>
      KycSubmitRequestSchema.parse({ firstName: 'A', pin: '1234' }),
    ).toThrow();
  });

  it('throws when pin is missing', () => {
    expect(() =>
      KycSubmitRequestSchema.parse({ firstName: 'A', lastName: 'B' }),
    ).toThrow();
  });

  it('throws when firstName is an empty string', () => {
    expect(() =>
      KycSubmitRequestSchema.parse({ firstName: '', lastName: 'B', pin: '1234' }),
    ).toThrow();
  });

  it('throws when pin is an empty string', () => {
    expect(() =>
      KycSubmitRequestSchema.parse({ firstName: 'A', lastName: 'B', pin: '' }),
    ).toThrow();
  });
});
