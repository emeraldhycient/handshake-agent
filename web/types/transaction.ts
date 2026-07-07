import type { ReactNode } from "react"
import type { TransactionStatusResponse } from "@handshake-agent/contracts"

export interface CopyButtonProps {
  value: string
  /** Used in the aria-label ("Copy <label>" / "<label> copied"). */
  label: string
}

export interface ExplorerLinkProps {
  href: string
}

export interface DetailRowProps {
  label: string
  value: ReactNode
  mono?: boolean
  /** When present, a copy button copies this value. */
  copyValue?: string
  /** When present, an explorer link is rendered alongside the value. */
  explorerHref?: string
}

export interface TransactionDetailBodyProps {
  data: TransactionStatusResponse
}
