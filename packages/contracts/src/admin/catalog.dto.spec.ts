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
  };

  it("parses a well-formed live asset row", () => {
    expect(AdminCatalogAssetSchema.parse(asset)).toEqual(asset);
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
    expect(Object.keys(AdminCatalogAssetSchema.shape)).toEqual([
      "symbol",
      "displayName",
      "kind",
      "decimals",
      "networks",
      "live",
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
        },
      ],
      fiats: [
        {
          code: "NGN",
          symbol: "₦",
          displayName: "Nigerian Naira",
          decimals: 2,
          live: true,
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
