import type { Terminal } from '@xterm/xterm'

// xterm 6 exposes generated replies and user input through the same onData API.
// The pinned core flag lets us suppress replies without suppressing keyboard,
// IME, paste or mouse input. The server answers queries, including while detached.
export function suppressTerminalReplies(terminal: Terminal): void {
  const core = (
    terminal as unknown as {
      _core: { coreService: { triggerDataEvent(data: string, userInput?: boolean): void } }
    }
  )._core.coreService
  const send = core.triggerDataEvent.bind(core)
  core.triggerDataEvent = (data, userInput = false) => {
    if (userInput || data === '\x1b[I' || data === '\x1b[O') send(data, userInput)
  }
}
