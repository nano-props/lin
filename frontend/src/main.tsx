import { createApp } from 'vue'
import { TooltipProvider } from 'reka-ui'
import { App } from '#/App.tsx'
import '@xterm/xterm/css/xterm.css'
import './style.css'

const root = document.querySelector<HTMLElement>('#app')
if (!root) throw new Error('missing application host')

createApp({
  render: () => (
    <TooltipProvider delayDuration={250}>
      <App />
    </TooltipProvider>
  ),
}).mount(root)
