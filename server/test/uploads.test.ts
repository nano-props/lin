import { expect, test } from 'bun:test'
import { UploadStore } from '../src/uploads'

test('uploads validate file, batch and count limits before saving', async () => {
  const store = new UploadStore()
  try {
    await expect(store.save([], () => true)).rejects.toThrow('1 and 256')
    await expect(
      store.save(
        Array.from({ length: 257 }, () => new File([], 'file')),
        () => true,
      ),
    ).rejects.toThrow('1 and 256')
    await expect(store.save([new File([new Uint8Array(26 * 1024 * 1024)], 'big')], () => true)).rejects.toThrow(
      '25 MiB',
    )
    const file = new File([new Uint8Array(17 * 1024 * 1024)], 'file')
    await expect(store.save([file, file], () => true)).rejects.toThrow('32 MiB')
  } finally {
    await store.close()
  }
})

test('an upload cannot finish after its control permit is revoked', async () => {
  const store = new UploadStore()
  let permitted = true
  const reading = Promise.withResolvers<void>()
  const release = Promise.withResolvers<ArrayBuffer>()
  const file = new File(['content'], 'file')
  file.arrayBuffer = () => {
    reading.resolve()
    return release.promise
  }
  const saving = store.save([file], () => permitted)
  void saving.catch(() => undefined)
  await reading.promise
  permitted = false
  release.resolve(new ArrayBuffer(0))
  await expect(saving).rejects.toThrow('control changed')
  await store.close()
})

test('long Unicode filenames fit the filesystem byte limit without splitting characters', async () => {
  const store = new UploadStore()
  try {
    const files = [new File(['CJK'], '文'.repeat(100) + '.txt'), new File(['astral'], '𐐀'.repeat(100) + '.txt')]
    const paths = await store.save(files, () => true)
    for (const path of paths) {
      expect(Buffer.byteLength(path.split('/').at(-1)!)).toBeLessThanOrEqual(244)
      expect(path).not.toContain('�')
    }
    expect(await Bun.file(paths[0]!).text()).toBe('CJK')
    expect(await Bun.file(paths[1]!).text()).toBe('astral')
  } finally {
    await store.close()
  }
})
