// GraalJS supports modern JavaScript; these browser globals are needed by xterm.
globalThis.navigator = { userAgent: 'lin', platform: 'Linux' }
globalThis.window = globalThis
globalThis.performance = { now: () => Date.now() }
