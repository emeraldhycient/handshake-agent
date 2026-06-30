import {
  KycCompleteRequestSchema,
  KycSubmitRequestSchema,
  SetPinRequestSchema,
  TransactionPinSchema,
} from "./kyc-complete.dto";

describe("TransactionPinSchema", () => {
  it("accepts a 4-digit numeric PIN", () => {
    expect(TransactionPinSchema.parse("1357")).toBe("1357");
  });

  it("accepts a 6-digit numeric PIN", () => {
    expect(TransactionPinSchema.parse("135790")).toBe("135790");
  });

  it("rejects a 1-digit PIN", () => {
    expect(() => TransactionPinSchema.parse("1")).toThrow();
  });

  it("rejects a 3-digit PIN (below the floor)", () => {
    expect(() => TransactionPinSchema.parse("135")).toThrow();
  });

  it("rejects a 7-digit PIN (above the ceiling)", () => {
    expect(() => TransactionPinSchema.parse("1357913")).toThrow();
  });

  it("rejects a non-numeric PIN", () => {
    expect(() => TransactionPinSchema.parse("12a4")).toThrow();
    expect(() => TransactionPinSchema.parse("abcd")).toThrow();
  });

  it("rejects an all-same-digit PIN (0000, 1111)", () => {
    expect(() => TransactionPinSchema.parse("0000")).toThrow();
    expect(() => TransactionPinSchema.parse("1111")).toThrow();
    expect(() => TransactionPinSchema.parse("999999")).toThrow();
  });

  it("rejects a trivial ascending sequence (1234, 123456)", () => {
    expect(() => TransactionPinSchema.parse("1234")).toThrow();
    expect(() => TransactionPinSchema.parse("123456")).toThrow();
  });

  it("rejects a trivial descending sequence (4321, 654321)", () => {
    expect(() => TransactionPinSchema.parse("4321")).toThrow();
    expect(() => TransactionPinSchema.parse("654321")).toThrow();
  });

  it("rejects the empty string", () => {
    expect(() => TransactionPinSchema.parse("")).toThrow();
  });
});

describe("KycSubmitRequestSchema", () => {
  it("parses a valid submit request with one identifier (nin) and a strong PIN", () => {
    const parsed = KycSubmitRequestSchema.parse({
      firstName: "A",
      lastName: "B",
      nin: "11223344556",
      pin: "1357",
    });
    expect(parsed.firstName).toBe("A");
    expect(parsed.lastName).toBe("B");
    expect(parsed.pin).toBe("1357");
    expect(parsed.nin).toBe("11223344556");
    expect(parsed.bvn).toBeUndefined();
    expect(parsed.dateOfBirth).toBeUndefined();
  });

  it("parses a valid submit request with all optional fields provided", () => {
    const parsed = KycSubmitRequestSchema.parse({
      firstName: "Chidi",
      lastName: "Okeke",
      nin: "11223344556",
      bvn: "22334455667",
      dateOfBirth: "1990-01-15",
      pin: "5681",
    });
    expect(parsed.nin).toBe("11223344556");
    expect(parsed.bvn).toBe("22334455667");
    expect(parsed.dateOfBirth).toBe("1990-01-15");
  });

  it("throws when neither nin nor bvn is provided (at-least-one rule)", () => {
    expect(() =>
      KycSubmitRequestSchema.parse({
        firstName: "A",
        lastName: "B",
        pin: "1357",
      }),
    ).toThrow();
  });

  it("throws when nin is not exactly 11 numeric digits", () => {
    expect(() =>
      KycSubmitRequestSchema.parse({
        firstName: "A",
        lastName: "B",
        nin: "5",
        pin: "1357",
      }),
    ).toThrow();
    expect(() =>
      KycSubmitRequestSchema.parse({
        firstName: "A",
        lastName: "B",
        nin: "abcdefghijk",
        pin: "1357",
      }),
    ).toThrow();
  });

  it("throws when bvn is not exactly 11 numeric digits", () => {
    expect(() =>
      KycSubmitRequestSchema.parse({
        firstName: "A",
        lastName: "B",
        bvn: "123",
        pin: "1357",
      }),
    ).toThrow();
  });

  it("throws when firstName is missing", () => {
    expect(() =>
      KycSubmitRequestSchema.parse({
        lastName: "B",
        nin: "11223344556",
        pin: "1357",
      }),
    ).toThrow();
  });

  it("throws when lastName is missing", () => {
    expect(() =>
      KycSubmitRequestSchema.parse({
        firstName: "A",
        nin: "11223344556",
        pin: "1357",
      }),
    ).toThrow();
  });

  it("throws when pin is missing", () => {
    expect(() =>
      KycSubmitRequestSchema.parse({
        firstName: "A",
        lastName: "B",
        nin: "11223344556",
      }),
    ).toThrow();
  });

  it("throws when firstName is an empty string", () => {
    expect(() =>
      KycSubmitRequestSchema.parse({
        firstName: "",
        lastName: "B",
        nin: "11223344556",
        pin: "1357",
      }),
    ).toThrow();
  });

  it("throws when pin is a weak 1-digit string", () => {
    expect(() =>
      KycSubmitRequestSchema.parse({
        firstName: "A",
        lastName: "B",
        nin: "11223344556",
        pin: "1",
      }),
    ).toThrow();
  });

  it("throws when pin is a trivial sequence", () => {
    expect(() =>
      KycSubmitRequestSchema.parse({
        firstName: "A",
        lastName: "B",
        nin: "11223344556",
        pin: "1234",
      }),
    ).toThrow();
  });
});

