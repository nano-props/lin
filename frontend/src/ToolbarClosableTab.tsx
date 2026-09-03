import { X } from '@lucide/vue'
import type { ButtonHTMLAttributes, FunctionalComponent, HTMLAttributes, VNodeChild } from 'vue'
import { toButtonVNodeRef, toDivVNodeRef } from '#/goblin-refs.ts'
import type { ElementRef } from '#/goblin-refs.ts'

type DataAttributes = { [K in `data-${string}`]?: string | boolean | undefined }
type ToolbarClosableTabContainerProps = Omit<HTMLAttributes, 'class'> & DataAttributes
type ToolbarClosableTabButtonProps = Omit<ButtonHTMLAttributes, 'class'> & DataAttributes & { tabIndex?: number }
export type ToolbarTabCloseEvent = MouseEvent

export type ToolbarTabClose = {
  kind: 'action'
  label: string
  visible: boolean
  disabled?: boolean
  onClose: (event: ToolbarTabCloseEvent) => void
} | { kind: 'placeholder' }

interface ToolbarClosableTabProps {
  containerRef?: ElementRef<HTMLDivElement>
  containerProps?: ToolbarClosableTabContainerProps
  containerClass: string
  overlay?: VNodeChild
  buttonRef?: ElementRef<HTMLButtonElement>
  buttonProps?: ToolbarClosableTabButtonProps
  buttonClass?: string
  close?: ToolbarTabClose
}

export const ToolbarClosableTab: FunctionalComponent<ToolbarClosableTabProps> = (props, { slots }) => (
  <div
    ref={toDivVNodeRef(props.containerRef)}
    {...props.containerProps}
    data-title-bar-chrome-region="interactive"
    class={props.containerClass}
  >
    {props.overlay}
    <button
      ref={toButtonVNodeRef(props.buttonRef)}
      type="button"
      {...props.buttonProps}
      class={['goblin-tab-button', props.buttonClass]}
    >
      {slots.default?.()}
      {props.close?.kind === 'placeholder' ? <span aria-hidden="true" class="goblin-tab-close placeholder"><X size={14} /></span> : null}
      {props.close?.kind === 'action' ? (
        <span
          aria-hidden="true"
          data-toolbar-tab-close-action=""
          data-disabled={props.close.disabled ? 'true' : undefined}
          onPointerdown={(event) => event.stopPropagation()}
          onMousedown={(event) => event.stopPropagation()}
          onClick={props.close.disabled ? undefined : props.close.onClose}
          class={['goblin-tab-close', props.close.visible ? 'visible' : 'hidden']}
          title={props.close.label}
        >
          <X size={14} />
        </span>
      ) : null}
    </button>
  </div>
)
