import type {
  PatListItem,
  ProfileResponse,
  ProfileSession,
  PublicConfigResponse,
  PublicNickname,
} from "@handshake-agent/contracts"

// ─── Settings feature types (root §16.6) ──────────────────────────────────────

/** One enabled fiat from GET /config — the display-currency options. */
export type PublicFiatOption = PublicConfigResponse["fiats"][number]

export interface SettingsPanelProps {
  density?: "desktop" | "mobile"
  className?: string
}

export interface EditProfileDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  profile: ProfileResponse
  fiats: PublicFiatOption[]
}

export interface ChangePinDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export interface CreateTokenDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export interface ConfirmRevokeDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  confirmLabel: string
  pending: boolean
  error: string | null
  onConfirm: () => void
}

export interface SessionRowProps {
  session: ProfileSession
  onRevoke: (session: ProfileSession) => void
}

export interface TokenRowProps {
  token: PatListItem
  onRevoke: (token: PatListItem) => void
}

// ─── PayID + public nicknames (Spec 2) ────────────────────────────────────────

export interface ChangePayIdFormProps {
  onDone: () => void
  /** Fired on a PAYID_ALREADY_CHANGED 409 — carries the server's message. */
  onAlreadyChanged: (message: string) => void
}

export interface NicknameRowProps {
  nickname: PublicNickname
  onRemove: (nickname: PublicNickname) => void
}

export interface AddNicknameFormProps {
  onDone: () => void
}
