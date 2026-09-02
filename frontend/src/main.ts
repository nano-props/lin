import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import './style.css'

const token = new URLSearchParams(window.location.search).get('token')
const app = document.querySelector<HTMLElement>('#app')
if (!app) throw new Error('missing application host')

app.innerHTML = `
  <section class="shell" aria-label="lin web terminal">
    <header class="topbar">
      <div class="identity" aria-label="lin">
        <span class="identity__mark" aria-hidden="true">λ</span>
        <span class="identity__name">lin</span>
      </div>
      <div class="tabs" role="tablist" aria-label="Terminal sessions"></div>
      <button class="new-tab" type="button" aria-label="New terminal" title="New terminal (Ctrl/⌘ T)">
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10" /></svg>
      </button>
      <div class="connection" title="Local, token-protected connection">
        <span class="connection__dot"></span>
        <span>local</span>
      </div>
    </header>
    <div class="terminals"></div>
    <div class="fatal" hidden>
      <span class="fatal__eyebrow">ACCESS REQUIRED</span>
      <h1>Open lin from its launch URL.</h1>
      <p>The terminal URL includes a one-time local access token printed by the server.</p>
    </div>
  </section>
`

const tabsHost = requiredElement<HTMLElement>('.tabs')
const terminalsHost = requiredElement<HTMLElement>('.terminals')
const newTabButton = requiredElement<HTMLButtonElement>('.new-tab')
const connection = requiredElement<HTMLElement>('.connection')
const fatal = requiredElement<HTMLElement>('.fatal')

type SessionState = 'connecting' | 'online' | 'offline'

interface TerminalTab {
  id: number
  title: string
  button: HTMLButtonElement
  frame: HTMLElement
  terminal: Terminal
  fitAddon: FitAddon
  socket: WebSocket
  resizeObserver: ResizeObserver
  state: SessionState
  disposed: boolean
}

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

const sessions: TerminalTab[] = []
let activeId: number | null = null
let nextId = 1

if (!token) {
  fatal.hidden = false
  terminalsHost.hidden = true
  newTabButton.disabled = true
  connection.classList.add('connection--offline')
} else {
  history.replaceState(null, '', `${location.pathname}?token=${encodeURIComponent(token)}`)
  createTerminal()
}

newTabButton.addEventListener('click', createTerminal)
window.addEventListener('keydown', (event) => {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return
  const key = event.key.toLowerCase()
  if (key === 't') {
    event.preventDefault()
    createTerminal()
    return
  }
  if (key === 'w') {
    const active = sessions.find((session) => session.id === activeId)
    if (active) {
      event.preventDefault()
      closeTerminal(active)
    }
    return
  }
  const index = Number.parseInt(event.key, 10) - 1
  const session = sessions[index]
  if (index >= 0 && index <= 8 && session) {
    event.preventDefault()
    activateTerminal(session.id)
  }
})

