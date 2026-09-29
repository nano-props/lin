import { afterEach, expect, test } from 'bun:test'
import { startServer } from '../src/app'
import { payload, sizePayload } from '../src/protocol'
import { createTerminalState } from '../src/terminal-state.js'

const token = 'test-session-token-only'
let service: ReturnType<typeof startServer>
// Hono's DOM types hide Bun's constructor overload for custom handshake headers.
const ClientSocket = globalThis.WebSocket as unknown as new (
  url: string,
  options: Bun.WebSocketOptions,
) => Bun.WebSocket
const sockets: Bun.WebSocket[] = []
afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.close()
  await service?.close()
})
function start() {
  service = startServer(
    { host: '127.0.0.1', port: 0, token },
    new Map([['/index.html', new URL('../../web/index.html', import.meta.url).pathname]]),
  )
  return service
}
function request(path: string, method = 'GET', headers: Record<string, string> = {}, body?: string) {
  return fetch(service.origin + path, {
    method,
    body,
    headers: { Cookie: `lin_access=${token}`, Origin: service.origin, ...headers },
  })
}
async function create() {
  const response = await request('/api/sessions', 'POST')
  expect(response.status).toBe(201)
  return (await response.json()) as string
}

async function connect(id: string) {
  const socket = new ClientSocket(service.origin.replace('http:', 'ws:') + '/ws?session=' + id, {
    headers: { Cookie: `lin_access=${token}`, Origin: service.origin },
  })
  sockets.push(socket)
  socket.binaryType = 'arraybuffer'
  const messages: Buffer[] = []
  socket.addEventListener('message', (event) =>
    messages.push(Buffer.from((event as unknown as { data: ArrayBuffer }).data)),
  )
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => resolve(), { once: true })
    socket.addEventListener('error', reject, { once: true })
  })
  async function next(type: number, text?: string) {
    const end = Date.now() + 5000
    let received = ''
    while (Date.now() < end) {
      const message = messages.shift()
      if (message?.[0] === type) {
        if (!text) return message
        received += message.subarray(type === 4 ? 5 : 1).toString()
        if (received.includes(text)) return message
      }
      await Bun.sleep(5)
    }
    throw new Error(`Missing message ${type} ${text ?? ''}: ${received}`)
  }
  return { socket, messages, next, send: (text: string) => socket.send(payload(0, text)) }
}

test('authentication, CSRF, limits and static headers', async () => {
  start()
  expect((await fetch(service.origin + '/api/sessions')).status).toBe(401)
  expect((await fetch(service.origin + '/ws')).status).toBe(401)
  expect((await request('/ws', 'GET', { Origin: 'https://evil.example' })).status).toBe(403)
  expect((await request('/api/sessions', 'POST', { Origin: 'https://evil.example' })).status).toBe(403)
  expect((await request('/api/auth', 'POST', {}, 'wrong')).status).toBe(401)
  expect((await request('/api/auth', 'POST', {}, 'x'.repeat(4097))).status).toBe(413)
  const auth = await request('/api/auth', 'POST', {}, token)
  expect(auth.status).toBe(204)
  expect(auth.headers.get('set-cookie')).toContain('HttpOnly')
  expect(auth.headers.get('set-cookie')).toContain('SameSite=Strict')
  expect(auth.headers.get('set-cookie')).toContain('Max-Age=34560000')
  expect(
    (await request('/api/auth/status', 'GET', { Cookie: auth.headers.get('set-cookie')!.split(';')[0]! })).status,
  ).toBe(204)
  const page = await request('/')
  expect(page.status).toBe(200)
  expect(page.headers.get('content-security-policy')).toContain("default-src 'self'")
  expect(page.headers.get('content-type')).toContain('text/html')
  expect(await page.text()).toContain('<html')
  expect((await request('/', 'HEAD')).headers.get('content-length')).not.toBe('0')
  expect((await request('/%2e%2e%2fpackage.json')).status).toBe(404)
  expect((await request('/api/sessions?session=bad', 'DELETE')).status).toBe(400)
})

test('renews remembered login on authenticated API requests only', async () => {
  start()
  for (const path of ['/api/auth/status', '/api/sessions']) {
    const response = await request(path)
    expect(response.status).toBe(path.endsWith('/status') ? 204 : 200)
    expect(response.headers.get('set-cookie')).toContain('Max-Age=34560000')
    expect(response.headers.get('set-cookie')).toContain('HttpOnly')
    expect(response.headers.get('set-cookie')).toContain('SameSite=Strict')
  }
  const secure = await request('/api/auth/status', 'GET', { 'X-Forwarded-Proto': 'https' })
  expect(secure.headers.get('set-cookie')).toContain('Secure')
  const invalid = await request('/api/sessions', 'GET', { Cookie: 'lin_access=invalid' })
  expect(invalid.status).toBe(401)
  expect(invalid.headers.get('set-cookie')).toBeNull()
  const crossOrigin = await request('/api/sessions', 'POST', { Origin: 'https://evil.example' })
  expect(crossOrigin.status).toBe(403)
  expect(crossOrigin.headers.get('set-cookie')).toBeNull()
})

