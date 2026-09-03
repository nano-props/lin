import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { Terminal } from '@xterm/xterm'
import { useEventListener, useResizeObserver } from '@vueuse/core'
import { defineComponent, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { PropType } from 'vue'
import { TerminalComposer } from '#/TerminalComposer.tsx'
import type { ComposerMode, VirtualKey } from '#/TerminalComposer.tsx'
import { uploadTempFile } from '#/temp-file-upload.ts'
import {
  decodeExitCode,
  decodeTerminalOutput,
  encodeTerminalBinaryInput,
  encodeTerminalInput,
  encodeTerminalResize,
} from '#/terminal-protocol.ts'

export type TerminalSessionState = 'connecting' | 'online' | 'offline'

const terminalTheme = {
  background: '#10120f',
  foreground: '#d9ddd4',
  cursor: '#c6f36b',
  cursorAccent: '#10120f',
  selectionBackground: '#647a4266',
  black: '#20231e',
  red: '#ef746f',
  green: '#9ccc65',
  yellow: '#e5c76b',
  blue: '#70a5eb',
  magenta: '#c795e8',
  cyan: '#67c7bd',
  white: '#c9cec3',
  brightBlack: '#687064',
  brightRed: '#ff8983',
  brightGreen: '#b9e77e',
  brightYellow: '#f3d984',
  brightBlue: '#8bbaff',
  brightMagenta: '#d9a8fa',
  brightCyan: '#83ddd2',
  brightWhite: '#f0f3ed',
}

export const TerminalPane = defineComponent({
  name: 'TerminalPane',
  props: {
    sessionId: { type: Number, required: true },
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
    const composerExpanded = ref(false)
    const composerMode = ref<ComposerMode>('input')
    const composerDraft = ref('')
    const composerHistory = ref<string[]>([])
    const searchOpen = ref(false)
    const searchTerm = ref('')
    const searchInput = ref<HTMLInputElement | null>(null)
    const dragging = ref(false)

    const send = (message: Uint8Array<ArrayBuffer>): void => {
      if (socket?.readyState === WebSocket.OPEN) socket.send(message)
    }

    const writeText = async (text: string): Promise<boolean> => {
      if (!text || socket?.readyState !== WebSocket.OPEN) return false
      send(encodeTerminalInput(text))
      return true
    }

    const uploadDroppedFiles = async (files: File[]): Promise<void> => {
      if (!files.length) return
      composerExpanded.value = true
      composerMode.value = 'input'
      try {
        const paths: string[] = []
        for (const file of files) paths.push(await uploadTempFile(file))
        const prefix = composerDraft.value && !/\s$/.test(composerDraft.value) ? `${composerDraft.value} ` : composerDraft.value
        composerDraft.value = `${prefix}${paths.join(' ')}`
      } catch (error) {
        composerDraft.value = `${composerDraft.value}${composerDraft.value ? ' ' : ''}[upload failed: ${error instanceof Error ? error.message : 'unknown error'}]`
      }
    }

    const sendVirtualKey = (key: VirtualKey): void => {
      const applicationCursor = terminal?.modes.applicationCursorKeysMode ?? false
      const cursorPrefix = applicationCursor ? '\x1bO' : '\x1b['
      const values: Record<VirtualKey, string> = {
        enter: '\r', backspace: '\x7f', tab: '\t', escape: '\x1b', 'clear-screen': '\x0c',
        interrupt: '\x03', eof: '\x04', 'arrow-up': `${cursorPrefix}A`, 'arrow-down': `${cursorPrefix}B`,
        'arrow-left': `${cursorPrefix}D`, 'arrow-right': `${cursorPrefix}C`,
      }
      send(encodeTerminalInput(values[key]))
    }

    const fit = (): void => {
      if (disposed || !props.active || !terminal || !fitAddon || socket?.readyState !== WebSocket.OPEN) return
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

    useEventListener(window, 'keydown', (event) => {
      if (!props.active || !(event.ctrlKey || event.metaKey) || !event.shiftKey || event.altKey) return
      if (event.key.toLowerCase() === 'f') {
        event.preventDefault()
        searchOpen.value = true
        void nextTick(() => searchInput.value?.focus())
      } else if (event.key === 'Enter') {
        event.preventDefault()
        composerExpanded.value = true
      }
    }, { capture: true })

    onMounted(() => {
      if (!host.value) throw new Error('terminal host missing')
      terminal = new Terminal({
        allowProposedApi: true,
        cursorBlink: true,
        cursorStyle: 'bar',
        fontFamily: "'Maple Mono', 'Cascadia Code', 'SFMono-Regular', monospace",
        fontSize: 14,
        lineHeight: 1.08,
        minimumContrastRatio: 4.5,
        rescaleOverlappingGlyphs: true,
        scrollback: 10_000,
        scrollOnUserInput: true,
        theme: terminalTheme,
      })
      fitAddon = new FitAddon()
      terminal.loadAddon(fitAddon)
      searchAddon = new SearchAddon()
      terminal.loadAddon(searchAddon)
      terminal.open(host.value)

      socket = new WebSocket(webSocketUrl())
      socket.binaryType = 'arraybuffer'
      terminal.onData((data) => send(encodeTerminalInput(data)))
      terminal.onBinary((data) => send(encodeTerminalBinaryInput(data)))
      terminal.onTitleChange((title) => {
        const clean = title.trim().replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 80)
        if (clean) props.onTitleChange?.(clean)
      })
      socket.addEventListener('open', () => {
        props.onStateChange?.('online')
        scheduleFit()
        if (props.active) focus()
      })
      socket.addEventListener('message', (event) => {
        if (!(event.data instanceof ArrayBuffer) || !terminal) return
        const bytes = new Uint8Array(event.data)
        const exitCode = decodeExitCode(bytes)
        if (exitCode != null) {
          terminal.write(`\r\n\x1b[38;2;104;112;100m[process exited ${exitCode}]\x1b[0m\r\n`)
        } else {
          const output = decodeTerminalOutput(bytes)
          if (output) terminal.write(output)
        }
      })
      socket.addEventListener('close', () => {
        if (!disposed) props.onStateChange?.('offline')
      })
      socket.addEventListener('error', () => props.onStateChange?.('offline'))
      if (props.active) focus()
    })

    onBeforeUnmount(() => {
      disposed = true
      if (fitFrame != null) cancelAnimationFrame(fitFrame)
      socket?.close(1000, 'tab closed')
      terminal?.dispose()
      socket = null
      terminal = null
      fitAddon = null
      searchAddon = null
    })

    return () => (
      <section
        ref={frame}
        class={['terminal-frame', dragging.value && 'terminal-frame--dragging']}
        aria-label={`Terminal ${props.sessionId}`}
        onDragover={(event) => { event.preventDefault(); dragging.value = true }}
        onDragleave={(event) => { if (event.currentTarget === event.target) dragging.value = false }}
        onDrop={(event) => { event.preventDefault(); dragging.value = false; void uploadDroppedFiles(Array.from(event.dataTransfer?.files ?? [])) }}
      >
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
                  if (searchTerm.value) event.shiftKey ? searchAddon?.findPrevious(searchTerm.value) : searchAddon?.findNext(searchTerm.value)
                } else if (event.key === 'Escape') {
                  event.preventDefault()
                  closeSearch()
                }
              }}
            />
            <button type="button" aria-label="Previous match" onClick={() => searchTerm.value && searchAddon?.findPrevious(searchTerm.value)}>↑</button>
            <button type="button" aria-label="Next match" onClick={() => searchTerm.value && searchAddon?.findNext(searchTerm.value)}>↓</button>
            <button type="button" aria-label="Close search" onClick={closeSearch}>×</button>
          </div>
        ) : null}
        <TerminalComposer
          expanded={composerExpanded.value}
          mode={composerMode.value}
          draft={composerDraft.value}
          historyEntries={composerHistory.value}
          onVirtualKey={sendVirtualKey}
          onCopyContent={async () => {
            const selection = terminal?.getSelection() ?? ''
            if (!selection) return
            try { await navigator.clipboard.writeText(selection) } catch { /* clipboard permission is optional */ }
          }}
          onSendText={(text) => writeText(text)}
          onSubmitText={async (text) => {
            const accepted = await writeText(`${text}\r`)
            if (accepted) composerHistory.value = [...composerHistory.value.slice(-49), text]
            return accepted
          }}
          onOpen={() => { composerExpanded.value = true; return true }}
          onClose={() => { composerExpanded.value = false; return true }}
          onModeChange={(mode) => { composerMode.value = mode; return true }}
          onDraftChange={(draft) => { composerDraft.value = draft; return true }}
          onUploadFile={(file) => uploadTempFile(file)}
        />
      </section>
    )
  },
})

function webSocketUrl(): string {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${location.host}/ws`
}
