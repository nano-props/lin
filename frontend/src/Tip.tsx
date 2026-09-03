import { TooltipContent, TooltipPortal, TooltipProvider, TooltipRoot, TooltipTrigger } from 'reka-ui'
import { defineComponent, ref } from 'vue'
import type { PropType, VNodeChild } from 'vue'

export const Tip = defineComponent<{ label: VNodeChild; side?: 'top' | 'right' | 'bottom' | 'left' }>({
  name: 'Tip',
  props: {
    label: { type: null, required: true },
    side: String as PropType<'top' | 'right' | 'bottom' | 'left'>,
  },
  setup(props, { slots }) {
    const open = ref(false)
    return () => (
      <TooltipProvider delayDuration={250}>
        <TooltipRoot
          open={open.value}
          onUpdate:open={(nextOpen) => {
            open.value = nextOpen
          }}
        >
          <TooltipTrigger asChild>{slots.default?.()}</TooltipTrigger>
          <TooltipPortal><TooltipContent class="tip" side={props.side ?? 'bottom'} sideOffset={6}>{props.label}</TooltipContent></TooltipPortal>
        </TooltipRoot>
      </TooltipProvider>
    )
  },
})
