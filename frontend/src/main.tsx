import { createApp } from 'vue'
import { App } from './App.tsx'
import '@xterm/xterm/css/xterm.css'
import './style.css'

const root = document.querySelector<HTMLElement>('#app')
if (!root) throw new Error('missing application host')

createApp(App).mount(root)
