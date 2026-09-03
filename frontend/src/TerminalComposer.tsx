import {
  ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Copy, Keyboard, Paperclip, SendHorizontal, TextCursorInput, X,
} from '@lucide/vue'
import { defineComponent, nextTick, ref, watch } from 'vue'
import type { PropType } from 'vue'

export type ComposerMode = 'keys' | 'input'
export type VirtualKey =
  | 'enter' | 'backspace' | 'tab' | 'arrow-up' | 'arrow-down' | 'arrow-left' | 'arrow-right'
  | 'escape' | 'clear-screen' | 'interrupt' | 'eof'

interface ComposerProps {
  expanded: boolean
  mode: ComposerMode
  draft: string
  historyEntries: readonly string[]
  onVirtualKey: (key: VirtualKey) => void
  onCopyContent: () => Promise<void>
  onSendText: (text: string) => Promise<boolean>
  onSubmitText: (text: string) => Promise<boolean>
  onOpen: () => boolean
  onClose: () => boolean
  onModeChange: (mode: ComposerMode) => boolean
  onDraftChange: (draft: string) => boolean
  onUploadFile: (file: File) => Promise<string>
}

const keyActions: Array<{ key: VirtualKey; label: string; icon: unknown }> = [
  { key: 'arrow-left', label: 'Arrow left', icon: <ArrowLeft size={16} /> },
  { key: 'arrow-down', label: 'Arrow down', icon: <ArrowDown size={16} /> },
  { key: 'arrow-up', label: 'Arrow up', icon: <ArrowUp size={16} /> },
  { key: 'arrow-right', label: 'Arrow right', icon: <ArrowRight size={16} /> },
]

const commandKeys: Array<{ key: VirtualKey; label: string; glyph: string }> = [
  { key: 'tab', label: 'Tab', glyph: '⇥' },
  { key: 'enter', label: 'Enter', glyph: '↵' },
  { key: 'backspace', label: 'Backspace', glyph: '⌫' },
  { key: 'escape', label: 'Escape', glyph: 'Esc' },
  { key: 'clear-screen', label: 'Clear screen', glyph: '^L' },
  { key: 'interrupt', label: 'Interrupt', glyph: '^C' },
  { key: 'eof', label: 'End of file', glyph: '^D' },
]

