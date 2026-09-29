import { expect, test } from 'bun:test'
import { pasteFilesInsteadOfText, quotePaths } from '../../web/src/terminal-files'
import {
  isImeOwnedKeyboardEvent,
  SafariShiftKeyResolver,
  terminalInputForMacOptionArrow,
  terminalInputForVirtualKey,
} from '../../web/src/terminal-keyboard'
import { terminalInputRevealRow } from '../../web/src/terminal-viewport-reveal'

const key = { type: 'keydown', key: 'ArrowLeft', altKey: true, ctrlKey: false, metaKey: false, shiftKey: false }

test('Mac word movement, application cursor mode and IME ownership', () => {
  expect(terminalInputForMacOptionArrow(key, { isMac: true, applicationCursorKeysMode: false })).toBe('\x1bb')
  expect(terminalInputForMacOptionArrow(key, { isMac: true, applicationCursorKeysMode: true })).toBeNull()
  expect(terminalInputForMacOptionArrow(key, { isMac: false, applicationCursorKeysMode: false })).toBeNull()
  expect(isImeOwnedKeyboardEvent({ isComposing: false, keyCode: 229 })).toBe(true)
  expect(terminalInputForVirtualKey('arrow-up', true)).toBe('\x1bOA')
  expect(terminalInputForVirtualKey('arrow-up', false)).toBe('\x1b[A')
})

test('Safari broken Shift symbols are resolved without rewriting valid keys', () => {
  const descriptor = Object.getOwnPropertyDescriptor(navigator, 'userAgent')
  Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'Version/17.0 Safari/605.1.15' })
  try {
    const resolver = new SafariShiftKeyResolver()
    expect(resolver.inputForEvent({ ...key, altKey: false, shiftKey: true, code: 'Slash', key: '/' })).toBe('?')
    expect(resolver.inputForEvent({ ...key, altKey: false, shiftKey: true, code: 'Slash', key: '?' })).toBeNull()
    expect(resolver.inputForEvent({ ...key, altKey: false, shiftKey: true, code: 'Slash', key: 'Unidentified' })).toBe(
      '?',
    )
  } finally {
    if (descriptor) Object.defineProperty(navigator, 'userAgent', descriptor)
    else Reflect.deleteProperty(navigator, 'userAgent')
  }
})

test('file paste preserves spreadsheet text and quotes shell metacharacters', () => {
  for (const text of ['42', 'a\tb', 'hello\nworld']) expect(pasteFilesInsteadOfText(text, true)).toBe(false)
  for (const text of ['', '/tmp/a', 'file:///tmp/a', 'C:\\folder\\file', '/tmp/a\n/tmp/b'])
    expect(pasteFilesInsteadOfText(text, true)).toBe(true)
  expect(pasteFilesInsteadOfText('/tmp/a', false)).toBe(false)
  expect(quotePaths(["/tmp/a'b;$(id)"], 1)).toBe("'/tmp/a'\\''b;$(id)' ")
  expect(() => quotePaths(['/tmp/a\nb'], 1)).toThrow()
  expect(() => quotePaths([], 1)).toThrow()
})

test('viewport reveal uses current cursor and projects input from scrollback', () => {
  expect(terminalInputRevealRow({ type: 'normal', baseY: 100, viewportY: 90, cursorY: 20 }, 24)).toBe(20)
  expect(terminalInputRevealRow({ type: 'alternate', baseY: 100, viewportY: 90, cursorY: 20 }, 24)).toBeNull()
})
