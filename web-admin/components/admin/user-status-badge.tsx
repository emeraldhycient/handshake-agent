"use client"

/**
 * UserStatusBadge / KycStatusBadge — canonical tokenised mappings for an END
 * user's account status and KYC status. One mapping each, reused by the users
 * table and the detail drawer (root §13.1 / §13.2). Colour is never the sole
 * signal — the label carries it.
 */
import { Badge } from "@/components/ui/badge"
import type {
  KycStatusBadgeProps,
  UserStatusBadgeProps,
} from "@/types/components"

type Variant = React.ComponentProps<typeof Badge>["variant"]

const STATUS_VARIANT: Record<UserStatusBadgeProps["status"], Variant> = {
  provisional: "secondary",
  active: "default",
  suspended: "destructive",
  deactivated: "outline",
}

const KYC_VARIANT: Record<KycStatusBadgeProps["status"], Variant> = {
  not_started: "outline",
  pending: "secondary",
  pending_review: "secondary",
  needs_info: "secondary",
  verified: "default",
  rejected: "destructive",
  expired: "outline",
}

export function UserStatusBadge({ status }: UserStatusBadgeProps) {
  return <Badge variant={STATUS_VARIANT[status]}>{status}</Badge>
}

export function KycStatusBadge({ status }: KycStatusBadgeProps) {
  return (
    <Badge variant={KYC_VARIANT[status]}>{status.replace(/_/g, " ")}</Badge>
  )
}