function createTerminal(): void {
  if (!token) return
  const id = nextId++
  const frame = document.createElement('section')
  frame.className = 'terminal-frame'
  frame.setAttribute('role', 'tabpanel')
  frame.setAttribute('aria-label', `Terminal ${id}`)

  const terminalHost = document.createElement('div')
  terminalHost.className = 'terminal-host'
  frame.append(terminalHost)
  terminalsHost.append(frame)

  const terminal = new Terminal({
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
  const fitAddon = new FitAddon()
  terminal.loadAddon(fitAddon)
  terminal.open(terminalHost)

  const socket = new WebSocket(webSocketUrl(token))
  socket.binaryType = 'arraybuffer'

  const button = createTabButton(id)
  const session: TerminalTab = {
    id,
    title: `shell ${id}`,
    button,
    frame,
    terminal,
    fitAddon,
    socket,
    resizeObserver: new ResizeObserver(() => fitSession(session)),
    state: 'connecting',
    disposed: false,
  }
  sessions.push(session)
  tabsHost.append(button)
  session.resizeObserver.observe(frame)

  button.addEventListener('click', () => activateTerminal(id))
  button.querySelector<HTMLButtonElement>('.tab__close')?.addEventListener('click', (event) => {
    event.stopPropagation()
    closeTerminal(session)
  })

  terminal.onData((data) => sendInput(session, data))
  terminal.onBinary((data) => sendInput(session, data))
  terminal.onTitleChange((title) => {
    const clean = title.trim().replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 80)
    if (clean) {
      session.title = clean
      updateTab(session)
    }
  })

  socket.addEventListener('open', () => {
    session.state = 'online'
    updateTab(session)
    fitSession(session)
  })
  socket.addEventListener('message', (event) => {
    if (!(event.data instanceof ArrayBuffer)) return
    const bytes = new Uint8Array(event.data)
    if (bytes[0] === 2 && bytes.length === 5) {
      const exitCode = new DataView(bytes.buffer, bytes.byteOffset + 1, 4).getInt32(0)
      terminal.write(`\r\n\x1b[38;2;104;112;100m[process exited ${exitCode}]\x1b[0m\r\n`)
      return
    }
    terminal.write(bytes)
  })
  socket.addEventListener('close', () => {
    if (session.disposed) return
    session.state = 'offline'
    updateTab(session)
  })
  socket.addEventListener('error', () => {
    session.state = 'offline'
    updateTab(session)
  })

  activateTerminal(id)
  updateConnectionState()
}

function createTabButton(id: number): HTMLButtonElement {
  const button = document.createElement('button')
  button.className = 'tab'
  button.type = 'button'
  button.setAttribute('role', 'tab')
  button.innerHTML = `
    <span class="tab__state" aria-hidden="true"></span>
    <span class="tab__title">shell ${id}</span>
    <span class="tab__close" role="button" aria-label="Close terminal" title="Close terminal">
      <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4.5 4.5 7 7m0-7-7 7" /></svg>
    </span>
  `
  return button
}

function activateTerminal(id: number): void {
  activeId = id
  for (const session of sessions) {
    const active = session.id === id
    session.button.classList.toggle('tab--active', active)
    session.button.setAttribute('aria-selected', String(active))
    session.frame.classList.toggle('terminal-frame--active', active)
  }
  const session = sessions.find((item) => item.id === id)
  if (!session) return
  requestAnimationFrame(() => {
    fitSession(session)
    session.terminal.focus()
    session.button.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  })
}

function closeTerminal(session: TerminalTab): void {
  if (session.disposed) return
  session.disposed = true
  const index = sessions.indexOf(session)
  session.socket.close(1000, 'tab closed')
  session.resizeObserver.disconnect()
  session.terminal.dispose()
  session.button.remove()
  session.frame.remove()
  sessions.splice(index, 1)

  if (activeId === session.id) {
    const replacement = sessions[Math.min(index, sessions.length - 1)]
    activeId = null
    if (replacement) activateTerminal(replacement.id)
  }
  if (sessions.length === 0) createTerminal()
  updateConnectionState()
}

function sendInput(session: TerminalTab, data: string): void {
  if (session.socket.readyState !== WebSocket.OPEN) return
  const encoded = new TextEncoder().encode(data)
  const message = new Uint8Array(encoded.length + 1)
  message[0] = 0
  message.set(encoded, 1)
  session.socket.send(message)
}

function fitSession(session: TerminalTab): void {
  if (session.disposed || activeId !== session.id || session.socket.readyState !== WebSocket.OPEN) return
  try {
    session.fitAddon.fit()
    const message = new Uint8Array(5)
    const view = new DataView(message.buffer)
    message[0] = 1
    view.setUint16(1, session.terminal.cols)
    view.setUint16(3, session.terminal.rows)
    session.socket.send(message)
  } catch {
    // A later ResizeObserver delivery will retry after layout stabilizes.
  }
}

function updateTab(session: TerminalTab): void {
  const title = session.button.querySelector<HTMLElement>('.tab__title')
  if (title) title.textContent = session.title
  session.button.dataset.state = session.state
  session.button.title = `${session.title} · ${session.state}`
  updateConnectionState()
}

function updateConnectionState(): void {
  const online = sessions.some((session) => session.state === 'online')
  const connecting = sessions.some((session) => session.state === 'connecting')
  connection.classList.toggle('connection--offline', !online && !connecting)
  const label = connection.querySelector<HTMLElement>('span:last-child')
  if (label) label.textContent = online ? 'local' : connecting ? 'linking' : 'offline'
}

function webSocketUrl(accessToken: string): string {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${location.host}/ws?token=${encodeURIComponent(accessToken)}`
}

function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector)
  if (!element) throw new Error(`missing element: ${selector}`)
  return element
}
