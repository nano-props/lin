// Only platform detection is needed by the headless xterm bundle.
globalThis.navigator = { userAgent: 'lin', platform: 'Linux' }
globalThis.window = globalThis
globalThis.performance = { now: () => Date.now() }
