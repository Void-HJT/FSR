import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { renameImages, validatePrefix } from './rename-engine.js'
import type { StoredImage } from './types.js'

const temporaryFolders: string[] = []

afterEach(async () => {
  await Promise.all(temporaryFolders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })))
})

async function image(folder: string, name: string, content: string): Promise<StoredImage> {
  const absolutePath = path.join(folder, name)
  await writeFile(absolutePath, content)
  const fileStat = await stat(absolutePath)
  return {
    id: crypto.randomUUID(),
    name,
    extension: path.extname(name),
    size: fileStat.size,
    createdAt: fileStat.birthtimeMs,
    modifiedAt: fileStat.mtimeMs,
    absolutePath,
  }
}

describe('renameImages', () => {
  it('uses a two-phase rename when generated names overlap source names', async () => {
    const folder = await mkdtemp(path.join(os.tmpdir(), 'image-renamer-'))
    temporaryFolders.push(folder)
    const first = await image(folder, '照片1.jpg', 'first')
    const second = await image(folder, '照片2.jpg', 'second')

    const result = await renameImages({
      folderPath: folder,
      images: [second, first],
      prefix: '照片',
      startNumber: 1,
      padding: 0,
    })

    expect(result).toEqual([
      { from: '照片2.jpg', to: '照片1.jpg' },
      { from: '照片1.jpg', to: '照片2.jpg' },
    ])
    expect(await readFile(path.join(folder, '照片1.jpg'), 'utf8')).toBe('second')
    expect(await readFile(path.join(folder, '照片2.jpg'), 'utf8')).toBe('first')
  })

  it('supports padded numbers while preserving each extension', async () => {
    const folder = await mkdtemp(path.join(os.tmpdir(), 'image-renamer-'))
    temporaryFolders.push(folder)
    const source = await image(folder, 'source.PNG', 'image')

    await renameImages({ folderPath: folder, images: [source], prefix: '旅行-', startNumber: 7, padding: 3 })

    expect(await readFile(path.join(folder, '旅行-007.PNG'), 'utf8')).toBe('image')
  })

  it('rejects path characters in prefixes', () => {
    expect(() => validatePrefix('../escape')).toThrow('前缀不能包含')
  })
})
