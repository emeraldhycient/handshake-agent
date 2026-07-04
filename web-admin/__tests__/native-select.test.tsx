/**
 * NativeSelect primitive — regression tests for the tailwind-merge background
 * collapse bug (reported: "the dropdown styles and color is off … on multiple pages").
 *
 * Root cause: the chevron was drawn with four `bg-[…]` arbitrary utilities packed
 * into the className. When `cn()` (clsx + tailwind-merge) merged them with the
 * primitive's `bg-field` fill (and any caller override), tailwind-merge could not
 * classify the arbitrary background-image data-URI utility and silently DROPPED
 * `bg-field`, so the control rendered with a transparent background on every page.
 *
 * The fix moves the chevron to an inline `style` (longhand background-* props) so it
 * never enters tailwind-merge, leaving `bg-field` as the sole background utility in
 * the className. These tests assert the class survives, the chevron persists via
 * inline style, and a caller background override still wins cleanly.
 */
import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"

import { NativeSelect } from "@/components/ui/native-select"

describe("NativeSelect", () => {
  it("keeps the bg-field fill in the className (not collapsed by the chevron)", () => {
    render(
      <NativeSelect aria-label="pick" className="h-[36px] w-[110px]">
        <option value="a">A</option>
      </NativeSelect>
    )
    const select = screen.getByRole("combobox", { name: "pick" })
    // The fill must survive tailwind-merge alongside the caller's height/width.
    expect(select.className).toContain("bg-field")
    expect(select.className).toContain("h-[36px]")
    expect(select.className).toContain("w-[110px]")
  })

  it("draws the chevron via inline style so it never enters tailwind-merge", () => {
    render(
      <NativeSelect aria-label="pick">
        <option value="a">A</option>
      </NativeSelect>
    )
    const select = screen.getByRole("combobox", { name: "pick" }) as HTMLSelectElement
    expect(select.style.backgroundImage).toContain("data:image/svg+xml")
    expect(select.style.backgroundSize).toBe("12px")
    expect(select.style.backgroundRepeat).toBe("no-repeat")
    // (backgroundPosition "right 10px center" is set in the source but jsdom's CSS
    // parser can't handle the 3-value edge-offset syntax — verified in-browser.)
  })

  it("lets a caller override the background fill (bg-card wins, bg-field drops)", () => {
    render(
      <NativeSelect aria-label="pick" className="bg-card">
        <option value="a">A</option>
      </NativeSelect>
    )
    const select = screen.getByRole("combobox", { name: "pick" }) as HTMLSelectElement
    expect(select.className).toContain("bg-card")
    expect(select.className).not.toContain("bg-field")
    // The chevron persists regardless of the className override.
    expect(select.style.backgroundImage).toContain("data:image/svg+xml")
  })

  it("still spreads native props (register-style) onto the <select>", () => {
    render(
      <NativeSelect aria-label="pick" name="currency" defaultValue="b">
        <option value="a">A</option>
        <option value="b">B</option>
      </NativeSelect>
    )
    const select = screen.getByRole("combobox", { name: "pick" }) as HTMLSelectElement
    expect(select.name).toBe("currency")
    expect(select.value).toBe("b")
  })
})
