import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { randomBytes } from 'node:crypto'

export interface ServerConfig {
  host: string
  port: number
  token: string
}

export async function parseConfig(args: string[], env: NodeJS.ProcessEnv = process.env): Promise<ServerConfig> {
  let host = env.LIN_HOST ?? '127.0.0.1'
  let portValue = env.LIN_PORT ?? '7681'
  let token = env.LIN_TOKEN
  let remote = env.LIN_ALLOW_REMOTE ?? 'false'
  for (let i = 0; i < args.length; i++) {
    const option = args[i]!
    if (option === '--allow-remote') {
      remote = 'true'
      continue
    }
    if (!['--host', '--port', '--token'].includes(option)) throw new Error(`unknown option: ${option}`)
    const value = args[++i]
    if (!value?.trim()) throw new Error(`missing value for ${option}`)
    if (option === '--host') host = value
    if (option === '--port') portValue = value
    if (option === '--token') token = value
  }
  if (!/^\d+$/.test(portValue) || Number(portValue) > 65535) throw new Error(`invalid port: ${portValue}`)
  const flag = remote.trim().toLowerCase()
  if (!['true', '1', 'yes', 'on', 'false', '0', 'no', 'off', ''].includes(flag)) {
    throw new Error(`invalid boolean for LIN_ALLOW_REMOTE: ${remote}`)
  }
  if (!host.trim()) throw new Error('host must not be empty')
  if (!isIP(host)) {
    try {
      host = (await lookup(host)).address
    } catch {
      throw new Error(`cannot resolve host: ${host}`)
    }
  }
  const loopback = host === '::1' || /^127\./.test(host) || /^::ffff:127\./i.test(host)
  if (!loopback && !['true', '1', 'yes', 'on'].includes(flag)) {
    throw new Error('refusing a non-loopback address without --allow-remote')
  }
  token ??= randomBytes(32).toString('base64url')
  if (token.length < 16) throw new Error('token must contain at least 16 characters')
  return { host, port: Number(portValue), token }
}
