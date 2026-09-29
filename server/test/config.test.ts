import { expect, test } from 'bun:test'
import { parseConfig } from '../src/config'

test('defaults to loopback and a random token', async () => {
  const config = await parseConfig([], {})
  expect(config.host).toBe('127.0.0.1')
  expect(config.port).toBe(7681)
  expect(config.token.length).toBeGreaterThanOrEqual(32)
})

test('arguments override environment including invalid values', async () => {
  expect(
    await parseConfig(['--port', '0', '--token', '0123456789abcdef', '--allow-remote'], {
      LIN_PORT: 'bad',
      LIN_TOKEN: 'short',
      LIN_ALLOW_REMOTE: 'maybe',
    }),
  ).toEqual({ host: '127.0.0.1', port: 0, token: '0123456789abcdef' })
  expect((await parseConfig([], { LIN_PORT: '9000', LIN_ALLOW_REMOTE: 'yes' })).port).toBe(9000)
})

test('remote addresses require opt-in; IPv6 loopback is allowed', async () => {
  await expect(parseConfig(['--host', '0.0.0.0'], {})).rejects.toThrow('non-loopback')
  await expect(parseConfig(['--host', '::'], {})).rejects.toThrow('non-loopback')
  expect((await parseConfig(['--host', '0.0.0.0', '--allow-remote'], {})).host).toBe('0.0.0.0')
  expect((await parseConfig(['--host', '::1'], {})).host).toBe('::1')
})

test('rejects invalid configuration', async () => {
  for (const args of [
    ['--port', '1x'],
    ['--port', '-1'],
    ['--port', '65536'],
    ['--token', 'short'],
    ['--host'],
    ['--unknown'],
  ]) {
    await expect(parseConfig(args, {})).rejects.toThrow()
  }
  await expect(parseConfig([], { LIN_ALLOW_REMOTE: 'maybe' })).rejects.toThrow()
})
