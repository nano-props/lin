import type { ITheme } from '@xterm/xterm'

export function terminalAppearance(): { theme: ITheme; fontFamily: string; fontSize: number; lineHeight: number } {
  const styles = getComputedStyle(document.documentElement)
  const token = (name: string): string => styles.getPropertyValue(`--lin-${name}`).trim()
  return {
    fontFamily: token('font-mono'),
    fontSize: Number.parseFloat(token('font-size-terminal')),
    lineHeight: Number.parseFloat(token('line-height-terminal')),
    theme: {
      background: token('terminal-background'),
      foreground: token('terminal-foreground'),
      cursor: token('terminal-cursor'),
      cursorAccent: token('terminal-background'),
      selectionBackground: token('terminal-selection-background'),
      black: token('terminal-ansi-black'),
      red: token('terminal-ansi-red'),
      green: token('terminal-ansi-green'),
      yellow: token('terminal-ansi-yellow'),
      blue: token('terminal-ansi-blue'),
      magenta: token('terminal-ansi-magenta'),
      cyan: token('terminal-ansi-cyan'),
      white: token('terminal-ansi-white'),
      brightBlack: token('terminal-ansi-bright-black'),
      brightRed: token('terminal-ansi-bright-red'),
      brightGreen: token('terminal-ansi-bright-green'),
      brightYellow: token('terminal-ansi-bright-yellow'),
      brightBlue: token('terminal-ansi-bright-blue'),
      brightMagenta: token('terminal-ansi-bright-magenta'),
      brightCyan: token('terminal-ansi-bright-cyan'),
      brightWhite: token('terminal-ansi-bright-white'),
    },
  }
}
