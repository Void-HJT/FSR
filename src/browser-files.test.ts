import { describe, expect, it } from 'vitest'
import {
  fileCategoryOf,
  renameBrowserFiles,
  scanBrowserDirectory,
  type BrowserDirectoryHandle,
  type BrowserFileHandle,
  type BrowserFileItem,
} from './browser-files'

class MemoryFile implements BrowserFileHandle {
  readonly kind = 'file' as const

  constructor(readonly name: string, private readonly files: Map<string, Blob>) {}

  async getFile(): Promise<File> {
    const content = this.files.get(this.name)
    if (!content) throw new DOMException('Not found', 'NotFoundError')
    return new File([content], this.name, { type: content.type, lastModified: 1 })
  }

  async createWritable(): Promise<FileSystemWritableFileStream> {
    const chunks: BlobPart[] = []
    return {
      write: async (chunk: FileSystemWriteChunkType) => {
        if (chunk instanceof Blob) chunks.push(chunk)
        else if (typeof chunk === 'string' || chunk instanceof ArrayBuffer || ArrayBuffer.isView(chunk)) chunks.push(chunk)
      },
      close: async () => {
        this.files.set(this.name, new Blob(chunks))
      },
    } as FileSystemWritableFileStream
  }
}

class MemoryDirectory implements BrowserDirectoryHandle {
  readonly kind = 'directory' as const
  readonly name = 'files'
  readonly files = new Map<string, Blob>()

  async *values(): AsyncIterableIterator<BrowserFileHandle> {
    for (const name of this.files.keys()) yield new MemoryFile(name, this.files)
  }

  async getFileHandle(name: string, options?: { create?: boolean }): Promise<BrowserFileHandle> {
    if (!this.files.has(name)) {
      if (!options?.create) throw new DOMException('Not found', 'NotFoundError')
      this.files.set(name, new Blob())
    }
    return new MemoryFile(name, this.files)
  }

  async removeEntry(name: string): Promise<void> {
    if (!this.files.delete(name)) throw new DOMException('Not found', 'NotFoundError')
  }
}

async function browserFile(directory: MemoryDirectory, name: string, content: string): Promise<BrowserFileItem> {
  directory.files.set(name, new Blob([content]))
  const handle = await directory.getFileHandle(name)
  return {
    id: crypto.randomUUID(),
    name,
    extension: name.slice(name.lastIndexOf('.')),
    size: content.length,
    createdAt: 1,
    modifiedAt: 1,
    category: fileCategoryOf(name.slice(name.lastIndexOf('.'))),
    previewUrl: `blob:${name}`,
    handle,
  }
}

describe('renameBrowserFiles', () => {
  it('renames in the supplied visual order and preserves extensions', async () => {
    const directory = new MemoryDirectory()
    const first = await browserFile(directory, 'first.jpg', 'first-content')
    const second = await browserFile(directory, 'second.png', 'second-content')

    const renamed = await renameBrowserFiles({
      directory,
      files: [second, first],
      prefix: '旅行-',
      startNumber: 1,
      padding: 2,
    })

    expect(renamed).toBe(2)
    expect(await directory.files.get('旅行-01.png')!.text()).toBe('second-content')
    expect(await directory.files.get('旅行-02.jpg')!.text()).toBe('first-content')
    expect([...directory.files.keys()].some((name) => name.startsWith('.fsr-'))).toBe(false)
  })

  it('does not overwrite an unselected file with a generated target name', async () => {
    const directory = new MemoryDirectory()
    const source = await browserFile(directory, 'source.jpg', 'source')
    directory.files.set('图片1.jpg', new Blob(['occupied']))

    await expect(renameBrowserFiles({
      directory,
      files: [source],
      prefix: '图片',
      startNumber: 1,
      padding: 0,
    })).rejects.toThrow('目标文件已存在')
  })

  it('returns only videos when the video category is selected', async () => {
    const directory = new MemoryDirectory()
    directory.files.set('clip.mp4', new Blob(['video']))
    directory.files.set('photo.jpg', new Blob(['image']))
    directory.files.set('notes.txt', new Blob(['document']))

    const files = await scanBrowserDirectory(directory, 'video')

    expect(files.map((file) => file.name)).toEqual(['clip.mp4'])
    expect(files[0].category).toBe('video')
  })
})