describe("KycCompleteRequestSchema", () => {
  it("parses a valid complete request with one identifier and a strong PIN", () => {
    const parsed = KycCompleteRequestSchema.parse({
      token: "handoff-token",
      firstName: "A",
      lastName: "B",
      bvn: "22334455667",
      pin: "1357",
    });
    expect(parsed.token).toBe("handoff-token");
    expect(parsed.bvn).toBe("22334455667");
    expect(parsed.pin).toBe("1357");
  });

  it("throws when neither nin nor bvn is provided", () => {
    expect(() =>
      KycCompleteRequestSchema.parse({
        token: "handoff-token",
        firstName: "A",
        lastName: "B",
        pin: "1357",
      }),
    ).toThrow();
  });

  it("throws when the token is missing", () => {
    expect(() =>
      KycCompleteRequestSchema.parse({
        firstName: "A",
        lastName: "B",
        nin: "11223344556",
        pin: "1357",
      }),
    ).toThrow();
  });

  it("throws when nin is malformed", () => {
    expect(() =>
      KycCompleteRequestSchema.parse({
        token: "handoff-token",
        firstName: "A",
        lastName: "B",
        nin: "12",
        pin: "1357",
      }),
    ).toThrow();
  });

  it("throws when the pin is weak", () => {
    expect(() =>
      KycCompleteRequestSchema.parse({
        token: "handoff-token",
        firstName: "A",
        lastName: "B",
        nin: "11223344556",
        pin: "0000",
      }),
    ).toThrow();
  });
});

describe("SetPinRequestSchema", () => {
  it("accepts a strong PIN with no identity fields", () => {
    const parsed = SetPinRequestSchema.parse({ pin: "1357" });
    expect(parsed.pin).toBe("1357");
  });

  it("rejects a weak PIN", () => {
    expect(() => SetPinRequestSchema.parse({ pin: "1" })).toThrow();
    expect(() => SetPinRequestSchema.parse({ pin: "1111" })).toThrow();
    expect(() => SetPinRequestSchema.parse({ pin: "1234" })).toThrow();
  });

  it("rejects a missing PIN", () => {
    expect(() => SetPinRequestSchema.parse({})).toThrow();
  });
});