export const TerminalComposer = defineComponent<ComposerProps>({
  name: 'TerminalComposer',
  props: {
    expanded: { type: Boolean, required: true },
    mode: { type: String as PropType<ComposerMode>, required: true },
    draft: { type: String, required: true },
    historyEntries: { type: Array as PropType<readonly string[]>, required: true },
    onVirtualKey: { type: Function as PropType<ComposerProps['onVirtualKey']>, required: true },
    onCopyContent: { type: Function as PropType<ComposerProps['onCopyContent']>, required: true },
    onSendText: { type: Function as PropType<ComposerProps['onSendText']>, required: true },
    onSubmitText: { type: Function as PropType<ComposerProps['onSubmitText']>, required: true },
    onOpen: { type: Function as PropType<ComposerProps['onOpen']>, required: true },
    onClose: { type: Function as PropType<ComposerProps['onClose']>, required: true },
    onModeChange: { type: Function as PropType<ComposerProps['onModeChange']>, required: true },
    onDraftChange: { type: Function as PropType<ComposerProps['onDraftChange']>, required: true },
    onUploadFile: { type: Function as PropType<ComposerProps['onUploadFile']>, required: true },
  },
  setup(props) {
    const input = ref<HTMLTextAreaElement | null>(null)
    const trigger = ref<HTMLButtonElement | null>(null)
    const modeToggle = ref<HTMLButtonElement | null>(null)
    const fileInput = ref<HTMLInputElement | null>(null)
    const uploading = ref(false)
    const uploadError = ref('')
    let insertionStart = 0
    let insertionEnd = 0
    let historyIndex: number | null = null
    let draftBeforeHistory = ''

    watch(() => props.expanded, (expanded) => {
      void nextTick(() => {
        if (!expanded) trigger.value?.focus()
        else if (props.mode === 'input') input.value?.focus()
        else modeToggle.value?.focus()
      })
    })

    const deliver = async (submit: boolean): Promise<void> => {
      const text = props.draft
      if (!text) return
      const accepted = await (submit ? props.onSubmitText(text) : props.onSendText(text))
      if (accepted) {
        historyIndex = null
        draftBeforeHistory = ''
        props.onDraftChange('')
      }
    }

    const historyMove = (direction: -1 | 1): void => {
      const entries = props.historyEntries
      if (entries.length === 0) return
      if (historyIndex === null) {
        if (direction > 0 || props.draft !== '') return
        draftBeforeHistory = props.draft
        historyIndex = entries.length - 1
      } else if (direction < 0) {
        historyIndex = Math.max(0, historyIndex - 1)
      } else if (historyIndex < entries.length - 1) {
        historyIndex += 1
      } else {
        historyIndex = null
        props.onDraftChange(draftBeforeHistory)
        return
      }
      props.onDraftChange(entries[historyIndex] ?? '')
      void nextTick(() => {
        const element = input.value
        if (element) {
          element.focus()
          element.setSelectionRange(element.value.length, element.value.length)
        }
      })
    }

    const onDraftKeydown = (event: KeyboardEvent): void => {
      if (event.isComposing || event.keyCode === 229) return
      if (!event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && event.key === 'ArrowUp') {
        event.preventDefault(); historyMove(-1); return
      }
      if (!event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && event.key === 'ArrowDown') {
        event.preventDefault(); historyMove(1); return
      }
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault(); void deliver(true)
      }
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation(); props.onClose()
      }
    }

    const chooseFiles = (): void => {
      const element = input.value
      insertionStart = element?.selectionStart ?? props.draft.length
      insertionEnd = element?.selectionEnd ?? insertionStart
      fileInput.value?.click()
    }

    const onFiles = async (event: Event): Promise<void> => {
      const files = Array.from((event.target as HTMLInputElement).files ?? [])
      ;(event.target as HTMLInputElement).value = ''
      if (!files.length) return
      uploading.value = true; uploadError.value = ''
      try {
        const paths: string[] = []
        for (const file of files) paths.push(await props.onUploadFile(file))
        const before = props.draft.slice(0, insertionStart)
        const after = props.draft.slice(insertionEnd)
        const glueBefore = before && !/[\s]$/.test(before) ? ' ' : ''
        const glueAfter = after && !/^\s/.test(after) ? ' ' : ''
        props.onDraftChange(`${before}${glueBefore}${paths.join(' ')}${glueAfter}${after}`)
        void nextTick(() => { input.value?.focus(); const position = (before + glueBefore + paths.join(' ') + glueAfter).length; input.value?.setSelectionRange(position, position) })
      } catch (error) {
        uploadError.value = error instanceof Error ? error.message : 'Upload failed'
      } finally { uploading.value = false }
    }

    return () => (
      <div class={['terminal-composer', props.expanded && 'terminal-composer--expanded']} data-expanded={props.expanded}>
        <button ref={trigger} type="button" class="terminal-composer__toggle" aria-label="Open terminal composer" aria-expanded={props.expanded} aria-keyshortcuts="Control+Shift+Enter Meta+Shift+Enter" onClick={() => props.onOpen()}>
          <Keyboard size={18} aria-hidden="true" />
        </button>
        <div class="terminal-composer__surface" aria-hidden={!props.expanded} inert={!props.expanded ? true : undefined}>
          <button ref={modeToggle} type="button" class="terminal-composer__mode" aria-label={props.mode === 'input' ? 'Show key controls' : 'Show text input'} onClick={() => props.onModeChange(props.mode === 'input' ? 'keys' : 'input')}>
            {props.mode === 'input' ? <Keyboard size={16} /> : <TextCursorInput size={16} />}
          </button>
          {props.mode === 'input' ? (
            <textarea
              ref={input}
              rows={1}
              value={props.draft}
              class="terminal-composer__input"
              placeholder="Compose terminal input…"
              aria-label="Terminal composer input"
              autocapitalize="off"
              autocorrect="off"
              spellcheck={false}
              onInput={(event) => props.onDraftChange((event.currentTarget as HTMLTextAreaElement).value)}
              onKeydown={onDraftKeydown}
            />
          ) : (
            <div class="terminal-composer__keys">
              <button type="button" aria-label="Copy terminal selection" onClick={() => void props.onCopyContent()}><Copy size={16} /></button>
              {commandKeys.map((item) => <button key={item.key} type="button" aria-label={item.label} onClick={() => props.onVirtualKey(item.key)}><kbd>{item.glyph}</kbd></button>)}
              {keyActions.map((item) => <button key={item.key} type="button" aria-label={item.label} onClick={() => props.onVirtualKey(item.key)}>{item.icon}</button>)}
            </div>
          )}
          {props.mode === 'input' ? <>
            <input ref={fileInput} type="file" multiple hidden onChange={(event) => void onFiles(event)} />
            <button type="button" class="terminal-composer__upload" aria-label="Upload files" disabled={uploading.value} onClick={chooseFiles}><Paperclip size={16} /></button>
            <button type="button" class="terminal-composer__send" aria-label="Send without Enter" disabled={!props.draft || uploading.value} onClick={() => void deliver(false)}><SendHorizontal size={16} /></button>
          </> : null}
          {uploadError.value ? <span class="terminal-composer__error" role="alert">{uploadError.value}</span> : null}
          <button type="button" class="terminal-composer__close" aria-label="Close terminal composer" onClick={() => props.onClose()}><X size={16} /></button>
        </div>
      </div>
    )
  },
})
