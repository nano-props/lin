import { ref } from 'vue'
import { useEventListener } from '@vueuse/core'
import type { ThemeMode } from '#/TerminalPane.tsx'

const THEME_STORAGE_KEY = 'lin-theme'

export function useTheme() {
  const stored = localStorage.getItem(THEME_STORAGE_KEY)
  const theme = ref<ThemeMode>(stored === 'light' || stored === 'dark' ? stored : 'auto')

  const systemTheme = window.matchMedia('(prefers-color-scheme: dark)')
  const applyTheme = (): void => {
    document.documentElement.dataset.theme =
      theme.value === 'auto' ? (systemTheme.matches ? 'dark' : 'light') : theme.value
  }
  useEventListener(systemTheme, 'change', applyTheme)

  const setTheme = (mode: ThemeMode): void => {
    theme.value = mode
    localStorage.setItem(THEME_STORAGE_KEY, mode)
    applyTheme()
  }

  setTheme(theme.value)
  return { theme, setTheme }
}
