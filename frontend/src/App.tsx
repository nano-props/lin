import { Plus } from '@lucide/vue'
import { useEventListener } from '@vueuse/core'
import { computed, defineComponent, nextTick, ref } from 'vue'
import { TerminalPane } from './TerminalPane.tsx'
import type { TerminalSessionState } from './TerminalPane.tsx'
import { Tip } from './Tip.tsx'
import { ToolbarClosableTab } from './ToolbarClosableTab.tsx'

interface TerminalTab {
  id: number
  title: string
  state: TerminalSessionState
}

const ACCESS_TOKEN_KEY = 'lin.access-token'

export const App = defineComponent({
  name: 'App',
  setup() {
    const accessToken = readAccessToken()
    const tabs = ref<TerminalTab[]>([])
    const activeId = ref('')
    let nextId = 1

    const connectionState = computed<TerminalSessionState>(() => {
      if (tabs.value.some((tab) => tab.state === 'online')) return 'online'
      if (tabs.value.some((tab) => tab.state === 'connecting')) return 'connecting'
      return 'offline'
    })

    const createTerminal = (): void => {
      if (!accessToken) return
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

    if (accessToken) createTerminal()

    return () => {
      if (!accessToken) return <AccessRequired />
      const connectionLabel = connectionState.value === 'online' ? 'local' : connectionState.value === 'connecting' ? 'linking' : 'offline'

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
            <div class={['connection', connectionState.value === 'offline' && 'connection--offline']} title="Local, token-protected connection">
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
                  accessToken={accessToken}
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

const AccessRequired = defineComponent({
  name: 'AccessRequired',
  setup() {
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
          <h1>Open lin from its launch URL.</h1>
          <p>The terminal URL includes a local access token printed by the server.</p>
        </section>
      </main>
    )
  },
})

function readAccessToken(): string | null {
  const queryToken = new URLSearchParams(location.search).get('token')
  if (queryToken) sessionStorage.setItem(ACCESS_TOKEN_KEY, queryToken)
  const token = queryToken ?? sessionStorage.getItem(ACCESS_TOKEN_KEY)
  if (queryToken) history.replaceState(null, '', `${location.pathname}${location.hash}`)
  return token
}
