import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { Terminal } from '@xterm/xterm'
import { useEventListener, useMutationObserver, useResizeObserver } from '@vueuse/core'
import { defineComponent, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { PropType } from 'vue'
import {
  decodeExitCode,
  decodeProcessName,
  decodeTerminalOutput,
  decodeTerminalSnapshot,
  decodeServerResize,
  encodeTerminalBinaryInput,
  encodeTerminalInput,
  encodeTerminalResize,
} from '#/terminal-protocol.ts'
import { terminalAppearance } from '#/theme/terminal-theme.ts'
import { compactTerminalTitle } from '#/terminal-title.ts'

export type TerminalSessionState = 'connecting' | 'online' | 'offline'
export type ThemeMode = 'auto' | 'light' | 'dark'

export const TerminalPane = defineComponent({
  name: 'TerminalPane',
  props: {
    sessionId: { type: Number, required: true },
    sessionKey: { type: String, required: true },
    active: { type: Boolean, required: true },
    onStateChange: Function as PropType<(state: TerminalSessionState) => void>,
    onTitleChange: Function as PropType<(title: string) => void>,
  },
  setup(props) {
    const frame = ref<HTMLElement | null>(null)
    const host = ref<HTMLElement | null>(null)
    let terminal: Terminal | null = null
    let fitAddon: FitAddon | null = null
    let searchAddon: SearchAddon | null = null
    let socket: WebSocket | null = null
    let fitFrame: number | null = null
    let disposed = false
    let ready = false
    let processExited = false
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined
    let reconnectDelay = 250
    let renderQueue = Promise.resolve()
    const searchOpen = ref(false)
    const searchTerm = ref('')
    const searchInput = ref<HTMLInputElement | null>(null)
    let processName = 'shell'

    const send = (message: Uint8Array<ArrayBuffer>): void => {
      if (ready && socket?.readyState === WebSocket.OPEN) socket.send(message)
    }

    const fit = (): void => {
      if (disposed || !ready || !props.active || !terminal || !fitAddon || socket?.readyState !== WebSocket.OPEN) return
      try {
        fitAddon.fit()
        send(encodeTerminalResize(terminal.cols, terminal.rows))
      } catch {
        // ResizeObserver will retry after the next stable layout.
      }
    }

    const scheduleFit = (): void => {
      if (fitFrame != null) cancelAnimationFrame(fitFrame)
      fitFrame = requestAnimationFrame(() => {
        fitFrame = null
        fit()
      })
    }

    const focus = (): void => {
      nextTick(() => {
        scheduleFit()
        terminal?.focus()
      })
    }

    const closeSearch = (): void => {
      searchOpen.value = false
      searchTerm.value = ''
      searchAddon?.clearDecorations()
      focus()
    }

    useResizeObserver(frame, scheduleFit)
    watch(
      () => props.active,
      (active) => {
        if (active) focus()
      },
    )

    useEventListener(
      window,
      'keydown',
      (event) => {
        if (!props.active || !(event.ctrlKey || event.metaKey) || !event.shiftKey || event.altKey) return
        if (event.key.toLowerCase() === 'f') {
          event.preventDefault()
          searchOpen.value = true
          void nextTick(() => searchInput.value?.focus())
        }
      },
      { capture: true },
    )

    const connect = (): void => {
      if (disposed || processExited) return
      ready = false
      props.onStateChange?.('connecting')
      const connection = new WebSocket(webSocketUrl(props.sessionKey))
      socket = connection
      connection.binaryType = 'arraybuffer'
      connection.addEventListener('message', (event) => {
        if (socket !== connection || disposed || !(event.data instanceof ArrayBuffer) || !terminal) return
        const bytes = new Uint8Array(event.data)
        renderQueue = renderQueue
          .then(async () => {
            if (socket !== connection || disposed || !terminal) return
            const write = (data: string | Uint8Array<ArrayBufferLike>): Promise<void> =>
              new Promise((resolve) => terminal!.write(data, resolve))
            const size = decodeServerResize(bytes)
            const snapshot = decodeTerminalSnapshot(bytes)
            const exitCode = decodeExitCode(bytes)
            const metadata = decodeProcessName(bytes)
            if (snapshot) {
              terminal.reset()
              terminal.resize(snapshot.cols, snapshot.rows)
              await write(snapshot.content)
              if (socket !== connection || disposed || processExited || connection.readyState !== WebSocket.OPEN) return
              ready = true
              reconnectDelay = 250
              props.onStateChange?.('online')
              scheduleFit()
              if (props.active) focus()
            } else if (size) {
              // Keep all viewers on the server's geometry, after preceding output.
              terminal.resize(size.cols, size.rows)
            } else if (exitCode != null) {
              processExited = true
              ready = false
              props.onStateChange?.('offline')
              await write(`\r\n\x1b[2m[process exited ${exitCode}]\x1b[0m\r\n`)
            } else if (metadata != null) {
              processName = metadata
              props.onTitleChange?.(compactTerminalTitle(processName))
            } else {
              const output = decodeTerminalOutput(bytes)
              if (output) await write(output)
            }
          })
          .catch(() => connection.close())
      })
      connection.addEventListener('close', () => {
        if (socket !== connection || disposed) return
        ready = false
        props.onStateChange?.('offline')
        if (!processExited) {
          reconnectTimer = setTimeout(connect, reconnectDelay)
          reconnectDelay = Math.min(reconnectDelay * 2, 5000)
        }
      })
      connection.addEventListener('error', () => connection.close())
    }

    onMounted(() => {
      if (!host.value) throw new Error('terminal host missing')
      terminal = new Terminal({
        allowProposedApi: true,
        cursorBlink: true,
        cursorStyle: 'bar',
        ...terminalAppearance(),
        minimumContrastRatio: 4.5,
        rescaleOverlappingGlyphs: true,
        scrollback: 10_000,
        scrollOnUserInput: true,
      })
      fitAddon = new FitAddon()
      terminal.loadAddon(fitAddon)
      searchAddon = new SearchAddon()
      terminal.loadAddon(searchAddon)
      terminal.open(host.value)
      // The server terminal answers device queries even while no browser is attached.
      for (const id of [
        { final: 'c' },
        { prefix: '>', final: 'c' },
        { final: 'n' },
        { prefix: '?', final: 'n' },
        { intermediates: '$', final: 'p' },
        { prefix: '?', intermediates: '$', final: 'p' },
      ])
        terminal.parser.registerCsiHandler(id, () => true)
      terminal.parser.registerDcsHandler({ intermediates: '$', final: 'q' }, () => true)

      terminal.onData((data) => send(encodeTerminalInput(data)))
      terminal.onBinary((data) => send(encodeTerminalBinaryInput(data)))
      terminal.onTitleChange((title) => {
        const clean = compactTerminalTitle(title.replace(/[\u0000-\u001f\u007f]/g, ''))
        if (clean) props.onTitleChange?.(clean)
      })
      connect()
      if (props.active) focus()
    })
    useMutationObserver(
      document.documentElement,
      () => {
        if (terminal) terminal.options.theme = terminalAppearance().theme
      },
      { attributes: true, attributeFilter: ['data-theme'] },
    )

    onBeforeUnmount(() => {
      disposed = true
      clearTimeout(reconnectTimer)
      if (fitFrame != null) cancelAnimationFrame(fitFrame)
      socket?.close(1000, 'view detached')
      terminal?.dispose()
      socket = null
      terminal = null
      fitAddon = null
      searchAddon = null
    })

    return () => (
      <section ref={frame} class="terminal-frame" aria-label={`Terminal ${props.sessionId}`}>
        <div ref={host} class="terminal-host" />
        {searchOpen.value ? (
          <div class="terminal-search" role="search">
            <input
              ref={searchInput}
              value={searchTerm.value}
              aria-label="Search terminal"
              placeholder="Search terminal…"
              onInput={(event) => {
                searchTerm.value = (event.currentTarget as HTMLInputElement).value
                if (searchTerm.value) searchAddon?.findNext(searchTerm.value)
                else searchAddon?.clearDecorations()
              }}
              onKeydown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  if (searchTerm.value)
                    event.shiftKey
                      ? searchAddon?.findPrevious(searchTerm.value)
                      : searchAddon?.findNext(searchTerm.value)
                } else if (event.key === 'Escape') {
                  event.preventDefault()
                  closeSearch()
                }
              }}
            />
            <button
              type="button"
              aria-label="Previous match"
              onClick={() => searchTerm.value && searchAddon?.findPrevious(searchTerm.value)}
            >
              ↑
            </button>
            <button
              type="button"
              aria-label="Next match"
              onClick={() => searchTerm.value && searchAddon?.findNext(searchTerm.value)}
            >
              ↓
            </button>
            <button type="button" aria-label="Close search" onClick={closeSearch}>
              ×
            </button>
          </div>
        ) : null}
      </section>
    )
  },
})

function webSocketUrl(sessionKey: string): string {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${location.host}/ws?session=${encodeURIComponent(sessionKey)}`
}
