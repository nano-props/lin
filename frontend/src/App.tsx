import { Plus } from '@lucide/vue'
import { useEventListener } from '@vueuse/core'
import { computed, defineComponent, nextTick, onMounted, ref } from 'vue'
import type { PropType } from 'vue'
import { TerminalPane } from './TerminalPane.tsx'
import type { TerminalSessionState } from './TerminalPane.tsx'
import { Tip } from './Tip.tsx'
import { ToolbarClosableTab } from './ToolbarClosableTab.tsx'

interface TerminalTab {
  id: number
  title: string
  state: TerminalSessionState
}

export const App = defineComponent({
  name: 'App',
  setup() {
    const authenticated = ref(false)
    const checkingAuth = ref(true)
    const tabs = ref<TerminalTab[]>([])
    const activeId = ref('')
    let nextId = 1

    const connectionState = computed<TerminalSessionState>(() => {
      if (tabs.value.some((tab) => tab.state === 'online')) return 'online'
      if (tabs.value.some((tab) => tab.state === 'connecting')) return 'connecting'
      return 'offline'
    })

    const createTerminal = (): void => {
      if (!authenticated.value) return
      const id = nextId++
      tabs.value.push({ id, title: `shell ${id}`, state: 'connecting' })
      activeId.value = String(id)
      nextTick(() => {
        document.querySelector<HTMLElement>(`[data-terminal-tab="${id}"]`)?.scrollIntoView({
          block: 'nearest',
          inline: 'nearest',
        })
      })
    }

    const closeTerminal = (id: number): void => {
      const index = tabs.value.findIndex((tab) => tab.id === id)
      if (index < 0) return
      const wasActive = activeId.value === String(id)
      tabs.value.splice(index, 1)
      if (wasActive) {
        const replacement = tabs.value[Math.min(index, tabs.value.length - 1)]
        activeId.value = replacement ? String(replacement.id) : ''
      }
      if (tabs.value.length === 0) createTerminal()
    }

    const updateTab = (id: number, update: Partial<Pick<TerminalTab, 'title' | 'state'>>): void => {
      const tab = tabs.value.find((candidate) => candidate.id === id)
      if (tab) Object.assign(tab, update)
    }

    useEventListener(window, 'keydown', (event) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return
      const key = event.key.toLowerCase()
      if (key === 't') {
        event.preventDefault()
        createTerminal()
        return
      }
      if (key === 'w') {
        const id = Number(activeId.value)
        if (id) {
          event.preventDefault()
          closeTerminal(id)
        }
        return
      }
      const index = Number.parseInt(event.key, 10) - 1
      const tab = tabs.value[index]
      if (index >= 0 && index <= 8 && tab) {
        event.preventDefault()
        activeId.value = String(tab.id)
      }
    })

    onMounted(async () => {
      const token = new URLSearchParams(location.search).get('token')?.trim()
      if (token) history.replaceState(null, '', `${location.pathname}${location.hash}`)
      try {
        const response = token
          ? await fetch('/api/auth', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'text/plain' }, body: token })
          : await fetch('/api/auth/status', { credentials: 'same-origin' })
        authenticated.value = response.ok
      } finally {
        checkingAuth.value = false
        if (authenticated.value) createTerminal()
      }
    })

    return () => {
      if (checkingAuth.value) return <main class="shell shell--locked" aria-label="lin web terminal" />
      if (!authenticated.value) return <AccessRequired onUnlock={async (token) => {
        const response = await fetch('/api/auth', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'text/plain' }, body: token })
        if (!response.ok) return false
        authenticated.value = true; createTerminal(); return true
      }} />
      const connectionLabel = connectionState.value === 'online'
        ? (isLoopbackHost(location.hostname) ? 'local' : 'remote')
        : connectionState.value === 'connecting' ? 'linking' : 'offline'

      return (
        <main class="shell" aria-label="lin web terminal">
          <header class="topbar">
            <div class="identity" aria-label="lin">
              <span class="identity__mark" aria-hidden="true">λ</span>
              <span class="identity__name">lin</span>
            </div>
            <div class="tabs" role="tablist" aria-label="Terminal sessions">
              {tabs.value.map((tab) => (
                <ToolbarClosableTab
                  key={tab.id}
                  containerClass={`tab ${activeId.value === String(tab.id) ? 'tab--active' : ''} tab--${tab.state}`}
                  containerProps={{ 'data-terminal-tab': String(tab.id) }}
                  buttonProps={{
                    role: 'tab',
                    id: `terminal-tab-${tab.id}`,
                    'aria-selected': activeId.value === String(tab.id),
                    'aria-label': `${tab.title} · ${tab.state}`,
                    'aria-controls': `terminal-panel-${tab.id}`,
                    'aria-keyshortcuts': 'Delete',
                    tabIndex: activeId.value === String(tab.id) ? 0 : -1,
                    onClick: () => {
                      activeId.value = String(tab.id)
                      requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-terminal-tab="${tab.id}"] .terminal-host`)?.querySelector<HTMLElement>('.xterm-helper-textarea')?.focus())
                    },
                    onKeydown: (event) => handleTabKeydown(event, tab.id),
                  }}
                  close={{
                    kind: 'action',
                    label: 'Close terminal',
                    visible: activeId.value === String(tab.id),
                    onClose: (event) => {
                      event.preventDefault()
                      event.stopPropagation()
                      closeTerminal(tab.id)
                    },
                  }}
                >
                  <span class="tab__state" aria-hidden="true" />
                  <span class="tab__title">{tab.title}</span>
                </ToolbarClosableTab>
              ))}
            </div>
            <Tip label="New terminal · Ctrl/⌘ T">
              <button class="new-tab" type="button" aria-label="New terminal" onClick={createTerminal}>
                <Plus size={15} strokeWidth={1.5} aria-hidden="true" />
              </button>
            </Tip>
            <div class={['connection', connectionState.value === 'offline' && 'connection--offline']} title={`${connectionLabel} token-protected connection`}>
              <span class="connection__dot" />
              <span>{connectionLabel}</span>
            </div>
          </header>
          <div class="terminals">
            {tabs.value.map((tab) => (
              <div
                key={tab.id}
                id={`terminal-panel-${tab.id}`}
                role="tabpanel"
                aria-labelledby={`terminal-tab-${tab.id}`}
                class="terminal-content"
                data-state={activeId.value === String(tab.id) ? 'active' : 'inactive'}
              >
                <TerminalPane
                  sessionId={tab.id}
                  active={activeId.value === String(tab.id)}
                  onStateChange={(state) => updateTab(tab.id, { state })}
                  onTitleChange={(title) => updateTab(tab.id, { title })}
                />
              </div>
            ))}
          </div>
        </main>
      )
    }
  },
})

function handleTabKeydown(event: KeyboardEvent, id: number): void {
  const tabs = Array.from(document.querySelectorAll<HTMLElement>('[data-terminal-tab]'))
  const index = tabs.findIndex((tab) => tab.dataset.terminalTab === String(id))
  if (event.key === 'Delete') {
    event.preventDefault()
    tabs[index]?.querySelector<HTMLElement>('[data-toolbar-tab-close-action]')?.click()
    return
  }
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' && event.key !== 'Home' && event.key !== 'End') return
  event.preventDefault()
  const targetIndex = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length
  tabs[targetIndex]?.querySelector<HTMLButtonElement>('[role="tab"]')?.focus()
  tabs[targetIndex]?.querySelector<HTMLButtonElement>('[role="tab"]')?.click()
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]'
}

const AccessRequired = defineComponent({
  name: 'AccessRequired',
  props: {
    onUnlock: { type: Function as PropType<(token: string) => Promise<boolean>>, required: true },
  },
  setup(props) {
    const token = ref('')
    const error = ref('')
    const submitting = ref(false)
    return () => (
      <main class="shell shell--locked" aria-label="lin web terminal">
        <header class="topbar">
          <div class="identity" aria-label="lin">
            <span class="identity__mark" aria-hidden="true">λ</span>
            <span class="identity__name">lin</span>
          </div>
          <div class="tabs" />
          <div class="connection connection--offline">
            <span class="connection__dot" />
            <span>offline</span>
          </div>
        </header>
        <section class="fatal">
          <span class="fatal__eyebrow">ACCESS REQUIRED</span>
          <h1>Connect to your local terminal.</h1>
          <p>Paste the access token printed by the lin server. It stays in this browser session.</p>
          <form class="token-entry" onSubmit={(event) => { event.preventDefault(); const value = token.value.trim(); if (!value || submitting.value) return; submitting.value = true; error.value = ''; void props.onUnlock(value).then((ok) => { if (!ok) error.value = 'Invalid access token' }).catch(() => { error.value = 'Unable to connect to lin' }).finally(() => { submitting.value = false }) }}>
            <label for="access-token">Access token</label>
            <div class="token-entry__row">
              <input id="access-token" type="password" autocomplete="off" spellcheck={false} value={token.value} placeholder="Paste token…" onInput={(event) => { token.value = (event.currentTarget as HTMLInputElement).value }} />
              <button type="submit" disabled={!token.value.trim() || submitting.value}>{submitting.value ? 'Connecting…' : 'Unlock'}</button>
            </div>
            {error.value ? <p class="token-entry__error" role="alert">{error.value}</p> : null}
          </form>
        </section>
      </main>
    )
  },
})
