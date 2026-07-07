import { STRIPE_AVATAR } from "@/constants/admin-settings"
import type { ProfileCardProps } from "@/types/components"

/**
 * Profile card (markup line 4) — 52px striped avatar, the real displayName, email ·
 * role, and the MFA state. The pill reflects the real `mfaEnabled`: enrolled
 * (success) or a neutral "2FA not set" so the operator sees their true posture; when
 * not enrolled it also offers an "Enroll 2FA" button that opens the MFA dialog.
 */
export function ProfileCard({
  displayName,
  email,
  roleLabel,
  mfaEnabled,
  onEnroll,
}: ProfileCardProps) {
  return (
    <div className="mb-[14px] flex items-center gap-[15px] rounded-[16px] border border-line bg-card p-[18px_20px]">
      <span
        aria-hidden="true"
        style={{ background: STRIPE_AVATAR }}
        className="size-[52px] flex-none rounded-full"
      />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[16px] font-extrabold text-ink">
          {displayName}
        </div>
        <div className="truncate text-[12.5px] text-ink3">
          {email} · {roleLabel}
        </div>
      </div>
      {mfaEnabled ? (
        <div className="flex items-center gap-[7px] rounded-full bg-sok px-[12px] py-[6px] text-[11.5px] font-bold text-tok">
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M7 11V8a5 5 0 0 1 10 0v3"
              stroke="currentColor"
              strokeWidth="1.7"
            />
            <rect
              x="5"
              y="11"
              width="14"
              height="9"
              rx="2"
              stroke="currentColor"
              strokeWidth="1.7"
            />
          </svg>
          2FA enrolled
        </div>
      ) : (
        <div className="flex flex-none items-center gap-[10px]">
          <div className="flex items-center gap-[7px] rounded-full bg-swn px-[12px] py-[6px] text-[11.5px] font-bold text-twn">
            2FA not set
          </div>
          <button
            type="button"
            onClick={onEnroll}
            className="cursor-pointer rounded-[10px] bg-brand-green px-[14px] py-2 text-[12.5px] font-bold text-white transition-opacity outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            Enroll 2FA
          </button>
        </div>
      )}
    </div>
  )
}
