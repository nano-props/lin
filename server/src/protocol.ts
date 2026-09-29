export function payload(type: number, data: string | Uint8Array): Buffer {
  return Buffer.concat([Buffer.from([type]), typeof data === 'string' ? Buffer.from(data) : data])
}

export function sizePayload(type: number, cols: number, rows: number, content = ''): Buffer {
  const header = Buffer.alloc(5)
  header[0] = type
  header.writeUInt16BE(cols, 1)
  header.writeUInt16BE(rows, 3)
  return Buffer.concat([header, Buffer.from(content)])
}

export function exitPayload(code: number): Buffer {
  const bytes = Buffer.alloc(5)
  bytes[0] = 2
  bytes.writeInt32BE(code, 1)
  return bytes
}

export type ClientMessage =
  { input: Uint8Array } | { cols: number; rows: number } | { takeover: true } | { theme: string[] }

export function decodeInput(message: string | Uint8Array): ClientMessage {
  if (typeof message === 'string' || !message.length) throw new Error('binary terminal message required')
  if (message[0] === 0) return { input: message.subarray(1) }
  if (message[0] === 2 && message.length === 1) return { takeover: true }
  if (message[0] === 3) {
    if (message.length > 256) throw new Error('invalid theme')
    const theme: unknown = JSON.parse(new TextDecoder().decode(message.subarray(1)))
    if (
      !Array.isArray(theme) ||
      theme.length !== 19 ||
      !theme.every((color) => typeof color === 'string' && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(color))
    )
      throw new Error('invalid theme')
    return {
      theme: theme.map((color: string) =>
        color.length === 4 ? '#' + [...color.slice(1)].map((channel) => channel + channel).join('') : color,
      ),
    }
  }
  if (message[0] !== 1 || message.length !== 5) throw new Error('invalid terminal message')
  const view = new DataView(message.buffer, message.byteOffset, message.byteLength)
  const cols = view.getUint16(1),
    rows = view.getUint16(3)
  if (cols < 2 || cols > 1000 || rows < 1 || rows > 1000) throw new Error('terminal size is out of range')
  return { cols, rows }
}
