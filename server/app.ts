import crypto from 'node:crypto'
import { stat, readdir } from 'node:fs/promises'
import path from 'node:path'
import express from 'express'
import mime from 'mime-types'
import { renameImages } from './rename-engine.js'
import type { ImageItem, ScanSession, SortRule, StoredImage } from './types.js'

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tif', '.tiff', '.avif'])
const SESSION_TTL = 60 * 60 * 1000
const sessions = new Map<string, ScanSession>()

function publicImage(image: StoredImage): ImageItem {
  const { absolutePath: _absolutePath, ...result } = image
  return result
}

function sortImages(images: StoredImage[], rule: SortRule): StoredImage[] {
  const [field, direction] = rule.split('-') as [string, 'asc' | 'desc']
  const multiplier = direction === 'asc' ? 1 : -1
  return [...images].sort((a, b) => {
    let value = 0
    if (field === 'created') value = a.createdAt - b.createdAt
    if (field === 'modified') value = a.modifiedAt - b.modifiedAt
    if (field === 'size') value = a.size - b.size
    if (field === 'name') value = a.name.localeCompare(b.name, 'zh-CN', { numeric: true, sensitivity: 'base' })
    return (value || a.name.localeCompare(b.name, 'zh-CN', { numeric: true })) * multiplier
  })
}

function getSession(id: string): ScanSession {
  const session = sessions.get(id)
  if (!session) throw new Error('扫描结果已失效，请重新扫描文件夹。')
  return session
}

function cleanupSessions(): void {
  const cutoff = Date.now() - SESSION_TTL
  for (const [id, session] of sessions) {
    if (session.createdAt < cutoff) sessions.delete(id)
  }
}

export function createApp(options: { webDist?: string } = {}) {
  const app = express()
  app.use(express.json({ limit: '1mb' }))

  app.get('/api/health', (_request, response) => response.json({ ok: true }))

  app.post('/api/scan', async (request, response) => {
    try {
      cleanupSessions()
      const folderPath = path.resolve(String(request.body.folderPath ?? ''))
      const rule = String(request.body.sortRule ?? 'created-asc') as SortRule
      if (!request.body.folderPath) throw new Error('请选择或输入图片文件夹。')
      if (!['created-asc', 'created-desc', 'modified-asc', 'modified-desc', 'size-asc', 'size-desc', 'name-asc', 'name-desc'].includes(rule)) {
        throw new Error('排序规则无效。')
      }
      const folderStat = await stat(folderPath)
      if (!folderStat.isDirectory()) throw new Error('输入的路径不是文件夹。')

      const entries = await readdir(folderPath, { withFileTypes: true })
      const images: StoredImage[] = []
      for (const entry of entries) {
        const extension = path.extname(entry.name).toLocaleLowerCase()
        if (!entry.isFile() || !IMAGE_EXTENSIONS.has(extension)) continue
        const absolutePath = path.join(folderPath, entry.name)
        const fileStat = await stat(absolutePath)
        images.push({
          id: crypto.randomUUID(),
          name: entry.name,
          extension: path.extname(entry.name),
          size: fileStat.size,
          createdAt: fileStat.birthtimeMs,
          modifiedAt: fileStat.mtimeMs,
          absolutePath,
        })
      }

      const ordered = sortImages(images, rule)
      const session: ScanSession = { id: crypto.randomUUID(), folderPath, createdAt: Date.now(), images: ordered }
      sessions.set(session.id, session)
      response.json({ sessionId: session.id, folderPath, images: ordered.map(publicImage) })
    } catch (error) {
      response.status(400).json({ error: error instanceof Error ? error.message : '扫描文件夹失败。' })
    }
  })

  app.get('/api/scans/:sessionId/images/:imageId', (request, response) => {
    try {
      const session = getSession(request.params.sessionId)
      const image = session.images.find((item) => item.id === request.params.imageId)
      if (!image) throw new Error('图片不存在或扫描结果已失效。')
      response.type(mime.lookup(image.absolutePath) || 'application/octet-stream')
      response.setHeader('Cache-Control', 'private, max-age=300')
      response.sendFile(image.absolutePath)
    } catch (error) {
      response.status(404).json({ error: error instanceof Error ? error.message : '图片不存在。' })
    }
  })

  app.post('/api/rename', async (request, response) => {
    try {
      const session = getSession(String(request.body.sessionId ?? ''))
      const orderedIds: string[] = Array.isArray(request.body.orderedIds) ? request.body.orderedIds.map(String) : []
      if (orderedIds.length !== session.images.length || new Set(orderedIds).size !== session.images.length) {
        throw new Error('请为文件夹中的每一张图片指定顺序。')
      }
      const imageMap = new Map(session.images.map((image) => [image.id, image]))
      const orderedImages = orderedIds.map((id) => imageMap.get(id))
      if (orderedImages.some((image) => !image)) throw new Error('图片顺序中包含无效项目，请重新扫描。')
      for (const image of orderedImages as StoredImage[]) {
        const latest = await stat(image.absolutePath)
        if (latest.size !== image.size || Math.abs(latest.mtimeMs - image.modifiedAt) > 2) {
          throw new Error(`图片在扫描后发生变化，请重新扫描：${image.name}`)
        }
      }

      const results = await renameImages({
        folderPath: session.folderPath,
        images: orderedImages as StoredImage[],
        prefix: String(request.body.prefix ?? ''),
        startNumber: Number(request.body.startNumber ?? 1),
        padding: Number(request.body.padding ?? 0),
      })
      sessions.delete(session.id)
      response.json({ renamed: results.length, results })
    } catch (error) {
      response.status(400).json({ error: error instanceof Error ? error.message : '重命名失败。' })
    }
  })

  if (options.webDist) {
    app.use(express.static(options.webDist))
    app.use((request, response, next) => {
      if (request.method !== 'GET' || request.path.startsWith('/api/')) return next()
      response.sendFile(path.join(options.webDist!, 'index.html'))
    })
  }

  app.use((_request, response) => response.status(404).json({ error: '接口不存在。' }))
  return app
}
