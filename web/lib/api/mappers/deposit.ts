import type { DepositAddressResponse } from "@handshake-agent/contracts"
import type { DepositView } from "@/lib/schemas"

// minDeposit/creditedEta have no backend source yet — kept as labelled placeholders.
const PLACEHOLDER_MIN = "1"
const PLACEHOLDER_ETA = "~1 min"

export function mapDepositAddress(res: DepositAddressResponse): DepositView {
  return {
    kind: "receive",
    asset: res.asset,
    network: res.networkLabel,
    address: res.address,
    minDeposit: res.minDeposit
      ? `${res.minDeposit} ${res.asset}`
      : `${PLACEHOLDER_MIN} ${res.asset}`,
    creditedEta: PLACEHOLDER_ETA,
  }
}
