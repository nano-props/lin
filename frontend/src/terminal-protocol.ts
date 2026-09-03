const CLIENT_INPUT = 0
const CLIENT_RESIZE = 1
const SERVER_OUTPUT = 0
const SERVER_EXIT = 2

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
