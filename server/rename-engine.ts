import { access, rename } from 'node:fs/promises'
import path from 'node:path'
import type { StoredImage } from './types.js'

const INVALID_PREFIX = /[\\/:*?"<>|]/

export interface RenameOptions {
  folderPath: string
  images: StoredImage[]
  prefix: string
  startNumber: number
  padding: number
}

export interface RenameResult {
  from: string
  to: string
}

function pathKey(value: string): string {
  return process.platform === 'win32' ? value.toLocaleLowerCase() : value
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

export function validatePrefix(prefix: string): string {
  const value = prefix.trim()
  if (!value) throw new Error('请输入文件名前缀。')
  if (INVALID_PREFIX.test(value)) throw new Error('前缀不能包含 \\ / : * ? " < > |。')
  if (/[. ]$/.test(value)) throw new Error('前缀不能以空格或句点结尾。')
  if (value.length > 120) throw new Error('前缀过长，请控制在 120 个字符以内。')
  return value
}

export async function renameImages(options: RenameOptions): Promise<RenameResult[]> {
  const prefix = validatePrefix(options.prefix)
  if (!Number.isInteger(options.startNumber) || options.startNumber < 0) {
    throw new Error('起始编号必须是大于或等于 0 的整数。')
  }
  if (!Number.isInteger(options.padding) || options.padding < 0 || options.padding > 12) {
    throw new Error('补零位数必须是 0 到 12 之间的整数。')
  }
  if (options.images.length === 0) throw new Error('没有可重命名的图片。')

  const sourceKeys = new Set(options.images.map((image) => pathKey(image.absolutePath)))
  const operations = options.images.map((image, index) => {
    const number = String(options.startNumber + index).padStart(options.padding, '0')
    const targetName = `${prefix}${number}${image.extension}`
    return {
      source: image.absolutePath,
      originalName: image.name,
      target: path.join(options.folderPath, targetName),
      targetName,
      temp: path.join(options.folderPath, `.image-renamer-${crypto.randomUUID()}${image.extension}`),
      current: image.absolutePath,
    }
  })

  const targetKeys = operations.map((operation) => pathKey(operation.target))
  if (new Set(targetKeys).size !== targetKeys.length) {
    throw new Error('生成的文件名存在重复，请调整前缀或编号。')
  }

  for (const operation of operations) {
    if ((await exists(operation.target)) && !sourceKeys.has(pathKey(operation.target))) {
      throw new Error(`目标文件已存在：${operation.targetName}`)
    }
  }

  try {
    for (const operation of operations) {
      await rename(operation.source, operation.temp)
      operation.current = operation.temp
    }
    for (const operation of operations) {
      await rename(operation.temp, operation.target)
      operation.current = operation.target
    }
  } catch (error) {
    const rollbackLocations: Array<{ operation: (typeof operations)[number]; location: string }> = []
    for (const operation of operations) {
      if (operation.current !== operation.source && (await exists(operation.current))) {
        const location = path.join(options.folderPath, `.image-renamer-rollback-${crypto.randomUUID()}${path.extname(operation.current)}`)
        await rename(operation.current, location).catch(() => undefined)
        rollbackLocations.push({ operation, location })
      }
    }
    for (const item of rollbackLocations) {
      await rename(item.location, item.operation.source).catch(() => undefined)
    }
    throw error
  }

  return operations.map((operation) => ({ from: operation.originalName, to: operation.targetName }))
}
