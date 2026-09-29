// xterm 6's headless parser emits color events but has no theme service.
// Keep this pinned-version integration beside the snapshot integration.
export function installTerminalColors(terminal, reply) {
  let defaults = []
  let colors = []
  const overrides = new Set()
  const rgb = (hex) => [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16))
  const serialize = (index, color) => {
    const name = index < 256 ? `4;${index}` : String(index - 246)
    return `\x1b]${name};rgb:${color.map((channel) => channel.toString(16).padStart(2, '0').repeat(2)).join('/')}\x1b\\`
  }
  const setTheme = (theme) => {
    defaults = theme.slice(3).map(rgb)
    for (let i = 16; i < 232; i++) {
      const n = i - 16
      defaults[i] = [Math.floor(n / 36), Math.floor(n / 6) % 6, n % 6].map((v) => (v ? 55 + v * 40 : 0))
    }
    for (let i = 232; i < 256; i++) defaults[i] = [8 + (i - 232) * 10, 8 + (i - 232) * 10, 8 + (i - 232) * 10]
    defaults.push(...theme.slice(0, 3).map(rgb))
    colors = defaults.map((color, index) => (overrides.has(index) ? colors[index] : [...color]))
  }
  setTheme([
    '#1d1d1f',
    '#ffffff',
    '#1d1d1f',
    '#000000',
    '#d70015',
    '#1f7f37',
    '#a45a00',
    '#0066cc',
    '#af52de',
    '#007c89',
    '#6e6e73',
    '#6e6e73',
    '#ff3b30',
    '#34c759',
    '#ff9500',
    '#007aff',
    '#bf5af2',
    '#32ade6',
    '#1d1d1f',
  ])
  terminal._core._inputHandler.onColor((events) => {
    for (const event of events) {
      if (event.type === 0) reply(serialize(event.index, colors[event.index]))
      else if (event.type === 1) {
        overrides.add(event.index)
        colors[event.index] = [...event.color]
      } else if (event.index !== undefined) {
        overrides.delete(event.index)
        colors[event.index] = [...defaults[event.index]]
      } else
        for (let i = 0; i < 256; i++) {
          overrides.delete(i)
          colors[i] = [...defaults[i]]
        }
    }
  })
  return {
    setTheme,
    snapshot: () => colors.map((color, index) => serialize(index, color)).join(''),
  }
}
