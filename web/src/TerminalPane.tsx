import { WebLinksAddon } from '@xterm/addon-web-links'
import { suppressTerminalReplies } from '#/terminal-replies.ts'
import {
  isImeOwnedKeyboardEvent,
  isMacNavigatorPlatform,
  SafariShiftKeyResolver,
  terminalInputForMacOptionArrow,
  terminalInputForVirtualKey,
} from '#/terminal-keyboard.ts'
import type { TerminalVirtualKey } from '#/terminal-keyboard.ts'
import { installTerminalTouchScroll } from '#/terminal-touch-scroll.ts'
import { installTerminalViewportReveal, terminalInputRevealRow } from '#/terminal-viewport-reveal.ts'
import { pasteFilesInsteadOfText, uploadTerminalFiles } from '#/terminal-files.ts'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { Terminal } from '@xterm/xterm'
import { useEventListener, useMutationObserver, useResizeObserver } from '@vueuse/core'
import { defineComponent, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { PropType } from 'vue'
import {
  decodeExitCode,
  decodeTerminalControl,
  encodeTerminalTheme,
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

export type ThemeMode = 'auto' | 'light' | 'dark'

export const TerminalPane = defineComponent({
  name: 'TerminalPane',
  props: {
    sessionId: { type: Number, required: true },
    sessionKey: { type: String, required: true },
    active: { type: Boolean, required: true },
    onError: Function as PropType<(message: string) => void>,
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
    const controlling = ref(false)
    const connected = ref(false)
    const uploading = ref(false)
    const fileInput = ref<HTMLInputElement | null>(null)
    const disposables: { dispose(): void }[] = []
    let viewerId = ''
    let controlRevision = 0
    let uploadAbort: AbortController | undefined
    let presentationReady = false
    const searchOpen = ref(false)
    const searchTerm = ref('')
    const searchInput = ref<HTMLInputElement | null>(null)
    let processName = 'shell'

    const send = (message: Uint8Array<ArrayBuffer>): void => {
      if (ready && controlling.value && props.active && socket?.readyState === WebSocket.OPEN) socket.send(message)
    }

    const fit = (): void => {
      if (
        disposed ||
        !ready ||
        !controlling.value ||
        !props.active ||
        !terminal ||
        !fitAddon ||
        socket?.readyState !== WebSocket.OPEN
      )
        return
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
        if (!disposed && props.active && ready && controlling.value && !searchOpen.value && document.hasFocus())
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
        if (terminal) terminal.options.disableStdin = !active || !ready || !controlling.value
        if (active) focus()
        else terminal?.blur()
      },
    )

    useEventListener(
      window,
      'keydown',
      (event) => {
        if (
          isImeOwnedKeyboardEvent(event) ||
          !props.active ||
          !(event.ctrlKey || event.metaKey) ||
          !event.shiftKey ||
          event.altKey
        )
          return
        if (event.key.toLowerCase() === 'f') {
          event.preventDefault()
          searchOpen.value = true
          void nextTick(() => searchInput.value?.focus())
        }
      },
      { capture: true },
    )

    const syncTheme = () => {
      if (ready && controlling.value && socket?.readyState === WebSocket.OPEN)
        socket.send(encodeTerminalTheme(terminalAppearance().theme))
    }

    const takeControl = () => {
      if (ready && socket?.readyState === WebSocket.OPEN) socket.send(new Uint8Array([2]))
    }

    const pasteFiles = async (files: File[]) => {
      if (!ready || !controlling.value || !props.active || uploading.value) {
        props.onError?.('Take control of this terminal and wait for the current upload before pasting files.')
        return
      }
      const connection = socket
      const revision = controlRevision
      const abort = new AbortController()
      uploadAbort = abort
      uploading.value = true
      try {
        const paths = await uploadTerminalFiles(files, props.sessionKey, viewerId, abort.signal)
        if (
          disposed ||
          socket !== connection ||
          revision !== controlRevision ||
          !ready ||
          !controlling.value ||
          !props.active
        )
          throw new Error('Terminal control changed. Paste the files again.')
        terminal?.paste(paths)
        props.onError?.('')
        focus()
      } catch (error) {
        if (!disposed) props.onError?.(error instanceof Error ? error.message : 'Unable to upload files.')
      } finally {
        uploading.value = false
        if (uploadAbort === abort) uploadAbort = undefined
      }
    }

    const paste = (event: ClipboardEvent) => {
      const data = event.clipboardData
      if (!data || !pasteFilesInsteadOfText(data.getData('text/plain'), data.files.length > 0)) return
      event.preventDefault()
      event.stopPropagation()
      void pasteFiles(Array.from(data.files))
    }

    useEventListener(frame, 'paste', paste, { capture: true })

    const drop = (event: DragEvent) => {
      event.preventDefault()
      event.stopPropagation()
      if (event.dataTransfer?.files.length) void pasteFiles(Array.from(event.dataTransfer.files))
    }

    const virtualKey = (key: TerminalVirtualKey) => {
      if (ready && controlling.value && props.active && terminal) {
        terminal.input(terminalInputForVirtualKey(key, terminal.modes.applicationCursorKeysMode), true)
        focus()
      }
    }

    const openLink = (event: MouseEvent, uri: string) => {
      event.preventDefault()
      try {
        const url = new URL(uri)
        if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only HTTP and HTTPS links can be opened.')
        window.open(url.href, '_blank', 'noopener,noreferrer')
      } catch (error) {
        props.onError?.(error instanceof Error ? error.message : 'Unable to open link.')
      }
    }

    const connect = (): void => {
      if (disposed || processExited) return
      ready = false
      presentationReady = false
      connected.value = false
      controlling.value = false
      if (terminal) terminal.options.disableStdin = true
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
            const control = decodeTerminalControl(bytes)
            const size = decodeServerResize(bytes)
            const snapshot = decodeTerminalSnapshot(bytes)
            const exitCode = decodeExitCode(bytes)
            const metadata = decodeProcessName(bytes)
            if (control) {
              viewerId = control.viewer
              controlling.value = control.control
              controlRevision++
              if (!control.control) uploadAbort?.abort()
              ready = presentationReady
              terminal.options.disableStdin = !ready || !control.control || !props.active
              if (ready && control.control) {
                syncTheme()
                scheduleFit()
                if (props.active) focus()
              }
            } else if (bytes[0] === 7) {
              props.onError?.(new TextDecoder().decode(bytes.subarray(1)))
            } else if (snapshot) {
              ready = false
              terminal.options.disableStdin = true
              terminal.reset()
              terminal.resize(snapshot.cols, snapshot.rows)
              await write(snapshot.content)
              if (socket !== connection || disposed || processExited || connection.readyState !== WebSocket.OPEN) return
              presentationReady = true
              connected.value = true
              reconnectDelay = 250
              props.onError?.('')
              scheduleFit()
              if (props.active) focus()
            } else if (size) {
              // Keep all viewers on the server's geometry, after preceding output.
              terminal.resize(size.cols, size.rows)
            } else if (exitCode != null) {
              processExited = true
              ready = false
              connected.value = false
              terminal.options.disableStdin = true
              props.onError?.(exitCode === 0 ? '' : `Terminal process exited with code ${exitCode}.`)
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
        connected.value = false
        controlling.value = false
        controlRevision++
        uploadAbort?.abort()
        if (terminal) terminal.options.disableStdin = true
        if (!processExited) {
          props.onError?.('Terminal connection lost. Retrying…')
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
        macOptionIsMeta: true,
        disableStdin: true,
        linkHandler: { activate: openLink, allowNonHttpProtocols: false },
      })
      terminal.loadAddon(new Unicode11Addon())
      terminal.unicode.activeVersion = '11'
      fitAddon = new FitAddon()
      terminal.loadAddon(fitAddon)
      searchAddon = new SearchAddon()
      terminal.loadAddon(searchAddon)
      terminal.open(host.value)
      suppressTerminalReplies(terminal)
      terminal.loadAddon(new WebLinksAddon(openLink))
      const current = terminal
      const safari = new SafariShiftKeyResolver()
      current.attachCustomKeyEventHandler((event) => {
        if (isImeOwnedKeyboardEvent(event)) return true
        if (
          !event.altKey &&
          (event.ctrlKey || event.metaKey) &&
          (event.key.toLowerCase() === 't' ||
            event.key.toLowerCase() === 'w' ||
            /^[1-9]$/.test(event.key) ||
            (event.shiftKey && event.key.toLowerCase() === 'f'))
        )
          return false
        const input =
          terminalInputForMacOptionArrow(event, {
            isMac: isMacNavigatorPlatform(navigator.platform),
            applicationCursorKeysMode: current.modes.applicationCursorKeysMode,
          }) ?? safari.inputForEvent(event)
        if (!input) return true
        event.preventDefault()
        event.stopPropagation()
        current.input(input, true)
        return false
      })
      const lineHeight = () =>
        (host.value?.getBoundingClientRect().height ?? 0) / current.rows ||
        (current.options.fontSize ?? 13) * (current.options.lineHeight ?? 1)
      if (current.element)
        disposables.push(
          installTerminalTouchScroll({
            element: current.element,
            shouldHandle: () => current.buffer.active.type === 'normal' && current.modes.mouseTrackingMode === 'none',
            getLineHeight: lineHeight,
            scrollLines: (lines) => current.scrollLines(lines),
          }),
        )
      if (current.element && current.textarea && window.visualViewport)
        disposables.push(
          installTerminalViewportReveal({
            element: current.element,
            textarea: current.textarea,
            visualViewport: window.visualViewport,
            onTerminalResize: (listener) => current.onResize(listener),
            getLineHeight: lineHeight,
            getCursorRow: () => terminalInputRevealRow(current.buffer.active, current.rows),
          }),
        )

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
        syncTheme()
      },
      { attributes: true, attributeFilter: ['data-theme'] },
    )

    onBeforeUnmount(() => {
      disposed = true
      uploadAbort?.abort()
      for (const disposable of disposables) disposable.dispose()
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
      <section
        ref={frame}
        class="terminal-frame"
        aria-label={`Terminal ${props.sessionId}`}
        onDragover={(event) => {
          if (event.dataTransfer?.types.includes('Files')) event.preventDefault()
        }}
        onDrop={drop}
      >
        {connected.value && !controlling.value ? (
          <div class="terminal-control" role="status">
            <span>Read-only window</span>
            <button type="button" onClick={takeControl}>
              Take control
            </button>
          </div>
        ) : null}
        {uploading.value ? (
          <div class="terminal-upload" role="status">
            Uploading files…
          </div>
        ) : null}
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          aria-label="Upload files"
          onChange={(event) => {
            const input = event.currentTarget as HTMLInputElement
            const files = Array.from(input.files ?? [])
            input.value = ''
            if (files.length) void pasteFiles(files)
          }}
        />
        <div class="terminal-mobile-keys" aria-label="Terminal keys">
          {(
            [
              ['escape', 'Esc'],
              ['tab', 'Tab'],
              ['interrupt', 'Ctrl C'],
              ['arrow-up', '↑'],
              ['arrow-down', '↓'],
              ['arrow-left', '←'],
              ['arrow-right', '→'],
            ] as const
          ).map(([key, label]) => (
            <button
              type="button"
              disabled={!connected.value || !controlling.value}
              onPointerdown={(event) => event.preventDefault()}
              onClick={() => virtualKey(key)}
            >
              {label}
            </button>
          ))}
          <button
            type="button"
            disabled={!connected.value || !controlling.value || uploading.value}
            onClick={() => fileInput.value?.click()}
          >
            File
          </button>
        </div>
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
