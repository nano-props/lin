import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dir, '..')
await mkdir(resolve(root, 'build'), { recursive: true })
await mkdir(resolve(root, 'dist'), { recursive: true })
const imports: string[] = [],
  entries: string[] = []
for await (const file of new Bun.Glob('**/*').scan({ cwd: resolve(root, 'web/dist'), onlyFiles: true })) {
  if (file.endsWith('.map')) continue
  const name = `asset${imports.length}`
  imports.push(`import ${name} from ${JSON.stringify(resolve(root, 'web/dist', file))} with { type: 'file' }`)
  entries.push(`[${JSON.stringify('/' + file)}, ${name}]`)
}
if (!imports.length) throw new Error('Build the frontend before compiling the server')
const entry = resolve(root, 'build/entry.ts')
await writeFile(
  entry,
  `${imports.join('\n')}\nimport { main } from '../server/src/index.ts'\nawait main(new Map([${entries.join(',\n')}]))\n`,
)
const result = Bun.spawnSync([process.execPath, 'build', '--compile', entry, '--outfile', resolve(root, 'dist/lin')], {
  stdio: ['inherit', 'inherit', 'inherit'],
})
if (result.exitCode) process.exit(result.exitCode)
