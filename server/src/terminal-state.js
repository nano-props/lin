import { Terminal } from '@xterm/headless'
import { SerializeAddon } from '@xterm/addon-serialize'

export function createTerminalState(cols, rows) {
  const terminal = new Terminal({ cols, rows, scrollback: 10_000, allowProposedApi: true })
  const serializer = new SerializeAddon()
  terminal.loadAddon(serializer)
  let replies = ''
  terminal.onData((data) => {
    replies += data
  })
  let title = ''
  terminal.onTitleChange((value) => {
    title = value.slice(0, 1024)
  })
  return {
    write(raw) {
      return new Promise((resolve) => terminal.write(raw, resolve))
    },
    get cols() {
      return terminal.cols
    },
    get rows() {
      return terminal.rows
    },
    resize(cols, rows) {
      terminal.resize(cols, rows)
    },
    snapshot() {
      // xterm 6's serializer omits saved attributes, scroll margins and cursor
      // visibility. Keep this pinned-version integration here, with round-trip tests.
      const core = terminal._core
      let content = serializer.serialize({ excludeModes: true })
      if (terminal.buffer.active.type === 'alternate') {
        content = content.replace(
          '\x1b[?1049h',
          sgr(core._bufferService.buffers.normal.savedCurAttrData) + '\x1b[?1049h',
        )
      }
      const buffer = core._bufferService.buffer
      if (buffer.scrollTop !== 0 || buffer.scrollBottom !== terminal.rows - 1) {
        content += `\x1b[${buffer.scrollTop + 1};${buffer.scrollBottom + 1}r`
      }
      const savedRow = Math.max(0, Math.min(terminal.rows - 1, buffer.savedY - buffer.ybase))
      content += `\x1b[${savedRow + 1};${buffer.savedX + 1}H${sgr(buffer.savedCurAttrData)}\x1b7`
      content += serializer._serializeModes(terminal)
      const row = buffer.y + 1 - (terminal.modes.originMode ? buffer.scrollTop : 0)
      if (buffer.x >= terminal.cols) {
        // Reprint the final cell to preserve the pending wrap at the right edge.
        const line = terminal.buffer.active.getLine(buffer.ybase + buffer.y)
        let column = terminal.cols - 1
        if (line.getCell(column).getWidth() === 0) column--
        const cell = line.getCell(column)
        content += `\x1b[${row};${column + 1}H${sgr(cell)}${cell.getChars() || ' '}`
      } else {
        content += `\x1b[${row};${buffer.x + 1}H`
      }
      content += sgr(core._inputHandler._curAttrData)
      content += core.coreService.isCursorHidden ? '\x1b[?25l' : '\x1b[?25h'
      if (core.coreMouseService.activeEncoding === 'SGR') content += '\x1b[?1006h'
      return content
    },
    replies() {
      const result = replies
      replies = ''
      return result
    },
    title() {
      return title
    },
    dispose() {
      terminal.dispose()
    },
  }
}

function sgr(attributes) {
  const codes = [0]
  for (const [method, code] of [
    ['isBold', 1],
    ['isDim', 2],
    ['isItalic', 3],
    ['isUnderline', 4],
    ['isBlink', 5],
    ['isInverse', 7],
    ['isInvisible', 8],
    ['isStrikethrough', 9],
    ['isOverline', 53],
  ]) {
    if (attributes[method]()) codes.push(code)
  }
  for (const [prefix, mode] of [
    ['Fg', 38],
    ['Bg', 48],
  ]) {
    const color = attributes[`get${prefix}Color`]()
    if (attributes[`is${prefix}RGB`]()) codes.push(mode, 2, (color >>> 16) & 255, (color >>> 8) & 255, color & 255)
    else if (attributes[`is${prefix}Palette`]()) {
      if (color < 16) codes.push((mode === 38 ? 30 : 40) + (color >= 8 ? 60 : 0) + (color & 7))
      else codes.push(mode, 5, color)
    }
  }
  return `\x1b[${codes.join(';')}m`
}
