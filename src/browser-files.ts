export type FileCategory = 'all' | 'image' | 'video' | 'audio' | 'document' | 'archive' | 'other'
export type ConcreteFileCategory = Exclude<FileCategory, 'all'>

const CATEGORY_EXTENSIONS: Record<Exclude<ConcreteFileCategory, 'other'>, ReadonlySet<string>> = {
  image: new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tif', '.tiff', '.avif', '.heic', '.svg']),
  video: new Set(['.mp4', '.mkv', '.mov', '.avi', '.webm', '.wmv', '.m4v', '.flv', '.mpeg', '.mpg', '.3gp', '.ts']),
  audio: new Set(['.mp3', '.wav', '.flac', '.aac', '.ogg', '.m4a', '.wma', '.opus', '.aiff']),
  document: new Set(['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.md', '.rtf', '.csv', '.json', '.xml', '.epub']),
  archive: new Set(['.zip', '.rar', '.7z', '.tar', '.gz', '.bz2', '.xz', '.cab', '.iso']),
}
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

export interface BrowserFileItem {
  id: string
  name: string
  extension: string
  size: number
  createdAt: number
  modifiedAt: number
  category: ConcreteFileCategory
  previewUrl?: string
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
  return picker({ id: 'fsr-file-folder', mode: 'readwrite', startIn: 'downloads' })
}

function extensionOf(name: string): string {
  const index = name.lastIndexOf('.')
  return index <= 0 ? '' : name.slice(index)
}

export function fileCategoryOf(extension: string): ConcreteFileCategory {
  const normalized = extension.toLocaleLowerCase()
  for (const [category, extensions] of Object.entries(CATEGORY_EXTENSIONS)) {
    if (extensions.has(normalized)) return category as ConcreteFileCategory
  }
  return 'other'
}

export async function scanBrowserDirectory(
  directory: BrowserDirectoryHandle,
  category: FileCategory = 'all',
): Promise<BrowserFileItem[]> {
  const files: BrowserFileItem[] = []
  for await (const handle of directory.values()) {
    if (handle.kind !== 'file') continue
    const extension = extensionOf(handle.name)
    const fileCategory = fileCategoryOf(extension)
    if (category !== 'all' && fileCategory !== category) continue
    const file = await handle.getFile()
    files.push({
      id: crypto.randomUUID(),
      name: handle.name,
      extension,
      size: file.size,
      createdAt: file.lastModified,
      modifiedAt: file.lastModified,
      category: fileCategory,
      previewUrl: fileCategory === 'image' || fileCategory === 'video' ? URL.createObjectURL(file) : undefined,
      handle,
    })
  }
  return files
}

export function releaseBrowserPreviews(files: Array<{ previewUrl?: string }>): void {
  for (const file of files) {
    if (file.previewUrl) URL.revokeObjectURL(file.previewUrl)
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

export async function renameBrowserFiles(options: {
  directory: BrowserDirectoryHandle
  files: BrowserFileItem[]
  prefix: string
  startNumber: number
  padding: number
}): Promise<number> {
  const prefix = validatePrefix(options.prefix)
  if (!Number.isInteger(options.startNumber) || options.startNumber < 0) throw new Error('起始编号必须是大于或等于 0 的整数。')
  if (!Number.isInteger(options.padding) || options.padding < 0 || options.padding > 12) throw new Error('补零位数必须是 0 到 12 之间的整数。')
  if (options.files.length === 0) throw new Error('没有可重命名的文件。')
  if (options.files.some((file) => !file.handle)) throw new Error('网页文件权限已失效，请重新选择文件夹。')

  const sourceNames = new Set(options.files.map((file) => file.name.toLocaleLowerCase()))
  const existingNames = await namesIn(options.directory)
  const operations = options.files.map((file, index) => {
    const number = String(options.startNumber + index).padStart(options.padding, '0')
    return {
      file,
      targetName: `${prefix}${number}${file.extension}`,
      tempName: `.fsr-${crypto.randomUUID()}${file.extension}`,
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
      await copyFile(options.directory, operation.file.handle, operation.tempName)
      createdTemps.push(operation.tempName)
    }
  } catch (error) {
    await Promise.all(createdTemps.map((name) => options.directory.removeEntry(name).catch(() => undefined)))
    throw error
  }

  try {
    for (const operation of operations) await options.directory.removeEntry(operation.file.name)
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
        await copyFile(options.directory, temp, operation.file.name)
      } catch {
        restoreFailed = true
      }
    }
    if (restoreFailed) {
      throw new Error('重命名失败，部分原文件未能自动恢复；为避免数据丢失，文件夹中的 .fsr- 临时副本已保留。')
    }
    await Promise.all(createdTemps.map((name) => options.directory.removeEntry(name).catch(() => undefined)))
    throw error
  }

  await Promise.all(createdTemps.map((name) => options.directory.removeEntry(name).catch(() => undefined)))
  return operations.length
}
