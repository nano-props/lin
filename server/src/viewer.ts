import type { ServerWebSocket } from 'bun'
import type { Viewer } from './session'

export class SocketViewer implements Viewer {
  readonly id = crypto.randomUUID()
  private snapshotAllowance = 0
  constructor(private socket: ServerWebSocket<unknown>) {}
  get open() {
    return this.socket.readyState === 1
  }
  send(bytes: Uint8Array) {
    if (!this.open) return
    const buffered = this.socket.getBufferedAmount()
    if (buffered === 0) this.snapshotAllowance = 0
    // The initial bounded screen snapshot has a separate budget from live output.
    if (bytes[0] === 4) this.snapshotAllowance = bytes.byteLength
    // A slow viewer reconnects to the authoritative screen instead of dropping output.
    if (buffered > this.snapshotAllowance + 8 * 1024 * 1024 || this.socket.send(bytes) === 0) {
      this.socket.terminate()
    }
  }
  close(code: number, reason: string) {
    this.socket.close(code, reason)
  }
}
