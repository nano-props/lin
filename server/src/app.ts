import { Hono, type Context } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { getCookie, setCookie } from 'hono/cookie'
import { bodyLimit } from 'hono/body-limit'
import { upgradeWebSocket, websocket } from '@hono/bun'
import type { ServerWebSocket } from 'bun'
import { createHash, timingSafeEqual } from 'node:crypto'
import { resolve } from 'node:path'
import type { ServerConfig } from './config'
import { Session } from './session'
import { SocketViewer } from './viewer'
import { decodeInput } from './protocol'

export type Assets = Map<string, string>
const cookieName = 'lin_access'
// Browsers cap persistent cookies at 400 days; authenticated HTTP requests renew it.
const cookieMaxAge = 400 * 24 * 60 * 60
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function equalToken(expected: string, actual: string | undefined) {
  const hash = (value: string) => createHash('sha256').update(value).digest()
  return actual !== undefined && timingSafeEqual(hash(expected), hash(actual))
}

function rememberLogin(c: Context, token: string) {
  setCookie(c, cookieName, token, {
    httpOnly: true,
    sameSite: 'Strict',
    path: '/',
    maxAge: cookieMaxAge,
    secure:
      c.req.header('x-forwarded-proto')?.toLowerCase() === 'https' || c.req.header('origin')?.startsWith('https://'),
  })
}

export function startServer(config: ServerConfig, assets?: Assets) {
  const sessions = new Map<string, Session>()
  const closingSessions = new Set<Promise<void>>()
  function closeSession(session: Session) {
    const closing = session.close()
    closingSessions.add(closing)
    void closing.then(
      () => closingSessions.delete(closing),
      () => closingSessions.delete(closing),
    )
    return closing
  }
  const app = new Hono()
  let stopping = false
  app.use('*', async (c, next) => {
    if (stopping) return c.text('Server is stopping', 503)
    await next()
    // The WebSocket adapter owns upgrade response headers.
    if (c.req.path !== '/ws') {
      c.header('Cache-Control', 'no-store')
      c.header(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; connect-src 'self' ws: wss:; img-src 'self' data:",
      )
      c.header('Referrer-Policy', 'no-referrer')
      c.header('X-Content-Type-Options', 'nosniff')
      c.header('X-Frame-Options', 'DENY')
      c.header('Cross-Origin-Resource-Policy', 'same-origin')
    }
  })
  app.use('*', async (c, next) => {
    const path = c.req.path
    if ((path.startsWith('/api/') && path !== '/api/auth') || path === '/ws') {
      if (!equalToken(config.token, getCookie(c, cookieName))) return c.text('Authentication required', 401)
    }
    if (path === '/ws' || (path.startsWith('/api/') && !['GET', 'HEAD'].includes(c.req.method))) {
      const origin = c.req.header('origin'),
        host = c.req.header('host')
      if (!host || (origin !== `http://${host}` && origin !== `https://${host}`)) return c.text('Invalid origin', 403)
    }
    if (path.startsWith('/api/') && path !== '/api/auth') rememberLogin(c, config.token)
    await next()
  })
  app.post('/api/auth', bodyLimit({ maxSize: 4096 }), async (c) => {
    if (!equalToken(config.token, (await c.req.text()).trim())) return c.text('Invalid access token', 401)
    rememberLogin(c, config.token)
    return c.body(null, 204)
  })
  app.get('/api/auth/status', (c) => c.body(null, 204))
  app.get('/api/sessions', (c) => c.json([...sessions.keys()]))
  app.post('/api/sessions', (c) => {
    try {
      const session = new Session((id) => sessions.delete(id))
      sessions.set(session.id, session)
      return c.json(session.id, 201)
    } catch (error) {
      console.error('lin: unable to start terminal', error)
      return c.text('Unable to start terminal', 500)
    }
  })
  app.delete('/api/sessions', async (c) => {
    const id = c.req.query('session') ?? ''
    if (!uuid.test(id)) return c.text('Invalid terminal session id', 400)
    const session = sessions.get(id.toLowerCase())
    sessions.delete(id.toLowerCase())
    if (session) await closeSession(session)
    return c.body(null, 204)
  })
  app.get('/ws', async (c, next) => {
    const id = c.req.query('session') ?? ''
    if (!uuid.test(id)) return c.text('Invalid terminal session id', 400)
    const session = sessions.get(id.toLowerCase())
    if (!session) return c.text('Terminal session not found', 404)
    if (c.req.header('upgrade')?.toLowerCase() !== 'websocket') return c.text('WebSocket upgrade required', 400)
    let viewer: SocketViewer | undefined
    return upgradeWebSocket(() => ({
      onOpen(_event, ws) {
        viewer = new SocketViewer(ws.raw as ServerWebSocket<unknown>)
        void session.attach(viewer).catch(() => ws.close(1011, 'terminal failed'))
      },
      onMessage(event, ws) {
        try {
          const message = decodeInput(
            typeof event.data === 'string' ? event.data : new Uint8Array(event.data as ArrayBuffer),
          )
          if ('input' in message) session.write(message.input)
          else void session.resize(message.cols, message.rows).catch(() => ws.close(1011, 'resize failed'))
        } catch {
          ws.close(1008, 'invalid terminal message')
        }
      },
      onClose() {
        if (viewer) session.detach(viewer)
      },
      onError() {
        if (viewer) session.detach(viewer)
      },
    }))(c, next)
  })
  app.all('/api/*', (c) => c.text('Method or endpoint not supported', 405))
  app.all('*', async (c) => {
    if (!['GET', 'HEAD'].includes(c.req.method)) return c.text('Method not allowed', 405)
    let path: string
    try {
      path = decodeURIComponent(c.req.path)
    } catch {
      return c.notFound()
    }
    if (path.includes('\0') || path.includes('\\') || path.split('/').includes('..')) return c.notFound()
    if (path === '/') path = '/index.html'
    const location = assets ? assets.get(path) : resolve(import.meta.dir, '../../web/dist', `.${path}`)
    if (!location) return c.notFound()
    const file = Bun.file(location)
    if (!(await file.exists())) return c.notFound()
    return new Response(c.req.method === 'HEAD' ? null : file, {
      headers: { 'Content-Type': file.type, 'Content-Length': String(file.size) },
    })
  })
  app.onError((error, c) => {
    if (error instanceof HTTPException) return error.getResponse()
    console.error('lin: request failed', error)
    return c.text('Internal server error', 500)
  })
  const server = Bun.serve({
    hostname: config.host,
    port: config.port,
    fetch: app.fetch,
    maxRequestBodySize: 1024 * 1024,
    websocket: {
      ...websocket,
      maxPayloadLength: 1024 * 1024,
      idleTimeout: 0,
      backpressureLimit: 256 * 1024 * 1024,
      closeOnBackpressureLimit: true,
    },
  })
  const host = ['0.0.0.0', '::'].includes(config.host) ? '127.0.0.1' : config.host
  const origin = `http://${host.includes(':') ? `[${host}]` : host}:${server.port}`
  return {
    server,
    sessions,
    origin,
    accessUrl: `${origin}/?token=${encodeURIComponent(config.token)}`,
    async close() {
      stopping = true
      for (const session of sessions.values()) closeSession(session)
      // DELETE removes sessions from the public list before their shell has exited.
      await Promise.all(closingSessions)
      await server.stop(true)
    },
  }
}
