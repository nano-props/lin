export function pasteFilesInsteadOfText(text: string, hasFiles: boolean): boolean {
  if (!hasFiles) return false
  if (!text.trim()) return true
  if (text.includes('\t')) return false
  return text
    .trim()
    .split(/\r?\n/)
    .every((line) => /^(?:\/|[a-z]:[\\/]|\\\\|file:\/\/)/i.test(line.trim()))
}

export function quotePaths(paths: unknown, count: number): string {
  if (
    !Array.isArray(paths) ||
    paths.length !== count ||
    !paths.every((path) => typeof path === 'string' && path.startsWith('/') && !/[\x00-\x1f\x7f-\x9f]/.test(path))
  )
    throw new Error('The server returned invalid file paths.')
  return paths.map((path: string) => "'" + path.replaceAll("'", "'\\''") + "'").join(' ') + ' '
}

export async function uploadTerminalFiles(
  files: File[],
  session: string,
  viewer: string,
  signal: AbortSignal,
): Promise<string> {
  if (!files.length || files.length > 256) throw new Error('Upload between 1 and 256 files at a time.')
  if (files.some((file) => file.size > 25 * 1024 * 1024)) throw new Error('Each file must be 25 MiB or smaller.')
  if (files.reduce((total, file) => total + file.size, 0) > 32 * 1024 * 1024)
    throw new Error('Upload at most 32 MiB at a time.')
  const body = new FormData()
  for (const file of files) body.append('files', file)
  const response = await fetch(
    `/api/uploads?session=${encodeURIComponent(session)}&viewer=${encodeURIComponent(viewer)}`,
    { method: 'POST', body, signal, credentials: 'same-origin' },
  )
  if (!response.ok) throw new Error((await response.text()) || 'Unable to upload files.')
  return quotePaths(await response.json(), files.length)
}
