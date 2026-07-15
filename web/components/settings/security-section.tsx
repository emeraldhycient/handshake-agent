"use client"

import { useState } from "react"
import type { ProfileSession } from "@handshake-agent/contracts"
import { Skeleton } from "@/components/ui/skeleton"
import { useProfileSessions, useRevokeSession } from "@/lib/query/profile"
import { formatDate } from "@/lib/transaction/format"
import { toErrorMessage } from "@/lib/error-message"
import { parseUserAgent } from "@/lib/settings/user-agent"
import { cn } from "@/lib/utils"
import { useToast } from "@/hooks/use-toast"
import { ChangePinDialog } from "./change-pin-dialog"
import {
  SectionCard,
  SettingRow,
  RowButton,
  DangerButton,
} from "./section-card"
import type { SettingsSectionProps } from "@/types"

export function SecuritySection({ density }: SettingsSectionProps) {
  const sessions = useProfileSessions()
  const revoke = useRevokeSession()
  const { showToast } = useToast()
  const [changingPin, setChangingPin] = useState(false)
  const mobile = density === "mobile"

  async function handleRevoke(session: ProfileSession) {
    try {
      await revoke.mutateAsync(session.id)
      showToast("Session revoked")
    } catch (err) {
      showToast(toErrorMessage(err) ?? "Something went wrong")
    }
  }

  const list = sessions.data?.sessions ?? []
  const count = `${list.length} active`

  return (
    <SectionCard label="Security" density={density}>
      <SettingRow
        first
        density={density}
        icon={<LockIcon />}
        title="Transaction PIN"
        subtitle="Required for every money movement"
        trailing={
          <RowButton onClick={() => setChangingPin(true)}>Change</RowButton>
        }
      />

      <div
        className={cn(
          "flex items-center justify-between border-t border-settings-hairline",
          mobile ? "px-[15px] pt-[13px] pb-[7px]" : "px-[18px] pt-[14px] pb-2"
        )}
      >
        <span
          className={cn(
            "font-bold tracking-[0.04em] text-settings-faint uppercase",
            mobile ? "text-[11.5px]" : "text-[12px]"
          )}
        >
          Active sessions
        </span>
        <span
          className={cn(
            "text-settings-soft",
            mobile ? "text-[12px]" : "text-[12.5px]"
          )}
        >
          {count}
        </span>
      </div>

      {sessions.isLoading ? (
        <div className="flex flex-col gap-2 px-[18px] py-3">
          <Skeleton className="h-10 w-full" />
        </div>
      ) : sessions.isError ? (
        <p className="px-[18px] py-3 text-[12.5px] text-danger" role="alert">
          Could not load your sessions.
        </p>
      ) : (
        list.map((session) => (
          <SessionRow
            key={session.id}
            session={session}
            density={density}
            onRevoke={handleRevoke}
          />
        ))
      )}
      <div className={mobile ? "h-[7px]" : "h-2"} />

      <ChangePinDialog open={changingPin} onOpenChange={setChangingPin} />
    </SectionCard>
  )
}

function SessionRow({
  session,
  density,
  onRevoke,
}: {
  session: ProfileSession
  density: "desktop" | "mobile"
  onRevoke: (s: ProfileSession) => void
}) {
  const mobile = density === "mobile"
  const ua = parseUserAgent(session.userAgent)
  const label = session.userAgent
    ? [ua.browser, ua.os].filter(Boolean).join(" · ")
    : session.channel.charAt(0).toUpperCase() + session.channel.slice(1)
  const meta = `${session.channel} · ${formatDate(session.lastUsedAt ?? session.createdAt)}`

  return (
    <div
      className={cn(
        "flex items-center border-t border-settings-hairline-soft",
        mobile ? "gap-3 px-[15px] py-[11px]" : "gap-[14px] px-[18px] py-3"
      )}
    >
      <div
        className={cn(
          "flex flex-none items-center justify-center bg-background text-settings-label",
          mobile
            ? "h-[34px] w-[34px] rounded-[10px] [&_svg]:size-[17px]"
            : "h-[38px] w-[38px] rounded-[11px] [&_svg]:size-[18px]"
        )}
      >
        {ua.isDesktop ? <DesktopIcon /> : <MobileIcon />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "font-bold text-foreground",
              mobile ? "text-[13.5px]" : "text-[14.5px]"
            )}
          >
            {label}
          </span>
          {session.isCurrent && (
            <span
              className={cn(
                "rounded-full bg-settings-info-bg font-bold text-settings-info",
                mobile
                  ? "px-[7px] py-0.5 text-[10px]"
                  : "px-2 py-0.5 text-[11px]"
              )}
            >
              This device
            </span>
          )}
        </div>
        <div
          className={cn(
            "mt-0.5 truncate text-settings-soft",
            mobile ? "text-[12px]" : "text-[12.5px]"
          )}
        >
          {meta}
        </div>
      </div>
      {!session.isCurrent && (
        <DangerButton
          onClick={() => onRevoke(session)}
          ariaLabel={`Revoke ${label} session`}
        >
          Revoke
        </DangerButton>
      )}
    </div>
  )
}

function LockIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 18 18"
      fill="none"
      className="text-primary"
    >
      <rect
        x="3"
        y="8"
        width="12"
        height="8"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path d="M6 8V6a3 3 0 016 0v2" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}

function DesktopIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <rect
        x="2"
        y="3"
        width="14"
        height="9"
        rx="1.6"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <path
        d="M6.5 15h5M9 12v3"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  )
}

function MobileIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <rect
        x="5"
        y="2"
        width="8"
        height="14"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <path
        d="M8 13.5h2"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  )
}
