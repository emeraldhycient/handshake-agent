import { DeleteIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import type { PinPadKeysProps } from "@/types/chat"

/** The 9 numeric keys, in order (Face ID / 0 / Backspace fill the last row). */
const PIN_DIGITS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"] as const

/** Emit-only keypad grid: digits 1–9, Face ID, 0, Backspace. */
export function PinPadKeys({
  density,
  onDigit,
  onBack,
  onFaceId,
}: PinPadKeysProps) {
  const isDesktop = density === "desktop"
  const digitClass = cn(
    "font-semibold text-primary-foreground hover:bg-white/10 hover:text-primary-foreground",
    isDesktop
      ? "h-[52px] rounded-[15px] bg-white/8 text-[23px]"
      : "h-[62px] rounded-[18px] bg-white/8 text-[26px]"
  )

  return (
    <div
      className={cn(
        "grid grid-cols-3",
        isDesktop ? "mt-6 gap-3" : "gap-x-6 gap-y-3.5 px-7 pb-[18px]"
      )}
    >
      {PIN_DIGITS.map((d) => (
        <Button
          key={d}
          variant="ghost"
          onClick={() => onDigit(d)}
          className={digitClass}
        >
          {d}
        </Button>
      ))}

      <Button
        variant="ghost"
        onClick={onFaceId}
        aria-label="Use Face ID"
        className={cn(
          "font-bold text-accent hover:bg-transparent hover:text-accent",
          isDesktop
            ? "h-[52px] rounded-[15px] text-[12px]"
            : "h-[62px] rounded-[18px] text-[12.5px]"
        )}
      >
        Face ID
      </Button>

      <Button
        variant="ghost"
        onClick={() => onDigit("0")}
        className={digitClass}
      >
        0
      </Button>

      <Button
        variant="ghost"
        onClick={onBack}
        aria-label="Backspace"
        className={cn(
          "text-primary-foreground hover:bg-transparent hover:text-primary-foreground",
          isDesktop ? "h-[52px] rounded-[15px]" : "h-[62px] rounded-[18px]"
        )}
      >
        <DeleteIcon
          className={cn(isDesktop ? "h-6 w-6" : "h-[26px] w-[26px]")}
          aria-hidden="true"
        />
      </Button>
    </div>
  )
}
