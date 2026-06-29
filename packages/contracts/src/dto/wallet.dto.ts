import { z } from "zod";
import {
  SupportedAssetSchema,
  FiatCurrencySchema,
  FiatAmountSchema,
  CryptoAmountSchema,
} from "../common";

export const WalletAssetBalanceSchema = z.object({
  symbol: SupportedAssetSchema,
  displayName: z.string(),
  network: z.string(),
  amount: CryptoAmountSchema,
  decimals: z.number().int().nonnegative(),
  fiatValue: FiatAmountSchema,
});
export type WalletAssetBalance = z.infer<typeof WalletAssetBalanceSchema>;

export const WalletBalancesResponseSchema = z.object({
  fiatCurrency: FiatCurrencySchema,
  totalFiatValue: FiatAmountSchema,
  assets: z.array(WalletAssetBalanceSchema),
});
export type WalletBalancesResponse = z.infer<
  typeof WalletBalancesResponseSchema
>;

export const DepositAddressResponseSchema = z.object({
  asset: SupportedAssetSchema,
  network: z.string(),
  networkLabel: z.string(),
  address: z.string().min(1),
  minDeposit: z.string().optional(),
});
export type DepositAddressResponse = z.infer<
  typeof DepositAddressResponseSchema
>;