test('retains detached shell, cwd and offline output; explicit delete closes it', async () => {
  start()
  const id = await create(),
    other = await create()
  expect(await (await request('/api/sessions')).json()).toEqual([id, other])
  const first = await connect(id)
  await first.next(4)
  first.send("export LIN_TEST_VALUE=retained; cd /tmp; printf 'before-%s\\n' refresh\n")
  await first.next(0, 'before-refresh')
  first.send("sleep 0.1; printf 'offline-%s\\n' output\n")
  first.socket.close()
  await Bun.sleep(250)
  const second = await connect(id)
  const snapshot = await second.next(4)
  expect(snapshot.subarray(5).toString()).toContain('before-refresh')
  expect(snapshot.subarray(5).toString()).toContain('offline-output')
  second.send('printf \'state:%s:%s\\n\' "$LIN_TEST_VALUE" "$PWD"\n')
  await second.next(0, 'state:retained:/tmp')
  expect((await request('/api/sessions?session=' + id, 'DELETE')).status).toBe(204)
  await second.next(2)
  expect(await (await request('/api/sessions')).json()).toEqual([other])
  await request('/api/sessions?session=' + other, 'DELETE')
  expect(await (await request('/api/sessions')).json()).toEqual([])
}, 15000)

test('multiple viewers share output and ordered geometry; shell exit removes the session', async () => {
  start()
  const id = await create(),
    first = await connect(id),
    second = await connect(id)
  await first.next(4)
  await second.next(4)
  first.socket.send(sizePayload(1, 100, 30))
  expect(await first.next(5)).toEqual(sizePayload(5, 100, 30))
  expect(await second.next(5)).toEqual(sizePayload(5, 100, 30))
  first.send("printf 'shared-%s\\n' output; stty size\n")
  await first.next(0, '30 100')
  await second.next(0, '30 100')
  const third = await connect(id),
    snapshot = await third.next(4)
  expect(snapshot.readUInt16BE(1)).toBe(100)
  expect(snapshot.readUInt16BE(3)).toBe(30)
  expect(snapshot.subarray(5).toString()).toContain('shared-output')
  first.send("printf 'final-%s\\n' output; exit 7\n")
  await second.next(0, 'final-output')
  expect((await second.next(2)).readInt32BE(1)).toBe(7)
  expect(await (await request('/api/sessions')).json()).toEqual([])
}, 15000)

test('invalid websocket input closes only the viewer', async () => {
  start()
  const id = await create(),
    client = await connect(id)
  await client.next(4)
  const closed = new Promise<number>((resolve) =>
    client.socket.addEventListener('close', (event) => resolve(event.code)),
  )
  client.socket.send(sizePayload(1, 1, 24))
  expect(await closed).toBe(1008)
  expect(await (await request('/api/sessions')).json()).toEqual([id])
})

test('live output after a reconnect reconstructs the same screen', async () => {
  start()
  const id = await create(),
    first = await connect(id)
  await first.next(4)
  first.send(
    "stty -echo; for i in $(seq 1 40); do printf 'line-%s\\n' \"$i\"; sleep 0.005; done; printf 'done-%s\\n' marker\n",
  )
  await first.next(0, 'line-1')
  const second = await connect(id),
    initial = await second.next(4)
  const model = createTerminalState(initial.readUInt16BE(1), initial.readUInt16BE(3))
  try {
    await model.write(initial.subarray(5))
    await first.next(0, 'done-marker')
    await Bun.sleep(50)
    for (const message of second.messages.splice(0)) if (message[0] === 0) await model.write(message.subarray(1))
    const third = await connect(id),
      final = await third.next(4)
    const restored = createTerminalState(final.readUInt16BE(1), final.readUInt16BE(3))
    try {
      await restored.write(final.subarray(5))
      expect(model.snapshot()).toBe(restored.snapshot())
    } finally {
      restored.dispose()
    }
  } finally {
    model.dispose()
  }
}, 15000)

test('shutdown terminates PTY processes', async () => {
  start()
  const id = await create(),
    session = service.sessions.get(id)!
  await service.close()
  expect(session.process.exitCode !== null || session.process.signalCode !== null).toBe(true)
  expect(session.process.terminal!.closed).toBe(true)
})

test('shutdown waits for a session whose DELETE is still terminating its shell', async () => {
  start()
  const id = await create(),
    session = service.sessions.get(id)!,
    client = await connect(id)
  await client.next(4)
  client.send("trap '' HUP; printf 'ignore-%s\\n' ready; while :; do sleep 0.1; done\n")
  await client.next(0, 'ignore-ready')
  const deletion = request('/api/sessions?session=' + id, 'DELETE').catch(() => undefined)
  try {
    const deadline = Date.now() + 3000
    while (service.sessions.has(id) && Date.now() < deadline) await Bun.sleep(5)
    expect(service.sessions.has(id)).toBe(false)
    await service.close()
    expect(session.process.exitCode !== null || session.process.signalCode !== null).toBe(true)
  } finally {
    await session.close()
    await deletion
  }
}, 10000)
