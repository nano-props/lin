import { parseConfig } from './config'
import { startServer, type Assets } from './app'

export async function main(assets?: Assets) {
  try {
    const config = await parseConfig(process.argv.slice(2))
    const service = startServer(config, assets)
    console.log(`lin is ready\n  ${service.accessUrl}\nPress Ctrl+C to stop.`)
    let stopping = false
    const stop = async () => {
      if (stopping) return
      stopping = true
      await service.close()
      process.exit(0)
    }
    process.on('SIGINT', stop)
    process.on('SIGTERM', stop)
  } catch (error) {
    console.error(`lin: ${error instanceof Error ? error.message : error}`)
    console.error('usage: lin [--host ADDRESS] [--port PORT] [--token TOKEN] [--allow-remote]')
    process.exitCode = 2
  }
}

if (import.meta.main) await main()
