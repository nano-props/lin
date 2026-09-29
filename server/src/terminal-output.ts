// Hold incomplete UTF-8 / VT sequences so reconnect snapshots cannot lose a parser prefix.
const MAX_SEQUENCE_BYTES = 1_048_576

enum State {
  Text,
  Escape,
  Csi,
  String,
  StringEscape,
}

export class TerminalOutput {
  private state = State.Text
  private pending: number[] = []
  private remainingUtf8 = 0
  private codepoint = 0
  private osc = false
  private discarding = false

  accept(bytes: Uint8Array): Uint8Array {
    const complete: number[] = []
    for (const value of bytes) {
      if (
        this.state === State.Text &&
        this.remainingUtf8 === 0 &&
        this.pending.length === 0 &&
        value < 0x80 &&
        value !== 0x1b
      ) {
        complete.push(value)
        continue
      }
      if (!this.discarding) this.pending.push(value)
      if (this.remainingUtf8 > 0 && (value & 0xc0) === 0x80) {
        this.codepoint = (this.codepoint << 6) | (value & 0x3f)
        if (--this.remainingUtf8 > 0) continue
        this.advance(this.codepoint)
      } else if (value >= 0xc2 && value <= 0xf4) {
        this.remainingUtf8 = value < 0xe0 ? 1 : value < 0xf0 ? 2 : 3
        this.codepoint = value & (this.remainingUtf8 === 1 ? 0x1f : this.remainingUtf8 === 2 ? 0x0f : 0x07)
        continue
      } else {
        this.remainingUtf8 = 0
        this.advance(value < 0x80 ? value : 0xfffd)
      }
      if (this.state === State.Text) {
        if (!this.discarding) for (const byte of this.pending) complete.push(byte)
        this.pending = []
        this.discarding = false
      } else if (this.pending.length > MAX_SEQUENCE_BYTES) {
        this.pending = []
        this.discarding = true
      }
    }
    return Uint8Array.from(complete)
  }

  private advance(value: number) {
    if (value === 0x18 || value === 0x1a) {
      this.state = State.Text
      return
    }
    if (this.state === State.String || this.state === State.StringEscape) {
      if (value === 0x9c || (this.osc && value === 7) || (this.state === State.StringEscape && value === 0x5c)) {
        this.state = State.Text
      } else this.state = value === 0x1b ? State.StringEscape : State.String
      return
    }
    if (value === 0x1b) {
      this.state = State.Escape
      return
    }
    if (value === 0x9b) {
      this.state = State.Csi
      return
    }
    if ([0x9d, 0x90, 0x98, 0x9e, 0x9f].includes(value)) {
      this.osc = value === 0x9d
      this.state = State.String
      return
    }
    if (this.state === State.Escape) {
      if (value === 0x5b) this.state = State.Csi
      else if ([0x5d, 0x50, 0x58, 0x5e, 0x5f].includes(value)) {
        this.osc = value === 0x5d
        this.state = State.String
      } else if (value >= 0x30 && value <= 0x7e) this.state = State.Text
    } else if (this.state === State.Csi && value >= 0x40 && value <= 0x7e) this.state = State.Text
  }
}
