export async function uploadTempFile(file: File, accessToken: string): Promise<string> {
  const response = await fetch('/api/temp-files', {
    method: 'POST',
    headers: { 'X-Lin-Access-Token': accessToken, 'X-Lin-Filename': file.name },
    body: file,
  })
  if (!response.ok) throw new Error((await response.text()).trim() || `Upload failed (${response.status})`)
  const payload = await response.json() as { path?: string }
  if (!payload.path) throw new Error('Upload response did not include a path')
  return shellQuote(payload.path)
}

function shellQuote(value: string): string {
  return /^[A-Za-z0-9_./:@%+=,-]+$/.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`
}
