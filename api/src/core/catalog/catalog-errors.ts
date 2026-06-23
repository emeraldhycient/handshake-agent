/**
 * Typed errors thrown by AssetRegistry (task X1).
 *
 * Each error class carries the offending identifier so callers can build
 * meaningful user-facing messages or log structured context.
 */

export class UnsupportedAssetError extends Error {
  constructor(symbol: string, detail?: string) {
    super(
      detail
        ? `Unsupported or disabled asset "${symbol}": ${detail}`
        : `Unsupported or disabled asset "${symbol}"`,
    );
    this.name = 'UnsupportedAssetError';
  }
}

export class UnsupportedFiatError extends Error {
  constructor(code: string) {
    super(`Unsupported or disabled fiat currency "${code}"`);
    this.name = 'UnsupportedFiatError';
  }
}

export class UnsupportedNetworkError extends Error {
  constructor(id: string) {
    super(`Unsupported or disabled network "${id}"`);
    this.name = 'UnsupportedNetworkError';
  }
}

export class CapabilityDisabledError extends Error {
  constructor(capability: string) {
    super(`Capability "${capability}" is not enabled`);
    this.name = 'CapabilityDisabledError';
  }
}
