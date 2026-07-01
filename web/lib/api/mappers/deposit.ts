import type { DepositAddressResponse } from "@handshake-agent/contracts"
import type { DepositView } from "@/lib/schemas"

export function mapDepositAddress(res: DepositAddressResponse): DepositView {
  return {
    kind: "receive",
    asset: res.asset,
    network: res.networkLabel,
    address: res.address,
    // Finding #9: never fabricate a min-deposit / credited-ETA. The previous
    // "1 USDT" / "~1 min" placeholders were invented AND contradicted the chat
    // path's "—" / "~30 min". Surface the real backend value when present;
    // otherwise emit "" so the deposit card hides the chip rather than showing
    // a made-up number on the money path.
    minDeposit: res.minDeposit ? `${res.minDeposit} ${res.asset}` : "",
    creditedEta: "",
  }
}
