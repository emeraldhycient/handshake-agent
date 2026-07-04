import {
  AdminCatalogAssetSchema,
  AdminCatalogFiatSchema,
  AdminCatalogViewSchema,
} from "./catalog.dto";

describe("AdminCatalogAssetSchema", () => {
  const asset = {
    symbol: "USDT",
    displayName: "Tether USD",
    kind: "crypto",
    decimals: 6,
    networks: ["TRON", "Ethereum"],
    live: true,
    logoUrl: null,
  };

  it("parses a well-formed live asset row", () => {
    expect(AdminCatalogAssetSchema.parse(asset)).toEqual(asset);
  });

  it("accepts a provider logo URL string and null (the public image, or absent)", () => {
    const url = "https://res.cloudinary.com/blockradar/image/upload/trx.png";
    expect(AdminCatalogAssetSchema.parse({ ...asset, logoUrl: url }).logoUrl).toBe(
      url,
    );
    expect(
      AdminCatalogAssetSchema.parse({ ...asset, logoUrl: null }).logoUrl,
    ).toBeNull();
  });

  it("rejects a non-string, non-null logoUrl", () => {
    expect(() =>
      AdminCatalogAssetSchema.parse({ ...asset, logoUrl: 42 }),
    ).toThrow();
  });

  it("parses a disabled (paused) asset row", () => {
    expect(
      AdminCatalogAssetSchema.parse({ ...asset, symbol: "BTC", live: false }),
    ).toMatchObject({ symbol: "BTC", live: false });
  });

  it("allows an asset with no networks", () => {
    expect(
      AdminCatalogAssetSchema.parse({ ...asset, networks: [] }).networks,
    ).toEqual([]);
  });

  it("rejects a non-integer decimals value", () => {
    expect(() =>
      AdminCatalogAssetSchema.parse({ ...asset, decimals: 6.5 }),
    ).toThrow();
  });

  it("rejects a negative decimals value", () => {
    expect(() =>
      AdminCatalogAssetSchema.parse({ ...asset, decimals: -1 }),
    ).toThrow();
  });

  it("requires live to be a boolean", () => {
    expect(() =>
      AdminCatalogAssetSchema.parse({ ...asset, live: "true" }),
    ).toThrow();
  });

  it("does NOT model any provider / contract / wallet secret field", () => {
    // logoUrl is a PUBLIC asset image (not a secret); provider ids, contract
    // addresses, and master-wallet ids are never surfaced.
    expect(Object.keys(AdminCatalogAssetSchema.shape)).toEqual([
      "symbol",
      "displayName",
      "kind",
      "decimals",
      "networks",
      "live",
      "logoUrl",
    ]);
  });
});

describe("AdminCatalogFiatSchema", () => {
  const fiat = {
    code: "NGN",
    symbol: "₦",
    displayName: "Nigerian Naira",
    decimals: 2,
    live: true,
    custom: false,
  };

  it("parses a well-formed live fiat row", () => {
    expect(AdminCatalogFiatSchema.parse(fiat)).toEqual(fiat);
  });

  it("parses a disabled (off) fiat row", () => {
    expect(
      AdminCatalogFiatSchema.parse({ ...fiat, code: "RWF", live: false }),
    ).toMatchObject({ code: "RWF", live: false });
  });

  it("rejects a negative rounding (decimals) value", () => {
    expect(() =>
      AdminCatalogFiatSchema.parse({ ...fiat, decimals: -1 }),
    ).toThrow();
  });

  it("does NOT model any secret field", () => {
    expect(Object.keys(AdminCatalogFiatSchema.shape)).toEqual([
      "code",
      "symbol",
      "displayName",
      "decimals",
      "live",
      "custom",
    ]);
  });
});

describe("AdminCatalogViewSchema", () => {
  it("parses a full catalog view with assets and fiats", () => {
    const view = {
      assets: [
        {
          symbol: "USDT",
          displayName: "Tether USD",
          kind: "crypto",
          decimals: 6,
          networks: ["TRON"],
          live: true,
          logoUrl: null,
        },
      ],
      fiats: [
        {
          code: "NGN",
          symbol: "₦",
          displayName: "Nigerian Naira",
          decimals: 2,
          live: true,
          custom: false,
        },
      ],
    };
    expect(AdminCatalogViewSchema.parse(view)).toEqual(view);
  });

  it("parses an empty catalog view", () => {
    expect(AdminCatalogViewSchema.parse({ assets: [], fiats: [] })).toEqual({
      assets: [],
      fiats: [],
    });
  });

  it("rejects a view missing the fiats array", () => {
    expect(() => AdminCatalogViewSchema.parse({ assets: [] })).toThrow();
  });
});
