import type { ITheme } from '@xterm/xterm'
const CLIENT_INPUT = 0
const CLIENT_RESIZE = 1
const SERVER_OUTPUT = 0
const SERVER_EXIT = 2
const SERVER_METADATA = 3

export function encodeTerminalInput(data: string): Uint8Array<ArrayBuffer> {
  const encoded = new TextEncoder().encode(data)
  const message = new Uint8Array(encoded.length + 1)
  message[0] = CLIENT_INPUT
  message.set(encoded, 1)
  return message
}

export function encodeTerminalBinaryInput(data: string): Uint8Array<ArrayBuffer> {
  const message = new Uint8Array(data.length + 1)
  message[0] = CLIENT_INPUT
  for (let index = 0; index < data.length; index++) message[index + 1] = data.charCodeAt(index) & 0xff
  return message
}

export function encodeTerminalResize(cols: number, rows: number): Uint8Array<ArrayBuffer> {
  const message = new Uint8Array(5)
  const view = new DataView(message.buffer)
  message[0] = CLIENT_RESIZE
  view.setUint16(1, cols)
  view.setUint16(3, rows)
  return message
}

export function decodeExitCode(bytes: Uint8Array<ArrayBufferLike>): number | null {
  if (bytes[0] !== SERVER_EXIT || bytes.length !== 5) return null
  return new DataView(bytes.buffer, bytes.byteOffset + 1, 4).getInt32(0)
}

export function decodeTerminalOutput(bytes: Uint8Array<ArrayBufferLike>): Uint8Array<ArrayBufferLike> | null {
  return bytes[0] === SERVER_OUTPUT ? bytes.subarray(1) : null
}

export function decodeProcessName(bytes: Uint8Array<ArrayBufferLike>): string | null {
  if (bytes[0] !== SERVER_METADATA || bytes.length < 2) return null
  return new TextDecoder().decode(bytes.subarray(1))
}

export function decodeTerminalSnapshot(
  bytes: Uint8Array<ArrayBufferLike>,
): { cols: number; rows: number; content: Uint8Array<ArrayBufferLike> } | null {
  if (bytes[0] !== 4 || bytes.length < 5) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return { cols: view.getUint16(1), rows: view.getUint16(3), content: bytes.subarray(5) }
}

export function decodeServerResize(bytes: Uint8Array<ArrayBufferLike>): { cols: number; rows: number } | null {
  if (bytes[0] !== 5 || bytes.length !== 5) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return { cols: view.getUint16(1), rows: view.getUint16(3) }
}

export function encodeTerminalTheme(theme: ITheme): Uint8Array<ArrayBuffer> {
  const keys = [
    'foreground',
    'background',
    'cursor',
    'black',
    'red',
    'green',
    'yellow',
    'blue',
    'magenta',
    'cyan',
    'white',
    'brightBlack',
    'brightRed',
    'brightGreen',
    'brightYellow',
    'brightBlue',
    'brightMagenta',
    'brightCyan',
    'brightWhite',
  ] as const
  const bytes = new TextEncoder().encode(JSON.stringify(keys.map((key) => theme[key])))
  return new Uint8Array([3, ...bytes])
}

export function decodeTerminalControl(bytes: Uint8Array<ArrayBufferLike>): { control: boolean; viewer: string } | null {
  if (bytes[0] !== 6) return null
  const value = JSON.parse(new TextDecoder().decode(bytes.subarray(1)))
  if (typeof value.control !== 'boolean' || typeof value.viewer !== 'string') throw new Error('Invalid control message')
  return value
}
