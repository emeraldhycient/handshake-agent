import { cn } from "@/lib/utils"
import type { AvatarPlaceholderProps } from "@/types/components"

/**
 * Circular striped avatar placeholder.
 * Uses CSS custom properties (--primary-mid, --primary) so zero hex literals
 * appear in component source. Both tokens are declared in globals.css.
 */
export function AvatarPlaceholder({
  size = 38,
  className,
}: AvatarPlaceholderProps) {
  return (
    <div
      data-testid="avatar-placeholder"
      className={cn("flex-none rounded-full", className)}
      style={{
        width: size,
        height: size,
        backgroundImage:
          "repeating-linear-gradient(45deg, var(--primary-mid) 0 5px, var(--primary) 5px 10px)",
      }}
      aria-hidden="true"
    />
  )
}
