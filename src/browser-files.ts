const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tif', '.tiff', '.avif'])
const INVALID_PREFIX = /[\\/:*?"<>|]/

export interface BrowserFileHandle {
  kind: 'file'
  name: string
  getFile(): Promise<File>
  createWritable(): Promise<FileSystemWritableFileStream>
}

export interface BrowserDirectoryHandle {
  kind: 'directory'
  name: string
  values(): AsyncIterableIterator<BrowserFileHandle | BrowserDirectoryHandle>
  getFileHandle(name: string, options?: { create?: boolean }): Promise<BrowserFileHandle>
  removeEntry(name: string): Promise<void>
}

export interface BrowserImage {
  id: string
  name: string
  extension: string
  size: number
  createdAt: number
  modifiedAt: number
  previewUrl: string
  handle: BrowserFileHandle
}

type DirectoryPickerWindow = Window & {
  showDirectoryPicker?: (options?: { id?: string; mode?: 'read' | 'readwrite'; startIn?: string }) => Promise<BrowserDirectoryHandle>
}

export function supportsDirectoryPicker(): boolean {
  return typeof (window as DirectoryPickerWindow).showDirectoryPicker === 'function'
}

export async function chooseBrowserDirectory(): Promise<BrowserDirectoryHandle> {
  const picker = (window as DirectoryPickerWindow).showDirectoryPicker
  if (!picker) throw new Error('当前浏览器不支持本地文件夹授权，请使用最新版 Chrome 或 Edge。')
  return picker({ id: 'isr-image-folder', mode: 'readwrite', startIn: 'pictures' })
}

function extensionOf(name: string): string {
  const index = name.lastIndexOf('.')
  return index < 0 ? '' : name.slice(index)
}

export async function scanBrowserDirectory(directory: BrowserDirectoryHandle): Promise<BrowserImage[]> {
  const images: BrowserImage[] = []
  for await (const handle of directory.values()) {
    if (handle.kind !== 'file') continue
    const extension = extensionOf(handle.name)
    if (!IMAGE_EXTENSIONS.has(extension.toLocaleLowerCase())) continue
    const file = await handle.getFile()
    images.push({
      id: crypto.randomUUID(),
      name: handle.name,
      extension,
      size: file.size,
      createdAt: file.lastModified,
      modifiedAt: file.lastModified,
      previewUrl: URL.createObjectURL(file),
      handle,
    })
  }
  return images
}

export function releaseBrowserPreviews(images: Array<{ previewUrl?: string }>): void {
  for (const image of images) {
    if (image.previewUrl) URL.revokeObjectURL(image.previewUrl)
  }
}

function validatePrefix(prefix: string): string {
  const value = prefix.trim()
  if (!value) throw new Error('请输入文件名前缀。')
  if (INVALID_PREFIX.test(value)) throw new Error('前缀不能包含 \\ / : * ? " < > |。')
  if (/[. ]$/.test(value)) throw new Error('前缀不能以空格或句点结尾。')
  if (value.length > 120) throw new Error('前缀过长，请控制在 120 个字符以内。')
  return value
}

async function copyFile(directory: BrowserDirectoryHandle, source: BrowserFileHandle, targetName: string): Promise<void> {
  const sourceFile = await source.getFile()
  const target = await directory.getFileHandle(targetName, { create: true })
  const writable = await target.createWritable()
  try {
    await writable.write(sourceFile)
  } finally {
    await writable.close()
  }
}

async function namesIn(directory: BrowserDirectoryHandle): Promise<Set<string>> {
  const names = new Set<string>()
  for await (const handle of directory.values()) names.add(handle.name.toLocaleLowerCase())
  return names
}

export async function renameBrowserImages(options: {
  directory: BrowserDirectoryHandle
  images: BrowserImage[]
  prefix: string
  startNumber: number
  padding: number
}): Promise<number> {
  const prefix = validatePrefix(options.prefix)
  if (!Number.isInteger(options.startNumber) || options.startNumber < 0) throw new Error('起始编号必须是大于或等于 0 的整数。')
  if (!Number.isInteger(options.padding) || options.padding < 0 || options.padding > 12) throw new Error('补零位数必须是 0 到 12 之间的整数。')
  if (options.images.length === 0) throw new Error('没有可重命名的图片。')
  if (options.images.some((image) => !image.handle)) throw new Error('网页文件权限已失效，请重新选择文件夹。')

  const sourceNames = new Set(options.images.map((image) => image.name.toLocaleLowerCase()))
  const existingNames = await namesIn(options.directory)
  const operations = options.images.map((image, index) => {
    const number = String(options.startNumber + index).padStart(options.padding, '0')
    return {
      image,
      targetName: `${prefix}${number}${image.extension}`,
      tempName: `.isr-${crypto.randomUUID()}${image.extension}`,
    }
  })
  const targetNames = operations.map((operation) => operation.targetName.toLocaleLowerCase())
  if (new Set(targetNames).size !== targetNames.length) throw new Error('生成的文件名存在重复，请调整前缀或编号。')
  for (const operation of operations) {
    const key = operation.targetName.toLocaleLowerCase()
    if (existingNames.has(key) && !sourceNames.has(key)) throw new Error(`目标文件已存在：${operation.targetName}`)
  }

  const createdTemps: string[] = []
  try {
    for (const operation of operations) {
      await copyFile(options.directory, operation.image.handle, operation.tempName)
      createdTemps.push(operation.tempName)
    }
  } catch (error) {
    await Promise.all(createdTemps.map((name) => options.directory.removeEntry(name).catch(() => undefined)))
    throw error
  }

  try {
    for (const operation of operations) await options.directory.removeEntry(operation.image.name)
    for (const operation of operations) {
      const temp = await options.directory.getFileHandle(operation.tempName)
      await copyFile(options.directory, temp, operation.targetName)
    }
  } catch (error) {
    let restoreFailed = false
    for (const operation of operations) {
      await options.directory.removeEntry(operation.targetName).catch(() => undefined)
    }
    for (const operation of operations) {
      try {
        const temp = await options.directory.getFileHandle(operation.tempName)
        await copyFile(options.directory, temp, operation.image.name)
      } catch {
        restoreFailed = true
      }
    }
    if (restoreFailed) {
      throw new Error('重命名失败，部分原文件未能自动恢复；为避免数据丢失，文件夹中的 .isr- 临时副本已保留。')
    }
    await Promise.all(createdTemps.map((name) => options.directory.removeEntry(name).catch(() => undefined)))
    throw error
  }

  await Promise.all(createdTemps.map((name) => options.directory.removeEntry(name).catch(() => undefined)))
  return operations.length
}
