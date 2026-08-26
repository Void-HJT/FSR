import crypto from 'node:crypto'
import { stat, readdir } from 'node:fs/promises'
import path from 'node:path'
import express from 'express'
import mime from 'mime-types'
import { fileCategoryOf } from './file-types.js'
import { renameFiles } from './rename-engine.js'
import type { FileCategory, FileItem, ScanSession, SortRule, StoredFile } from './types.js'

const SESSION_TTL = 60 * 60 * 1000
const FILE_CATEGORIES: FileCategory[] = ['all', 'image', 'video', 'audio', 'document', 'archive', 'other']
const sessions = new Map<string, ScanSession>()

function publicFile(file: StoredFile): FileItem {
  const { absolutePath: _absolutePath, ...result } = file
  return result
}

function sortFiles(files: StoredFile[], rule: SortRule): StoredFile[] {
  const [field, direction] = rule.split('-') as [string, 'asc' | 'desc']
  const multiplier = direction === 'asc' ? 1 : -1
  return [...files].sort((a, b) => {
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
      const category = String(request.body.category ?? 'all') as FileCategory
      if (!request.body.folderPath) throw new Error('请选择或输入文件夹。')
      if (!['created-asc', 'created-desc', 'modified-asc', 'modified-desc', 'size-asc', 'size-desc', 'name-asc', 'name-desc'].includes(rule)) {
        throw new Error('排序规则无效。')
      }
      if (!FILE_CATEGORIES.includes(category)) throw new Error('文件类型无效。')
      const folderStat = await stat(folderPath)
      if (!folderStat.isDirectory()) throw new Error('输入的路径不是文件夹。')

      const entries = await readdir(folderPath, { withFileTypes: true })
      const files: StoredFile[] = []
      for (const entry of entries) {
        if (!entry.isFile()) continue
        const extension = path.extname(entry.name)
        const fileCategory = fileCategoryOf(extension)
        if (category !== 'all' && fileCategory !== category) continue
        const absolutePath = path.join(folderPath, entry.name)
        const fileStat = await stat(absolutePath)
        files.push({
          id: crypto.randomUUID(),
          name: entry.name,
          extension,
          size: fileStat.size,
          createdAt: fileStat.birthtimeMs,
          modifiedAt: fileStat.mtimeMs,
          category: fileCategory,
          absolutePath,
        })
      }

      const ordered = sortFiles(files, rule)
      const session: ScanSession = { id: crypto.randomUUID(), folderPath, createdAt: Date.now(), files: ordered }
      sessions.set(session.id, session)
      response.json({ sessionId: session.id, folderPath, files: ordered.map(publicFile) })
    } catch (error) {
      response.status(400).json({ error: error instanceof Error ? error.message : '扫描文件夹失败。' })
    }
  })

  app.get('/api/scans/:sessionId/files/:fileId', (request, response) => {
    try {
      const session = getSession(request.params.sessionId)
      const file = session.files.find((item) => item.id === request.params.fileId)
      if (!file) throw new Error('文件不存在或扫描结果已失效。')
      response.type(mime.lookup(file.absolutePath) || 'application/octet-stream')
      response.setHeader('Cache-Control', 'private, max-age=300')
      response.sendFile(file.absolutePath)
    } catch (error) {
      response.status(404).json({ error: error instanceof Error ? error.message : '文件不存在。' })
    }
  })

  app.post('/api/rename', async (request, response) => {
    try {
      const session = getSession(String(request.body.sessionId ?? ''))
      const orderedIds: string[] = Array.isArray(request.body.orderedIds) ? request.body.orderedIds.map(String) : []
      if (orderedIds.length !== session.files.length || new Set(orderedIds).size !== session.files.length) {
        throw new Error('请为当前筛选结果中的每个文件指定顺序。')
      }
      const fileMap = new Map(session.files.map((file) => [file.id, file]))
      const orderedFiles = orderedIds.map((id) => fileMap.get(id))
      if (orderedFiles.some((file) => !file)) throw new Error('文件顺序中包含无效项目，请重新扫描。')
      for (const file of orderedFiles as StoredFile[]) {
        const latest = await stat(file.absolutePath)
        if (latest.size !== file.size || Math.abs(latest.mtimeMs - file.modifiedAt) > 2) {
          throw new Error(`文件在扫描后发生变化，请重新扫描：${file.name}`)
        }
      }

      const results = await renameFiles({
        folderPath: session.folderPath,
        files: orderedFiles as StoredFile[],
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
