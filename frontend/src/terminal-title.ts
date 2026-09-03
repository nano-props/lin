export function compactTerminalTitle(title: string): string {
  const value = title.replace(/\s+/g, ' ').trim()
  if (!value) return ''
  const parts = value.split(/\s+[—–|-]\s+/)
  const compact = parts.length > 1 ? `${basename(parts[0]!)} · ${basename(parts.at(-1)!)}` : basename(value)
  return compact.length <= 32 ? compact : `${compact.slice(0, 31).trimEnd()}…`
}

function basename(value: string): string {
  const clean = value.replace(/[\\/]+$/, '')
  return clean.split(/[\\/]/).at(-1) || clean
}
