import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

const setLanguage = vi.fn()
const resetLanguage = vi.fn()
vi.mock("./translation-provider", () => ({
  useTranslation: () => ({
    language: { code: "en", englishName: "English", nativeName: "English" },
    languages: [
      { code: "en", englishName: "English", nativeName: "English" },
      { code: "fr", englishName: "French", nativeName: "Français" },
      { code: "yo", englishName: "Yoruba", nativeName: "Yorùbá" },
    ],
    setLanguage,
    resetLanguage,
  }),
}))

import { LanguageSelector } from "./language-selector"

describe("LanguageSelector", () => {
  beforeEach(() => vi.clearAllMocks())

  it("renders a combobox showing the current language", () => {
    render(<LanguageSelector />)
    const input = screen.getByRole("combobox", { name: /language/i })
    expect(input).toBeInTheDocument()
  })

  it("filters options by English or native name", async () => {
    const user = userEvent.setup()
    render(<LanguageSelector />)
    await user.click(screen.getByRole("combobox", { name: /language/i }))
    await user.type(screen.getByRole("combobox", { name: /language/i }), "yor")
    expect(screen.getByRole("option", { name: /Yoruba/i })).toBeInTheDocument()
    expect(screen.queryByRole("option", { name: /French/i })).toBeNull()
  })

  it("selecting a language calls setLanguage with its code", async () => {
    const user = userEvent.setup()
    render(<LanguageSelector />)
    await user.click(screen.getByRole("combobox", { name: /language/i }))
    await user.click(screen.getByRole("option", { name: /French/i }))
    expect(setLanguage).toHaveBeenCalledWith("fr")
  })

  it("selecting English (the default) calls setLanguage('en')", async () => {
    const user = userEvent.setup()
    render(<LanguageSelector />)
    await user.click(screen.getByRole("combobox", { name: /language/i }))
    await user.click(screen.getByRole("option", { name: /^English/i }))
    expect(setLanguage).toHaveBeenCalledWith("en")
  })

  it("is excluded from translation (translate=no)", () => {
    const { container } = render(<LanguageSelector />)
    expect(container.firstChild).toHaveAttribute("translate", "no")
  })
})
