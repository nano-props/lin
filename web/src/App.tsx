import { Plus, Terminal } from '@lucide/vue'
import { useEventListener } from '@vueuse/core'
import { computed, defineComponent, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { PropType } from 'vue'
import { TerminalPane } from '#/TerminalPane.tsx'
import { ThemeToggle } from '#/ThemeToggle.tsx'
import { Tip } from '#/Tip.tsx'
import { ToolbarClosableTab } from '#/ToolbarClosableTab.tsx'
import { useTheme } from '#/useTheme.ts'

interface TerminalTab {
  id: number
  sessionKey: string
  title: string
  error: string
}

const ACTIVE_STORAGE_KEY = 'lin-active-terminal'

export const App = defineComponent({
  name: 'App',
  setup() {
    const authenticated = ref(false)
    const checkingAuth = ref(true)
    const authError = ref('')
    const { theme, setTheme } = useTheme()
    const tabs = ref<TerminalTab[]>([])
    const activeId = ref('')
    let nextId = 1

    const sessionError = ref('')
    const terminalErrors = computed(() => tabs.value.filter((tab) => tab.error))
    const mutating = ref(false)
    let sessionRevision = 0
    let syncing = false
    let pollTimer: ReturnType<typeof setInterval> | undefined

    const addTab = (sessionKey: string): TerminalTab => {
      const tab: TerminalTab = { id: nextId++, sessionKey, title: 'shell', error: '' }
      tabs.value.push(tab)
      return tab
    }

    const syncSessions = async (): Promise<void> => {
      if (!authenticated.value || mutating.value || syncing) return
      syncing = true
      const revision = sessionRevision
      try {
        const response = await fetch('/api/sessions', { credentials: 'same-origin' })
        if (!response.ok) throw new Error('Unable to load terminal sessions')
        const keys: string[] = await response.json()
        if (revision !== sessionRevision) return
        const current = tabs.value.find((tab) => String(tab.id) === activeId.value)?.sessionKey
        const existing = new Map(tabs.value.map((tab) => [tab.sessionKey, tab]))
        tabs.value = keys.map(
          (key) =>
            existing.get(key) ?? {
              id: nextId++,
              sessionKey: key,
              title: 'shell',
              error: '',
            },
        )
        let preferred = current
        try {
          preferred ??= sessionStorage.getItem(ACTIVE_STORAGE_KEY) ?? undefined
        } catch {
          /* Storage may be disabled. */
        }
        const selected = tabs.value.find((tab) => tab.sessionKey === preferred) ?? tabs.value[0]
        activeId.value = selected ? String(selected.id) : ''
        sessionError.value = ''
      } catch {
        sessionError.value = 'Unable to load terminal sessions. Retrying…'
      } finally {
        syncing = false
      }
    }

    const createTerminal = async (): Promise<void> => {
      if (!authenticated.value || mutating.value) return
      mutating.value = true
      sessionRevision++
      try {
        const response = await fetch('/api/sessions', { method: 'POST', credentials: 'same-origin' })
        if (!response.ok) throw new Error('Unable to create terminal')
        const tab = addTab(await response.json())
        activeId.value = String(tab.id)
        sessionError.value = ''
        await nextTick()
        document.querySelector<HTMLElement>(`[data-terminal-tab="${tab.id}"]`)?.scrollIntoView({
          block: 'nearest',
          inline: 'nearest',
        })
      } catch {
        sessionError.value = 'Unable to create terminal. Please try again.'
      } finally {
        mutating.value = false
      }
    }

    const closeTerminal = async (id: number): Promise<void> => {
      const tab = tabs.value.find((tab) => tab.id === id)
      if (!tab || mutating.value) return
      mutating.value = true
      sessionRevision++
      try {
        const response = await fetch(`/api/sessions?session=${encodeURIComponent(tab.sessionKey)}`, {
          method: 'DELETE',
          credentials: 'same-origin',
        })
        if (!response.ok) throw new Error('Unable to close terminal')
        const index = tabs.value.findIndex((tab) => tab.id === id)
        tabs.value.splice(index, 1)
        if (activeId.value === String(id)) {
          const replacement = tabs.value[Math.min(index, tabs.value.length - 1)]
          activeId.value = replacement ? String(replacement.id) : ''
        }
        sessionError.value = ''
      } catch {
        sessionError.value = 'Unable to close terminal. Please try again.'
      } finally {
        mutating.value = false
      }
      if (tabs.value.length === 0) await createTerminal()
    }

    watch(activeId, () => {
      const key = tabs.value.find((tab) => String(tab.id) === activeId.value)?.sessionKey
      try {
        if (key) sessionStorage.setItem(ACTIVE_STORAGE_KEY, key)
      } catch {
        /* Storage may be disabled. */
      }
    })

    const restoreSessions = async (): Promise<void> => {
      await syncSessions()
      if (!sessionError.value && tabs.value.length === 0) await createTerminal()
      pollTimer ??= setInterval(() => {
        void syncSessions()
      }, 5000)
    }
    useEventListener(window, 'focus', () => {
      void syncSessions()
    })
    onBeforeUnmount(() => clearInterval(pollTimer))

    const updateTab = (id: number, update: Partial<Pick<TerminalTab, 'title' | 'error'>>): void => {
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
          ? await fetch('/api/auth', {
              method: 'POST',
              credentials: 'same-origin',
              headers: { 'Content-Type': 'text/plain' },
              body: token,
            })
          : await fetch('/api/auth/status', { credentials: 'same-origin' })
        authenticated.value = response.ok
      } catch {
        authError.value = 'Unable to connect to lin'
      } finally {
        checkingAuth.value = false
        if (authenticated.value) {
          await restoreSessions()
        }
      }
    })

    return () => {
      if (checkingAuth.value) return <main class="shell shell--locked" aria-label="lin web terminal" />
      if (!authenticated.value)
        return (
          <AccessRequired
            initialError={authError.value}
            onUnlock={async (token) => {
              const response = await fetch('/api/auth', {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'text/plain' },
                body: token,
              })
              if (!response.ok) return false
              authenticated.value = true
              await restoreSessions()
              return true
            }}
          />
        )
      return (
        <main class="shell" aria-label="lin web terminal">
          <header class="topbar">
            <div class="identity" aria-label="lin">
              <Terminal class="identity__mark" size={16} strokeWidth={1.7} aria-hidden="true" />
              <span class="identity__name">lin</span>
            </div>
            <div class="tabs" role="tablist" aria-label="Terminal sessions">
              {tabs.value.map((tab) => (
                <ToolbarClosableTab
                  key={tab.id}
                  containerClass={`tab ${activeId.value === String(tab.id) ? 'tab--active' : ''}`}
                  containerProps={{ 'data-terminal-tab': String(tab.id) }}
                  buttonProps={{
                    role: 'tab',
                    id: `terminal-tab-${tab.id}`,
                    'aria-selected': activeId.value === String(tab.id),
                    'aria-label': tab.title,
                    'aria-controls': `terminal-panel-${tab.id}`,
                    'aria-keyshortcuts': 'Delete',
                    tabIndex: activeId.value === String(tab.id) ? 0 : -1,
                    onClick: () => {
                      activeId.value = String(tab.id)
                      requestAnimationFrame(() =>
                        document
                          .querySelector<HTMLElement>(`[data-terminal-tab="${tab.id}"] .terminal-host`)
                          ?.querySelector<HTMLElement>('.xterm-helper-textarea')
                          ?.focus(),
                      )
                    },
                    onKeydown: (event) => handleTabKeydown(event, tab.id),
                  }}
                  close={{
                    kind: 'action',
                    label: 'Close terminal',
                    disabled: mutating.value,
                    visible: activeId.value === String(tab.id),
                    onClose: (event) => {
                      event.preventDefault()
                      event.stopPropagation()
                      closeTerminal(tab.id)
                    },
                  }}
                >
                  <span class="tab__title">{tab.title}</span>
                </ToolbarClosableTab>
              ))}
              <Tip label="New terminal · Ctrl/⌘ T">
                <button
                  class="new-tab"
                  type="button"
                  aria-label="New terminal"
                  disabled={mutating.value}
                  onClick={() => createTerminal()}
                >
                  <Plus size={15} strokeWidth={1.5} aria-hidden="true" />
                </button>
              </Tip>
            </div>
            <ThemeToggle modelValue={theme.value} onUpdate:modelValue={setTheme} />
          </header>
          {sessionError.value ? (
            <div class="session-error" role="alert">
              {sessionError.value}
            </div>
          ) : null}
          {terminalErrors.value.map((tab) => (
            <div key={tab.id} class="session-error" role="alert">
              {tab.title}: {tab.error}
            </div>
          ))}
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
                  sessionKey={tab.sessionKey}
                  active={activeId.value === String(tab.id)}
                  onError={(error) => updateTab(tab.id, { error })}
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
  const targetIndex =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? tabs.length - 1
        : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length
  tabs[targetIndex]?.querySelector<HTMLButtonElement>('[role="tab"]')?.focus()
  tabs[targetIndex]?.querySelector<HTMLButtonElement>('[role="tab"]')?.click()
}

const AccessRequired = defineComponent({
  name: 'AccessRequired',
  props: {
    onUnlock: { type: Function as PropType<(token: string) => Promise<boolean>>, required: true },
    initialError: { type: String, default: '' },
  },
  setup(props) {
    const token = ref('')
    const error = ref(props.initialError)
    const submitting = ref(false)
    return () => (
      <main class="shell shell--locked" aria-label="lin web terminal">
        <header class="topbar">
          <div class="identity" aria-label="lin">
            <Terminal class="identity__mark" size={16} strokeWidth={1.7} aria-hidden="true" />
            <span class="identity__name">lin</span>
          </div>
          <div class="tabs" />
        </header>
        <section class="fatal">
          <span class="fatal__eyebrow">ACCESS REQUIRED</span>
          <h1>Connect to your local terminal.</h1>
          <p>Paste the access token printed by the lin server. This browser will remember your login.</p>
          <form
            class="token-entry"
            onSubmit={(event) => {
              event.preventDefault()
              const value = token.value.trim()
              if (!value || submitting.value) return
              submitting.value = true
              error.value = ''
              void props
                .onUnlock(value)
                .then((ok) => {
                  if (!ok) error.value = 'Invalid access token'
                })
                .catch(() => {
                  error.value = 'Unable to connect to lin'
                })
                .finally(() => {
                  submitting.value = false
                })
            }}
          >
            <label for="access-token">Access token</label>
            <div class="token-entry__row">
              <input
                id="access-token"
                type="password"
                autocomplete="off"
                spellcheck={false}
                value={token.value}
                placeholder="Paste token…"
                onInput={(event) => {
                  token.value = (event.currentTarget as HTMLInputElement).value
                }}
              />
              <button type="submit" disabled={!token.value.trim() || submitting.value}>
                {submitting.value ? 'Connecting…' : 'Unlock'}
              </button>
            </div>
            {error.value ? (
              <p class="token-entry__error" role="alert">
                {error.value}
              </p>
            ) : null}
          </form>
        </section>
      </main>
    )
  },
})
