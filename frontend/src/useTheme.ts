import { ref } from 'vue'
import type { ThemeMode } from '#/TerminalPane.tsx'

const THEME_STORAGE_KEY = 'lin-theme'

export function useTheme() {
  const stored = localStorage.getItem(THEME_STORAGE_KEY)
  const theme = ref<ThemeMode>(stored === 'light' || stored === 'dark' ? stored : 'auto')

  const setTheme = (mode: ThemeMode): void => {
    theme.value = mode
    localStorage.setItem(THEME_STORAGE_KEY, mode)
    document.documentElement.dataset.theme = mode
  }

  setTheme(theme.value)
  return { theme, setTheme }
}
