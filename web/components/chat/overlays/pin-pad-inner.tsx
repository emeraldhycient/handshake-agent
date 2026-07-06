import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { PinPadKeys } from "@/components/chat/overlays/pin-pad-keys"
import type { PinPadInnerProps } from "@/types/chat"

/** Inner PIN layout — shared between the mobile full-screen and desktop card. */
export function PinPadInner({
  pinLength,
  density,
  onDigit,
  onBack,
  onFaceId,
  onCancel,
  error,
}: PinPadInnerProps) {
  const isDesktop = density === "desktop"

  return (
    <>
      {/* Header: icon + heading + subtitle + dots */}
      <div className={cn("text-center", isDesktop ? "" : "px-6 pt-16")}>
        <div
          className={cn(
            "mx-auto mb-4 flex items-center justify-center rounded-[15px] bg-white/10",
            isDesktop ? "mb-3.5 h-[46px] w-[46px] rounded-[14px]" : "h-12 w-12"
          )}
          aria-hidden="true"
        >
          <svg
            width={isDesktop ? 19 : 20}
            height={isDesktop ? 21 : 22}
            viewBox="0 0 20 22"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M5 9V5.5a5 5 0 0110 0V9"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              className="text-accent"
            />
            <rect
              x="2.5"
              y="9"
              width="15"
              height="11"
              rx="3"
              className="fill-accent"
            />
          </svg>
        </div>

        <p className={cn("font-bold", isDesktop ? "text-[19px]" : "text-xl")}>
          Enter your PIN
        </p>
        <p
          className={cn(
            "mt-1 text-primary-foreground/65",
            isDesktop ? "mt-1 text-[13px]" : "mt-[5px] text-[13.5px]"
          )}
        >
          Confirm to authorise this transaction
        </p>

        {/* PIN dots */}
        <div
          className={cn(
            "flex justify-center",
            isDesktop ? "mt-[22px] gap-[15px]" : "mt-[26px] gap-4"
          )}
          role="status"
          aria-label={`${pinLength} of 4 digits entered`}
        >
          {Array.from({ length: 4 }).map((_, i) => {
            const filled = i < pinLength
            return (
              <div
                key={i}
                data-filled={filled ? "true" : "false"}
                className={cn(
                  "h-[15px] w-[15px] rounded-full border-2",
                  filled
                    ? "border-accent bg-accent"
                    : "border-primary-foreground/50 bg-transparent"
                )}
              />
            )
          })}
        </div>

        {error && (
          <p
            role="alert"
            className={cn(
              "mt-3 font-medium text-danger",
              isDesktop ? "text-[12px]" : "text-[13px]"
            )}
          >
            {error}
          </p>
        )}
      </div>

      {/* Spacer pushes keypad to bottom on mobile */}
      {!isDesktop && <div className="flex-1" />}

      <PinPadKeys
        density={density}
        onDigit={onDigit}
        onBack={onBack}
        onFaceId={onFaceId}
      />

      <Button
        variant="ghost"
        onClick={onCancel}
        className={cn(
          "w-full text-primary-foreground/70 hover:bg-transparent hover:text-primary-foreground/70",
          isDesktop ? "mt-4 py-1.5 text-[14px]" : "pt-2 pb-[34px] text-[14px]"
        )}
      >
        Cancel
      </Button>
    </>
  )
}
