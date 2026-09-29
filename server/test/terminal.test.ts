import { expect, test } from 'bun:test'
import { createTerminalState } from '../src/terminal-state.js'
import { TerminalOutput } from '../src/terminal-output'
import { decodeInput, payload, sizePayload } from '../src/protocol'
import { SocketViewer } from '../src/viewer'
import type { ServerWebSocket } from 'bun'

const encode = (text: string) => new TextEncoder().encode(text)

test('emoji occupies two cells and preserves wrapping after snapshot restore', async () => {
  const original = createTerminalState(80, 24),
    restored = createTerminalState(80, 24)
  try {
    await original.write('A👾B\x1b[6n')
    expect(original.replies()).toBe('\x1b[1;5R')
    await original.write('\r\n' + 'x'.repeat(78) + '👾')
    await restored.write(original.snapshot())
    for (const screen of [original, restored]) {
      await screen.write('!\x1b[6n')
      expect(screen.replies()).toBe('\x1b[3;2R')
    }
    expect(restored.snapshot()).toBe(original.snapshot())
  } finally {
    original.dispose()
    restored.dispose()
  }
})

test('restores alternate screen, colors, title, modes and subsequent output', async () => {
  const terminal = createTerminalState(80, 24),
    restored = createTerminalState(80, 24)
  try {
    await terminal.write('shell history\r\n\x1b]2;editor\x07\x1b[?1049h\x1b[2J\x1b[4;6H\x1b[31m编辑器\x1b[?2004h')
    const snapshot = terminal.snapshot()
    expect(terminal.title()).toBe('editor')
    for (const part of ['shell history', '编辑器', '\x1b[?1049h', '\x1b[?2004h']) expect(snapshot).toContain(part)
    await restored.write(snapshot)
    expect(restored.snapshot()).toBe(snapshot)
    for (const screen of [terminal, restored]) await screen.write('!\x1b[?1049l\r\ncontinued')
    expect(restored.snapshot()).toBe(terminal.snapshot())
  } finally {
    terminal.dispose()
    restored.dispose()
  }
})

for (const input of [
  '\x1b[3;4H\x1b[32m\x1b7\x1b[10;8H\x1b[31mhello',
  '\x1b[2;20r\x1b[?6h\x1b[4;8Hregion',
  'x'.repeat(80),
]) {
  test(`restores cursor, margins and pending wrap: ${JSON.stringify(input)}`, async () => {
    const original = createTerminalState(80, 24),
      restored = createTerminalState(80, 24)
    try {
      await original.write(input)
      await restored.write(original.snapshot())
      for (const screen of [original, restored]) await screen.write('!\x1b8next')
      expect(restored.snapshot()).toBe(original.snapshot())
    } finally {
      original.dispose()
      restored.dispose()
    }
  })
}

test('bounds scrollback and preserves split UTF-8', async () => {
  const screen = createTerminalState(80, 24)
  try {
    await screen.write('discard-me\r\n' + 'line\r\n'.repeat(10_050))
    const bytes = encode('中文')
    await screen.write(bytes.subarray(0, 2))
    await screen.write(bytes.subarray(2))
    expect(screen.snapshot()).not.toContain('discard-me')
    expect(screen.snapshot()).toContain('中文')
    expect(screen.snapshot().length).toBeLessThan(100_000)
  } finally {
    screen.dispose()
  }
})

test('resize, progress updates and device replies work without global timer shims', async () => {
  const timeout = globalThis.setTimeout,
    screen = createTerminalState(80, 24)
  try {
    screen.resize(100, 30)
    await screen.write('progress 10%\rprogress 90%\x1b[6n')
    expect([screen.cols, screen.rows]).toEqual([100, 30])
    expect(screen.snapshot()).toContain('progress 90%')
    expect(screen.snapshot()).not.toContain('progress 10%')
    expect(screen.replies()).toMatch(/^\x1b\[\d+;\d+R$/)
    expect(screen.replies()).toBe('')
    expect(globalThis.setTimeout).toBe(timeout)
  } finally {
    screen.dispose()
  }
})

test('holds split control sequences and UTF-8 at reconnect boundaries', () => {
  const output = new TerminalOutput()
  const accept = (s: string) => new TextDecoder().decode(output.accept(encode(s)))
  expect(accept('hello\x1b[31')).toBe('hello')
  expect(accept('mred\x1b]2;ti')).toBe('\x1b[31mred')
  expect(accept('tle\x1b')).toBe('')
  expect(accept('\\done')).toBe('\x1b]2;title\x1b\\done')
  const bytes = encode('中')
  expect(output.accept(bytes.subarray(0, 2)).length).toBe(0)
  expect(output.accept(bytes.subarray(2))).toEqual(bytes)
  expect(accept('\u009b31')).toBe('')
  expect(accept('m')).toBe('\u009b31m')
})

test('discards oversized control strings and recovers', () => {
  const output = new TerminalOutput()
  expect(output.accept(encode('\x1b]2;' + 'a'.repeat(1_100_000))).length).toBe(0)
  expect(output.accept(encode('\x07ok'))).toEqual(encode('ok'))
})

test('wire protocol preserves binary input and validates resize', () => {
  expect(payload(0, new Uint8Array([2, 0, 0, 0, 7]))).toEqual(Buffer.from([0, 2, 0, 0, 0, 7]))
  expect(decodeInput(Buffer.from([0, 0xff, 0]))).toEqual({ input: Buffer.from([0xff, 0]) })
  expect(decodeInput(sizePayload(1, 120, 40))).toEqual({ cols: 120, rows: 40 })
  for (const data of ['text', Buffer.alloc(0), sizePayload(1, 1, 24), sizePayload(1, 80, 1001), Buffer.from([7])]) {
    expect(() => decodeInput(data)).toThrow()
  }
})

test('disconnects a stalled viewer instead of dropping output', () => {
  let closed = false,
    sent = 0
  const socket = {
    readyState: 1,
    getBufferedAmount: () => 9 * 1024 * 1024,
    send: () => {
      sent++
      return 1
    },
    terminate: () => {
      closed = true
    },
  } as unknown as ServerWebSocket<unknown>
  new SocketViewer(socket).send(payload(0, 'output'))
  expect(closed).toBe(true)
  expect(sent).toBe(0)
})

test('initial snapshots have a separate budget from live output', () => {
  let buffered = 0,
    closed = false
  const socket = {
    readyState: 1,
    getBufferedAmount: () => buffered,
    send: (bytes: Uint8Array) => {
      buffered += bytes.length
      return -1
    },
    terminate: () => {
      closed = true
    },
  } as unknown as ServerWebSocket<unknown>
  const viewer = new SocketViewer(socket)
  const snapshot = new Uint8Array(10 * 1024 * 1024)
  snapshot[0] = 4
  viewer.send(snapshot)
  viewer.send(payload(0, 'next output'))
  expect(closed).toBe(false)
  buffered += 8 * 1024 * 1024
  viewer.send(payload(0, 'overflow'))
  expect(closed).toBe(true)
})
