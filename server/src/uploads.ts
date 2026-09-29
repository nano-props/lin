import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const uploadBodyLimit = 34 * 1024 * 1024
const fileLimit = 25 * 1024 * 1024
const batchLimit = 32 * 1024 * 1024

export class UploadStore {
  private directories = new Set<string>()
  private bytes = 0
  private count = 0
  private pending = new Set<Promise<string[]>>()
  private closed = false

  save(files: File[], permitted: () => boolean): Promise<string[]> {
    const operation = this.persist(files, permitted)
    this.pending.add(operation)
    void operation.then(
      () => this.pending.delete(operation),
      () => this.pending.delete(operation),
    )
    return operation
  }

  private async persist(files: File[], permitted: () => boolean): Promise<string[]> {
    if (this.closed || !permitted()) throw new Error('Terminal control changed. Take control and paste again.')
    if (!files.length || files.length > 256) throw new Error('Upload between 1 and 256 files at a time.')
    if (files.some((file) => file.size > fileLimit)) throw new Error('Each file must be 25 MiB or smaller.')
    const bytes = files.reduce((sum, file) => sum + file.size, 0)
    if (bytes > batchLimit) throw new Error('Upload at most 32 MiB at a time.')
    if (this.bytes + bytes > 256 * 1024 * 1024 || this.count + files.length > 1024)
      throw new Error('Temporary upload storage is full. Restart lin to clear it.')
    this.bytes += bytes
    this.count += files.length
    let directory: string | undefined
    try {
      directory = await mkdtemp(join(tmpdir(), 'lin-upload-'))
      const paths: string[] = []
      for (const [index, file] of files.entries()) {
        // At most 240 UTF-8 bytes, leaving room for the numeric prefix.
        const name =
          Array.from(file.name.replace(/[^\p{L}\p{N}._-]/gu, '_'))
            .slice(-60)
            .join('') || 'file'
        const path = join(directory, `${index}-${name}`)
        await writeFile(path, new Uint8Array(await file.arrayBuffer()), { mode: 0o600 })
        paths.push(path)
      }
      if (this.closed || !permitted())
        throw new Error('Terminal control changed. Paste again in the controlling window.')
      this.directories.add(directory)
      return paths
    } catch (error) {
      if (directory) await rm(directory, { recursive: true, force: true })
      this.bytes -= bytes
      this.count -= files.length
      throw error
    }
  }

  async close() {
    this.closed = true
    await Promise.allSettled(this.pending)
    await Promise.all([...this.directories].map((path) => rm(path, { recursive: true, force: true })))
    this.directories.clear()
  }
}
