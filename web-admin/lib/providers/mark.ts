/** The 2-letter mark shown in a provider's rounded tile (initials of the name). */
export function providerMark(name: string): string {
  const words = name.trim().split(/\s+/)
  const first = words[0]?.[0] ?? ""
  const second = words[1]?.[0] ?? words[0]?.[1] ?? ""
  return (first + second).toUpperCase()
}
