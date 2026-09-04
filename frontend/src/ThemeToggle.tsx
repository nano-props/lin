import { Monitor, Moon, Sun } from '@lucide/vue'
import { defineComponent } from 'vue'
import type { PropType } from 'vue'
import type { ThemeMode } from '#/TerminalPane.tsx'
import { Tip } from '#/Tip.tsx'

const modes: ThemeMode[] = ['auto', 'light', 'dark']
const labels: Record<ThemeMode, string> = {
  auto: 'Auto theme',
  light: 'Light theme',
  dark: 'Dark theme',
}

export const ThemeToggle = defineComponent({
  name: 'ThemeToggle',
  props: { modelValue: { type: String as PropType<ThemeMode>, required: true } },
  emits: { 'update:modelValue': (mode: ThemeMode) => modes.includes(mode) },
  setup(props, { emit }) {
    return () => {
      const mode = props.modelValue
      const next = modes[(modes.indexOf(mode) + 1) % modes.length] ?? 'auto'
      const Icon = mode === 'auto' ? Monitor : mode === 'light' ? Sun : Moon
      const label = labels[mode]
      return (
        <Tip label={`${label} · click to switch`}>
          <button
            type="button"
            class="grid size-6 place-items-center rounded bg-transparent text-[var(--muted)] hover:bg-[var(--acid-soft)] hover:text-[var(--acid)] focus-visible:bg-[var(--acid-soft)] focus-visible:text-[var(--acid)] focus-visible:outline-none"
            aria-label={`${label}; click to switch theme`}
            onClick={() => emit('update:modelValue', next)}
          >
            <Icon size={13} strokeWidth={1.6} aria-hidden="true" />
          </button>
        </Tip>
      )
    }
  },
})
