import { accessSync, constants } from 'node:fs'
import { homedir } from 'node:os'
import { basename } from 'node:path'
import { createTerminalState } from './terminal-state.js'
import { TerminalOutput } from './terminal-output'
import { exitPayload, payload, sizePayload } from './protocol'

export interface Viewer {
  send(bytes: Uint8Array): void
  close(code: number, reason: string): void
  readonly open: boolean
}

export class Session {
  readonly id = crypto.randomUUID()
  readonly processName: string
  readonly process: Bun.Subprocess
  private screen = createTerminalState(80, 24)
  private output = new TerminalOutput()
  private viewers = new Set<Viewer>()
  private queue: Promise<unknown> = Promise.resolve()
  private closing = false
  private finished = false
  private pendingBytes = 0
  private completion?: Promise<void>

  constructor(
    private exited: (id: string) => void,
    shell = selectShell(),
  ) {
    this.processName = basename(shell)
    const eof = Promise.withResolvers<void>()
    try {
      this.process = Bun.spawn([shell, '-l'], {
        cwd: homedir(),
        env: {
          ...process.env,
          TERM: process.env.TERM || 'xterm-256color',
          COLORTERM: process.env.COLORTERM || 'truecolor',
          SHELL: shell,
        },
        terminal: {
          cols: 80,
          rows: 24,
          data: (_terminal, bytes) => this.receive(bytes),
          exit: () => eof.resolve(),
        },
      })
    } catch (error) {
      this.screen.dispose()
      throw error
    }
    void this.process.exited
      .then(async (code) => {
        // Drain final PTY output before reporting exit. Descendants may retain the slave fd.
        let timer: ReturnType<typeof setTimeout> | undefined
        await Promise.race([
          eof.promise,
          new Promise<void>((resolve) => {
            timer = setTimeout(resolve, 1000)
          }),
        ])
        clearTimeout(timer)
        await this.finish(code)
      })
      .catch((error) => {
        console.error('lin: PTY exit failed', error)
        void this.close()
      })
  }

  private enqueue<T>(operation: () => T | Promise<T>): Promise<T> {
    const result = this.queue.then(operation)
    this.queue = result.catch((error) => {
      console.error('lin: terminal operation failed', error)
      void this.close()
    })
    return result
  }

  private receive(data: Uint8Array) {
    if (this.closing) return
    const bytes = this.output.accept(data)
    if (!bytes.length) return
    this.pendingBytes += bytes.length
    // Bun's PTY reader has no pause API. Bound parser backlog on pathological output.
    if (this.pendingBytes > 16 * 1024 * 1024) {
      console.error('lin: terminal output exceeded parser backlog limit')
      void this.close()
      return
    }
    void this.enqueue(async () => {
      await this.screen.write(bytes)
      this.pendingBytes -= bytes.length
      const replies = this.screen.replies()
      if (replies && !this.process.terminal!.closed) this.process.terminal!.write(replies)
      this.broadcast(payload(0, bytes))
    })
  }

  attach(viewer: Viewer): Promise<void> {
    return this.enqueue(() => {
      if (!viewer.open) return
      if (this.closing) {
        viewer.close(1000, 'shell exited')
        return
      }
      viewer.send(payload(3, this.processName))
      const title = this.screen.title().replace(/[\u0000-\u001f\u007f-\u009f]/g, '')
      viewer.send(
        sizePayload(
          4,
          this.screen.cols,
          this.screen.rows,
          (title ? `\x1b]2;${title}\x07` : '') + this.screen.snapshot(),
        ),
      )
      // No await between snapshot and attachment: later output follows the same parser boundary.
      this.viewers.add(viewer)
    })
  }

  detach(viewer: Viewer) {
    this.viewers.delete(viewer)
  }

  write(bytes: Uint8Array) {
    if (!this.closing && bytes.length) this.process.terminal!.write(bytes)
  }

  resize(cols: number, rows: number): Promise<void> {
    return this.enqueue(() => {
      if (this.closing || (this.screen.cols === cols && this.screen.rows === rows)) return
      this.process.terminal!.resize(cols, rows)
      this.screen.resize(cols, rows)
      this.broadcast(sizePayload(5, cols, rows))
    })
  }

  private broadcast(bytes: Uint8Array) {
    for (const viewer of this.viewers) viewer.send(bytes)
  }

  private finish(code: number): Promise<void> {
    if (this.completion) return this.completion
    this.closing = true
    this.process.terminal!.close()
    this.exited(this.id)
    this.completion = this.enqueue(() => {
      if (this.finished) return
      this.finished = true
      this.broadcast(exitPayload(code))
      for (const viewer of this.viewers) viewer.close(1000, 'shell exited')
      this.viewers.clear()
      this.screen.dispose()
    })
    return this.completion
  }

  async close(): Promise<void> {
    if (!this.closing) {
      // Closing the PTY hangs up its foreground job; also signal the login shell's group.
      try {
        process.kill(-this.process.pid, 'SIGHUP')
      } catch {
        try {
          this.process.kill('SIGHUP')
        } catch {
          /* Already exited. */
        }
      }
    }
    await this.finish(129)
    if (this.process.exitCode === null) {
      const timer = setTimeout(() => {
        try {
          this.process.kill('SIGKILL')
        } catch {
          /* Already exited. */
        }
      }, 1000)
      await this.process.exited
      clearTimeout(timer)
    }
  }
}

function selectShell(): string {
  for (const shell of [process.env.SHELL, '/bin/bash', '/bin/sh']) {
    if (!shell) continue
    try {
      accessSync(shell, constants.X_OK)
      return shell
    } catch {
      /* Try the next shell. */
    }
  }
  throw new Error('no executable login shell found')
}
