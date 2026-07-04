import {
  AdminDiscoveredAssetSchema,
  AdminDiscoveredAssetListResponseSchema,
  AdminAssetsSyncResponseSchema,
} from "./assets.dto";

describe("admin assets discovery DTOs", () => {
  const asset = {
    symbol: "USDC",
    displayName: "USD Coin",
    decimals: 6,
    networks: ["TRON"],
    contractAddress: "TXusdcContract",
    blockradarAssetId: "usdc-id",
    logoUrl: null,
    enabled: true,
    inStaticCatalog: false,
  };

  it("parses a well-formed discovered asset (native asset → null contract)", () => {
    expect(AdminDiscoveredAssetSchema.parse(asset)).toEqual(asset);
    const native = { ...asset, symbol: "TRX", contractAddress: null };
    expect(AdminDiscoveredAssetSchema.parse(native).contractAddress).toBeNull();
  });

  it("rejects a discovered asset missing the inStaticCatalog flag", () => {
    const { inStaticCatalog: _omit, ...bad } = asset;
    expect(() => AdminDiscoveredAssetSchema.parse(bad)).toThrow();
  });

  it("parses the list + sync responses", () => {
    expect(
      AdminDiscoveredAssetListResponseSchema.parse({ items: [asset] }).items
    ).toHaveLength(1);
    expect(
      AdminAssetsSyncResponseSchema.parse({ discoveredCount: 3, newCount: 1 })
    ).toEqual({ discoveredCount: 3, newCount: 1 });
  });
});
