import { defineComponent } from 'vue'
import type { PropType } from 'vue'
import type { TerminalSessionState } from '#/TerminalPane.tsx'

export const ConnectionStatus = defineComponent({
  name: 'ConnectionStatus',
  props: { state: { type: String as PropType<TerminalSessionState>, required: true } },
  setup(props) {
    return () => {
      const label = props.state === 'online'
        ? (isLoopbackHost(location.hostname) ? 'local' : 'remote')
        : props.state === 'connecting' ? 'linking' : 'offline'
      return <div class={['connection', props.state === 'offline' && 'connection--offline']} title={`${label} token-protected connection`}>
        <span class="connection__dot" />
        <span>{label}</span>
      </div>
    }
  },
})

function isLoopbackHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]'
}
