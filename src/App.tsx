import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import {
  chooseBrowserDirectory,
  releaseBrowserPreviews,
  renameBrowserFiles,
  scanBrowserDirectory,
  supportsDirectoryPicker,
  type BrowserDirectoryHandle,
  type BrowserFileHandle,
  type ConcreteFileCategory,
  type FileCategory,
} from './browser-files'
import { advanceSelectionPath, findStableDropSlot, insertBatchAtIndex, type DragSlot } from './order-utils'

type AutomaticSortRule =
  | 'created-asc'
  | 'created-desc'
  | 'modified-asc'
  | 'modified-desc'
  | 'size-asc'
  | 'size-desc'

type SortRule = AutomaticSortRule | 'custom'
type CustomPhase = 'building' | 'adjusting'
type DropPosition = {
  targetId: string
  side: 'before' | 'after'
  insertionIndex: number
  markerLeft: number
  markerTop: number
  markerHeight: number
}
type BatchPointerGesture = {
  pointerId: number
  sourceId: string
  startX: number
  startY: number
  lastX: number
  lastY: number
  dragStarted: boolean
  holdTimer: number | null
}

interface FileItem {
  id: string
  name: string
  extension: string
  size: number
  createdAt: number
  modifiedAt: number
  category: ConcreteFileCategory
  previewUrl?: string
  handle?: BrowserFileHandle
}

interface ScanResult {
  sessionId: string
  folderPath: string
  files: FileItem[]
}

const sortOptions: Array<{ value: SortRule; label: string }> = [
  { value: 'created-asc', label: '创建时间：从早到晚' },
  { value: 'created-desc', label: '创建时间：从晚到早' },
  { value: 'modified-asc', label: '修改时间：从早到晚' },
  { value: 'modified-desc', label: '修改时间：从晚到早' },
  { value: 'size-asc', label: '文件大小：从小到大' },
  { value: 'size-desc', label: '文件大小：从大到小' },
  { value: 'custom', label: '自定义顺序' },
]

const categoryOptions: Array<{ value: FileCategory; label: string }> = [
  { value: 'all', label: '全部文件' },
  { value: 'image', label: '仅图片' },
  { value: 'video', label: '仅视频' },
  { value: 'audio', label: '仅音频' },
  { value: 'document', label: '仅文档' },
  { value: 'archive', label: '仅压缩包' },
  { value: 'other', label: '其他文件' },
]

const categoryLabels: Record<ConcreteFileCategory, string> = {
  image: '图片',
  video: '视频',
  audio: '音频',
  document: '文档',
  archive: '压缩包',
  other: '其他',
}

const categoryIcons: Record<ConcreteFileCategory, string> = {
  image: 'IMG',
  video: 'VID',
  audio: 'AUD',
  document: 'DOC',
  archive: 'ZIP',
  other: 'FILE',
}

async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options?.headers },
  })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || '操作失败，请稍后重试。')
  return data
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`
}

function sortItems(files: FileItem[], rule: AutomaticSortRule): FileItem[] {
  const [field, direction] = rule.split('-') as [string, 'asc' | 'desc']
  const multiplier = direction === 'asc' ? 1 : -1
  return [...files].sort((a, b) => {
    let value = 0
    if (field === 'created') value = a.createdAt - b.createdAt
    if (field === 'modified') value = a.modifiedAt - b.modifiedAt
    if (field === 'size') value = a.size - b.size
    return (value || a.name.localeCompare(b.name, 'zh-CN', { numeric: true })) * multiplier
  })
}

export default function App() {
  const isDesktop = Boolean(window.desktopApi)
  const [folderPath, setFolderPath] = useState('')
  const [browserDirectory, setBrowserDirectory] = useState<BrowserDirectoryHandle | null>(null)
  const [sessionId, setSessionId] = useState('')
  const [files, setFiles] = useState<FileItem[]>([])
  const [orderedIds, setOrderedIds] = useState<string[]>([])
  const [customBaseIds, setCustomBaseIds] = useState<string[]>([])
  const [customPhase, setCustomPhase] = useState<CustomPhase>('building')
  const [batchSelectedIds, setBatchSelectedIds] = useState<string[]>([])
  const [dropPosition, setDropPosition] = useState<DropPosition | null>(null)
  const [dragPreviewIds, setDragPreviewIds] = useState<string[] | null>(null)
  const defaultSortRule: AutomaticSortRule = isDesktop ? 'created-asc' : 'modified-asc'
  const [sortRule, setSortRule] = useState<SortRule>(defaultSortRule)
  const [fileCategory, setFileCategory] = useState<FileCategory>('all')
  const [prefix, setPrefix] = useState('文件')
  const [startNumber, setStartNumber] = useState(1)
  const [padding, setPadding] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const previews = useRef<FileItem[]>([])
  const lastAutomaticRule = useRef<AutomaticSortRule>(defaultSortRule)
  const dragTarget = useRef<'custom' | 'batch' | null>(null)
  const selectionPath = useRef<string[]>([])
  const orderedIdsRef = useRef<string[]>([])
  const customCompletionPending = useRef(false)
  const draggedBatchIds = useRef<string[]>([])
  const dragOriginIds = useRef<string[]>([])
  const dragSlots = useRef<DragSlot[]>([])
  const currentDropPosition = useRef<DropPosition | null>(null)
  const dragGhost = useRef<HTMLElement | null>(null)
  const batchGesture = useRef<BatchPointerGesture | null>(null)
  const galleryRef = useRef<HTMLDivElement | null>(null)
  const finishBatchGestureRef = useRef<() => void>(() => undefined)
  const cancelBatchGestureRef = useRef<() => void>(() => undefined)
  const finishCustomSelectionRef = useRef<() => void>(() => undefined)

  useEffect(() => {
    const stopSelection = () => {
      dragTarget.current = null
      selectionPath.current = []
    }
    const finishPointers = () => {
      stopSelection()
      finishCustomSelectionRef.current()
      finishBatchGestureRef.current()
    }
    const cancelPointers = () => {
      stopSelection()
      finishCustomSelectionRef.current()
      cancelBatchGestureRef.current()
    }
    const stopWhenHidden = () => {
      if (document.hidden) finishPointers()
    }
    window.addEventListener('pointerup', finishPointers)
    window.addEventListener('pointercancel', cancelPointers)
    window.addEventListener('blur', finishPointers)
    document.addEventListener('visibilitychange', stopWhenHidden)
    return () => {
      releaseBrowserPreviews(previews.current)
      const holdTimer = batchGesture.current?.holdTimer
      if (holdTimer != null) window.clearTimeout(holdTimer)
      dragGhost.current?.remove()
      window.removeEventListener('pointerup', finishPointers)
      window.removeEventListener('pointercancel', cancelPointers)
      window.removeEventListener('blur', finishPointers)
      document.removeEventListener('visibilitychange', stopWhenHidden)
    }
  }, [])

  const fileMap = useMemo(() => new Map(files.map((item) => [item.id, item])), [files])
  orderedIdsRef.current = orderedIds
  const isCustomBuilding = sortRule === 'custom' && customPhase === 'building'
  const effectiveOrderedIds = dragPreviewIds ?? orderedIds
  const orderedFiles = effectiveOrderedIds.map((id) => fileMap.get(id)).filter(Boolean) as FileItem[]
  const galleryOrderIds = isCustomBuilding ? customBaseIds : effectiveOrderedIds
  const galleryFiles = galleryOrderIds.map((id) => fileMap.get(id)).filter(Boolean) as FileItem[]
  const orderMap = useMemo(() => new Map(effectiveOrderedIds.map((id, index) => [id, index + 1])), [effectiveOrderedIds])

  const replaceFiles = (next: FileItem[]) => {
    releaseBrowserPreviews(previews.current)
    previews.current = next.filter((file) => file.previewUrl)
    setFiles(next)
    const baseRule = sortRule === 'custom' ? lastAutomaticRule.current : sortRule
    const sortedIds = sortItems(next, baseRule).map((file) => file.id)
    setCustomBaseIds(sortedIds)
    const nextOrder = sortRule === 'custom' ? [] : sortedIds
    orderedIdsRef.current = nextOrder
    setOrderedIds(nextOrder)
    setCustomPhase('building')
    customCompletionPending.current = false
    setBatchSelectedIds([])
    setDropPosition(null)
    setDragPreviewIds(null)
  }

  const loadBrowserData = async (directory: BrowserDirectoryHandle, category: FileCategory = fileCategory) => {
    const loaded = await scanBrowserDirectory(directory, category)
    replaceFiles(loaded)
    if (loaded.length === 0) setMessage(`文件夹中没有找到${categoryOptions.find((option) => option.value === category)?.label ?? '匹配的文件'}。`)
  }

  const scanDesktopData = async (category: FileCategory = fileCategory) => {
    const result = await api<ScanResult>('/api/scan', {
      method: 'POST',
      body: JSON.stringify({
        folderPath,
        category,
        sortRule: sortRule === 'custom' ? lastAutomaticRule.current : sortRule,
      }),
    })
    setFolderPath(result.folderPath)
    setSessionId(result.sessionId)
    replaceFiles(result.files)
    if (result.files.length === 0) setMessage(`文件夹中没有找到${categoryOptions.find((option) => option.value === category)?.label ?? '匹配的文件'}。`)
  }

  const applyFileCategory = async (category: FileCategory) => {
    setFileCategory(category)
    setSessionId('')
    setError('')
    setMessage('')
    if ((!isDesktop && !browserDirectory) || (isDesktop && !folderPath.trim())) {
      replaceFiles([])
      return
    }

    setBusy(true)
    try {
      if (isDesktop) await scanDesktopData(category)
      else await loadBrowserData(browserDirectory!, category)
    } catch (caught) {
      replaceFiles([])
      setError(caught instanceof Error ? caught.message : '切换文件类型失败。')
    } finally {
      setBusy(false)
    }
  }

  const chooseFolder = async () => {
    setError('')
    setMessage('')
    if (isDesktop) {
      const selected = await window.desktopApi!.chooseFolder()
      if (selected) setFolderPath(selected)
      return
    }
    setBusy(true)
    try {
      const directory = await chooseBrowserDirectory()
      setBrowserDirectory(directory)
      setFolderPath(directory.name)
      await loadBrowserData(directory)
    } catch (caught) {
      if (!(caught instanceof DOMException && caught.name === 'AbortError')) {
        setError(caught instanceof Error ? caught.message : '选择文件夹失败。')
      }
    } finally {
      setBusy(false)
    }
  }

  const scanFolder = async () => {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      if (isDesktop) await scanDesktopData()
      else if (browserDirectory) await loadBrowserData(browserDirectory)
      else throw new Error('请先选择文件夹。')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '扫描失败。')
    } finally {
      setBusy(false)
    }
  }

  const applySortRule = (nextRule: SortRule) => {
    cancelBatchGestureRef.current()
    setSortRule(nextRule)
    setBatchSelectedIds([])
    setDropPosition(null)
    setDragPreviewIds(null)
    if (nextRule === 'custom') {
      const baseIds = orderedIds.length === files.length
        ? orderedIds
        : sortItems(files, lastAutomaticRule.current).map((file) => file.id)
      setCustomBaseIds(baseIds)
      orderedIdsRef.current = []
      setOrderedIds([])
      setCustomPhase('building')
      customCompletionPending.current = false
      setMessage('自定义顺序已开启：请按希望的命名顺序点击或划过全部文件。')
      return
    }
    lastAutomaticRule.current = nextRule
    const sortedIds = sortItems(files, nextRule).map((file) => file.id)
    setCustomBaseIds(sortedIds)
    orderedIdsRef.current = sortedIds
    setOrderedIds(sortedIds)
    setCustomPhase('building')
    customCompletionPending.current = false
    setMessage('已按规则重新排列，可划选多个文件并成组拖动调整顺序。')
  }

  const toggleSelectionPath = (id: string) => {
    if (!dragTarget.current) return
    if (dragTarget.current === 'custom') {
      const current = orderedIdsRef.current
      const next = current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id]
      orderedIdsRef.current = next
      customCompletionPending.current = next.length === files.length
      setOrderedIds(next)
      return
    }
    const update = (current: string[]) => current.includes(id)
      ? current.filter((item) => item !== id)
      : [...current, id]
    setBatchSelectedIds(update)
  }

  const startSelectionDrag = (event: ReactPointerEvent<HTMLButtonElement>, id: string) => {
    if (event.button !== 0) return
    dragTarget.current = null
    selectionPath.current = []
    if (batchGesture.current) finishBatchGestureRef.current()
    if (isCustomBuilding && customCompletionPending.current && orderedIdsRef.current.length === files.length) {
      finishCustomSelectionRef.current()
      event.preventDefault()
      dragTarget.current = 'batch'
      selectionPath.current = [id]
      toggleSelectionPath(id)
      setMessage('已进入批量调整，正在按滑动路径选择文件。')
      return
    }
    if (!isCustomBuilding && batchSelectedIds.includes(id)) {
      startBatchPointerGesture(event, id)
      return
    }
    event.preventDefault()
    dragTarget.current = isCustomBuilding ? 'custom' : 'batch'
    selectionPath.current = [id]
    toggleSelectionPath(id)
    setMessage(isCustomBuilding
      ? '正在按路径记录自定义顺序；本次按压中再次经过同一文件会取消。'
      : '正在按滑动路径切换选择；本次按压中再次经过同一文件会取消选择。')
  }

  const continueSelectionDrag = (event: ReactPointerEvent<HTMLButtonElement>, id: string) => {
    if (!dragTarget.current) return
    if ((event.buttons & 1) !== 1) {
      dragTarget.current = null
      selectionPath.current = []
      finishCustomSelectionRef.current()
      return
    }
    const next = advanceSelectionPath(selectionPath.current, id)
    selectionPath.current = next.path
    next.toggledIds.forEach(toggleSelectionPath)
  }

  const moveBatch = (direction: 'top' | 'bottom') => {
    if (batchSelectedIds.length === 0) return
    const selected = new Set(batchSelectedIds)
    setOrderedIds((current) => {
      const selectedItems = current.filter((id) => selected.has(id))
      const remaining = current.filter((id) => !selected.has(id))
      return direction === 'top' ? [...selectedItems, ...remaining] : [...remaining, ...selectedItems]
    })
    setMessage(`已将 ${batchSelectedIds.length} 个文件成组${direction === 'top' ? '移到最前' : '移到最后'}。`)
  }

  function captureDragSlots() {
    const gallery = galleryRef.current
    if (!gallery) return
    const galleryBounds = gallery.getBoundingClientRect()
    dragSlots.current = Array.from(gallery.querySelectorAll<HTMLElement>('[data-file-id]')).map((card) => {
      const bounds = card.getBoundingClientRect()
      return {
        targetId: card.dataset.fileId!,
        left: bounds.left - galleryBounds.left + gallery.scrollLeft,
        right: bounds.right - galleryBounds.left + gallery.scrollLeft,
        top: bounds.top - galleryBounds.top + gallery.scrollTop,
        bottom: bounds.bottom - galleryBounds.top + gallery.scrollTop,
      }
    })
  }

  function getDropPosition(clientX: number, clientY: number): DropPosition | null {
    const gallery = galleryRef.current
    if (!gallery) return null
    const galleryBounds = gallery.getBoundingClientRect()
    const pointerX = clientX - galleryBounds.left + gallery.scrollLeft
    const pointerY = clientY - galleryBounds.top + gallery.scrollTop
    const match = findStableDropSlot(dragSlots.current, pointerX, pointerY, currentDropPosition.current)
    if (!match) return null
    const targetIndex = dragOriginIds.current.indexOf(match.slot.targetId)
    if (targetIndex < 0) return null
    return {
      targetId: match.slot.targetId,
      side: match.side,
      insertionIndex: targetIndex + (match.side === 'after' ? 1 : 0),
      markerLeft: match.side === 'before' ? match.slot.left : match.slot.right,
      markerTop: match.slot.top,
      markerHeight: match.slot.bottom - match.slot.top,
    }
  }

  function updateBatchDrop(clientX: number, clientY: number) {
    const position = getDropPosition(clientX, clientY)
    if (!position) return
    currentDropPosition.current = position
    setDropPosition(position)
    setDragPreviewIds(insertBatchAtIndex(dragOriginIds.current, draggedBatchIds.current, position.insertionIndex))
  }

  function positionDragGhost(clientX: number, clientY: number) {
    if (!dragGhost.current) return
    dragGhost.current.style.left = `${clientX + 16}px`
    dragGhost.current.style.top = `${clientY + 16}px`
  }

  function autoScrollGallery(clientY: number) {
    const gallery = galleryRef.current
    if (!gallery) return
    const bounds = gallery.getBoundingClientRect()
    if (clientY < bounds.top + 36) gallery.scrollTop -= 16
    else if (clientY > bounds.bottom - 36) gallery.scrollTop += 16
  }

  function clearBatchReorderVisuals() {
    const gesture = batchGesture.current
    if (gesture?.holdTimer != null) window.clearTimeout(gesture.holdTimer)
    draggedBatchIds.current = []
    dragOriginIds.current = []
    dragSlots.current = []
    currentDropPosition.current = null
    dragGhost.current?.remove()
    dragGhost.current = null
    setDragPreviewIds(null)
    setDropPosition(null)
  }

  function beginBatchReorder(clientX: number, clientY: number) {
    const gesture = batchGesture.current
    if (!gesture || gesture.dragStarted) return
    gesture.dragStarted = true
    if (gesture.holdTimer !== null) window.clearTimeout(gesture.holdTimer)
    gesture.holdTimer = null

    const selected = new Set(batchSelectedIds)
    draggedBatchIds.current = orderedIds.filter((item) => selected.has(item))
    dragOriginIds.current = [...orderedIds]
    currentDropPosition.current = null
    setDropPosition(null)
    captureDragSlots()

    const ghost = document.createElement('div')
    ghost.className = 'drag-ghost'
    const icon = document.createElement('span')
    icon.textContent = '▧'
    const count = document.createElement('strong')
    count.textContent = `${draggedBatchIds.current.length}`
    const label = document.createElement('em')
    label.textContent = '个文件'
    ghost.append(icon, count, label)
    document.body.append(ghost)
    dragGhost.current = ghost
    positionDragGhost(clientX, clientY)
    updateBatchDrop(clientX, clientY)
    setMessage(`正在拖动 ${draggedBatchIds.current.length} 个文件，请在目标间隙松开。`)
  }

  function startBatchPointerGesture(event: ReactPointerEvent<HTMLButtonElement>, id: string) {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    const gesture: BatchPointerGesture = {
      pointerId: event.pointerId,
      sourceId: id,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      dragStarted: false,
      holdTimer: null,
    }
    batchGesture.current = gesture
    gesture.holdTimer = window.setTimeout(() => {
      if (batchGesture.current === gesture) beginBatchReorder(gesture.lastX, gesture.lastY)
    }, 180)
    setMessage('短按松开可取消选择；移动鼠标或按住片刻可拖动整组。')
  }

  function continueBatchPointerGesture(event: ReactPointerEvent<HTMLButtonElement>) {
    const gesture = batchGesture.current
    if (!gesture || gesture.pointerId !== event.pointerId) return
    if ((event.buttons & 1) !== 1) {
      finishBatchGestureRef.current()
      return
    }
    gesture.lastX = event.clientX
    gesture.lastY = event.clientY
    if (!gesture.dragStarted && Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY) >= 6) {
      beginBatchReorder(event.clientX, event.clientY)
    }
    if (gesture.dragStarted) {
      positionDragGhost(event.clientX, event.clientY)
      autoScrollGallery(event.clientY)
      updateBatchDrop(event.clientX, event.clientY)
    }
  }

  function finishBatchGesture() {
    const gesture = batchGesture.current
    if (!gesture) return
    if (gesture.holdTimer !== null) window.clearTimeout(gesture.holdTimer)
    if (gesture.dragStarted) {
      const moving = [...draggedBatchIds.current]
      const position = currentDropPosition.current
      if (moving.length && position) {
        setOrderedIds(insertBatchAtIndex(dragOriginIds.current, moving, position.insertionIndex))
        setMessage(`已在文件间隙插入 ${moving.length} 个文件。`)
      }
    } else {
      setBatchSelectedIds((current) => current.filter((item) => item !== gesture.sourceId))
      setMessage('已取消选择这个文件。')
    }
    clearBatchReorderVisuals()
    batchGesture.current = null
  }

  function cancelBatchGesture() {
    const gesture = batchGesture.current
    if (!gesture) return
    clearBatchReorderVisuals()
    batchGesture.current = null
  }

  function finishBatchPointerGesture(event: ReactPointerEvent<HTMLButtonElement>) {
    const gesture = batchGesture.current
    if (!gesture || gesture.pointerId !== event.pointerId) return
    event.preventDefault()
    finishBatchGesture()
  }

  function cancelBatchPointerGesture(event: ReactPointerEvent<HTMLButtonElement>) {
    const gesture = batchGesture.current
    if (!gesture || gesture.pointerId !== event.pointerId) return
    cancelBatchGesture()
  }

  function finishCustomSelection() {
    if (sortRule !== 'custom' || customPhase !== 'building' || !customCompletionPending.current) return
    if (orderedIdsRef.current.length !== files.length) return
    customCompletionPending.current = false
    setBatchSelectedIds([])
    setCustomPhase('adjusting')
    setMessage('自定义顺序已全部选定，现在可以批量选择并拖动文件进行调整。')
  }

  function restartCustomOrdering() {
    cancelBatchGesture()
    setCustomBaseIds([...orderedIdsRef.current])
    orderedIdsRef.current = []
    setOrderedIds([])
    setBatchSelectedIds([])
    setCustomPhase('building')
    customCompletionPending.current = false
    setMessage('已重新开始自定义顺序，请按希望的命名顺序选择全部文件。')
  }

  finishBatchGestureRef.current = finishBatchGesture
  cancelBatchGestureRef.current = cancelBatchGesture
  finishCustomSelectionRef.current = finishCustomSelection

  const moveItem = (index: number, change: -1 | 1) => {
    const target = index + change
    if (target < 0 || target >= orderedIds.length) return
    const next = [...orderedIds]
    ;[next[index], next[target]] = [next[target], next[index]]
    setOrderedIds(next)
  }

  const previewName = (file: FileItem, index: number) => {
    const number = String(startNumber + index).padStart(padding, '0')
    return `${prefix.trim() || '前缀'}${number}${file.extension}`
  }

  const renameAll = async () => {
    if (isCustomBuilding) {
      setError('请先完成自定义顺序，并松开鼠标进入批量调整阶段。')
      return
    }
    if (orderedIds.length !== files.length) {
      setError('文件顺序不完整，请重新扫描文件夹。')
      return
    }
    if (!window.confirm(`即将按当前顺序重命名 ${files.length} 个文件。此操作会修改原文件名，是否继续？`)) return
    setBusy(true)
    setError('')
    setMessage('')
    try {
      let renamed = 0
      if (isDesktop) {
        const result = await api<{ renamed: number }>('/api/rename', {
          method: 'POST',
          body: JSON.stringify({ sessionId, orderedIds, prefix, startNumber, padding }),
        })
        renamed = result.renamed
        await scanDesktopData()
      } else {
        if (!browserDirectory) throw new Error('文件夹授权已失效，请重新选择文件夹。')
        renamed = await renameBrowserFiles({
          directory: browserDirectory,
          files: orderedFiles.map((file) => ({ ...file, previewUrl: file.previewUrl!, handle: file.handle! })),
          prefix,
          startNumber,
          padding,
        })
        await loadBrowserData(browserDirectory)
      }
      setMessage(`已成功重命名 ${renamed} 个文件。`)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '重命名失败。')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="app-shell">
      <header className="hero">
        <div>
          <p className="eyebrow">FILE SEQUENCE RENAMER</p>
          <h1>文件序列重命名器</h1>
          <p className="subtitle">筛选图片、视频或其他文件，按规则排序后批量重命名。所有内容只在本机处理。</p>
        </div>
        <div className="privacy-chip"><span /> {isDesktop ? '桌面本地模式' : '网页本地模式'}</div>
      </header>

      <section className="control-panel">
        <div className="field folder-field">
          <label htmlFor="folder">目标文件夹</label>
          {isDesktop ? (
            <div className="input-row">
              <input id="folder" value={folderPath} onChange={(event) => setFolderPath(event.target.value)} placeholder="输入或选择文件夹绝对路径" />
              <button className="secondary" onClick={chooseFolder}>选择文件夹</button>
              <button className="primary" disabled={busy || !folderPath.trim()} onClick={scanFolder}>{busy ? '处理中…' : '扫描文件'}</button>
            </div>
          ) : (
            <div className="input-row">
              <div className="folder-display">{folderPath || '尚未选择文件夹'}</div>
              <button className="primary" disabled={busy || !supportsDirectoryPicker()} onClick={chooseFolder}>{busy ? '处理中…' : '选择文件夹'}</button>
              {browserDirectory && <button className="secondary" disabled={busy} onClick={scanFolder}>重新扫描</button>}
            </div>
          )}
          {!isDesktop && <small>{supportsDirectoryPicker() ? '浏览器会请求文件夹读写权限，文件不会上传。' : '当前浏览器不支持文件夹读写，请使用最新版 Chrome 或 Edge。'}</small>}
        </div>

        <div className="settings-grid">
          <div className="field">
            <label htmlFor="category">文件类型</label>
            <select id="category" value={fileCategory} disabled={busy} onChange={(event) => void applyFileCategory(event.target.value as FileCategory)}>
              {categoryOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="prefix">文件名前缀</label>
            <input id="prefix" value={prefix} maxLength={120} onChange={(event) => setPrefix(event.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="rule">排列方式</label>
            <select id="rule" value={sortRule} onChange={(event) => applySortRule(event.target.value as SortRule)}>
              {sortOptions
                .filter((option) => isDesktop || option.value === 'custom' || !option.value.startsWith('created'))
                .map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </div>
          <div className="field small-field">
            <label htmlFor="start">起始编号</label>
            <input id="start" type="number" min="0" value={startNumber} onChange={(event) => setStartNumber(Math.max(0, Number(event.target.value)))} />
          </div>
          <div className="field small-field">
            <label htmlFor="padding">补零位数</label>
            <select id="padding" value={padding} onChange={(event) => setPadding(Number(event.target.value))}>
              <option value={0}>不补零</option>
              <option value={2}>2 位（01）</option>
              <option value={3}>3 位（001）</option>
              <option value={4}>4 位（0001）</option>
            </select>
          </div>
        </div>
      </section>

      {error && <div className="notice error">{error}</div>}
      {message && <div className="notice success">{message}</div>}

      {files.length > 0 && (
        <div className="workspace">
          <section className="gallery-panel">
            <div className="section-heading">
              <div>
                <h2>文件预览与排序</h2>
                <p>{isCustomBuilding
                  ? '自定义选序：按希望的命名顺序点击或划过文件；再次经过会取消。'
                  : sortRule === 'custom'
                    ? '顺序已全部选定；现在可批量划选，短按取消，移动或长按拖动整组。'
                  : '当前为规则排序结果；可直接划选多个文件并成组拖动调整。'}</p>
              </div>
              <div className="heading-actions">
                {isCustomBuilding ? (
                  <>
                    <strong>已排 {orderedIds.length} / {files.length}</strong>
                    <button
                      className="text-button"
                      disabled={!orderedIds.length}
                      onClick={() => {
                        orderedIdsRef.current = []
                        setOrderedIds([])
                        customCompletionPending.current = false
                      }}
                    >清空顺序</button>
                  </>
                ) : (
                  <>
                    <strong>已选 {batchSelectedIds.length}</strong>
                    <button className="text-button" disabled={!batchSelectedIds.length} onClick={() => moveBatch('top')}>移到最前</button>
                    <button className="text-button" disabled={!batchSelectedIds.length} onClick={() => moveBatch('bottom')}>移到最后</button>
                    <button className="text-button" disabled={!batchSelectedIds.length} onClick={() => setBatchSelectedIds([])}>清除选择</button>
                    {sortRule === 'custom'
                      ? <button className="text-button" onClick={restartCustomOrdering}>重新选定顺序</button>
                      : <button className="text-button" onClick={() => applySortRule(sortRule)}>恢复规则排序</button>}
                  </>
                )}
              </div>
            </div>
            <div className="gallery" ref={galleryRef}>
              {dropPosition && (
                <span
                  className="drop-marker"
                  style={{ left: dropPosition.markerLeft, top: dropPosition.markerTop, height: dropPosition.markerHeight }}
                />
              )}
              {galleryFiles.map((file) => {
                const order = orderMap.get(file.id)
                const mediaUrl = file.previewUrl || (isDesktop ? `/api/scans/${sessionId}/files/${file.id}` : '')
                return (
                  <button
                    className={`file-card ${order ? 'selected' : ''} ${batchSelectedIds.includes(file.id) ? 'batch-selected' : ''}`}
                    key={file.id}
                    data-file-id={file.id}
                    onPointerDown={(event) => startSelectionDrag(event, file.id)}
                    onPointerEnter={(event) => continueSelectionDrag(event, file.id)}
                    onPointerMove={continueBatchPointerGesture}
                    onPointerUp={finishBatchPointerGesture}
                    onPointerCancel={cancelBatchPointerGesture}
                    type="button"
                  >
                    <div className="thumb-wrap">
                      {file.category === 'image' && <img draggable="false" loading="lazy" src={mediaUrl} alt={file.name} />}
                      {file.category === 'video' && <video draggable="false" muted preload="metadata" src={mediaUrl} aria-label={file.name} />}
                      {file.category !== 'image' && file.category !== 'video' && (
                        <div className={`file-placeholder ${file.category}`}>
                          <strong>{categoryIcons[file.category]}</strong>
                          <span>{categoryLabels[file.category]}</span>
                        </div>
                      )}
                      <span className="file-type-badge">{categoryLabels[file.category]}</span>
                      {order && <span className="order-badge">{order}</span>}
                      {batchSelectedIds.includes(file.id) && <span className="swap-label">短按取消 · 拖动排序</span>}
                    </div>
                    <span className="original-name" title={file.name}>{file.name}</span>
                    <span className="metadata">{formatBytes(file.size)} · {new Date(file.modifiedAt).toLocaleDateString()}</span>
                  </button>
                )
              })}
            </div>
          </section>

          <aside className="queue-panel">
            <div className="section-heading compact">
              <div><h2>命名队列</h2><p>最终结果预览</p></div>
            </div>
            <ol className="rename-list">
              {orderedFiles.length === 0 && <li className="queue-empty">尚未选择文件</li>}
              {orderedFiles.map((file, index) => (
                <li key={file.id}>
                  <span className="list-index">{index + 1}</span>
                  <div>
                    <span className="from-name">{file.name}</span>
                    <strong title={previewName(file, index)}>{previewName(file, index)}</strong>
                  </div>
                  <span className="move-buttons">
                    <button disabled={index === 0} onClick={() => moveItem(index, -1)} aria-label="上移">↑</button>
                    <button disabled={index === orderedFiles.length - 1} onClick={() => moveItem(index, 1)} aria-label="下移">↓</button>
                  </span>
                </li>
              ))}
            </ol>
            <div className="rename-footer">
              <p>{isDesktop ? '桌面版执行原生重命名，并检查重名和文件变化。' : '网页版经授权后直接处理本地文件，不会上传文件。'}</p>
              <button className="rename-button" disabled={busy || files.length === 0 || orderedIds.length !== files.length || isCustomBuilding || !prefix.trim()} onClick={renameAll}>
                {busy ? '处理中…' : `重命名 ${files.length} 个文件`}
              </button>
            </div>
          </aside>
        </div>
      )}

      {!files.length && !busy && (
        <section className="empty-state">
          <div className="empty-icon">▧</div>
          <h2>从一个文件夹开始</h2>
          <p>可选择全部、图片、视频、音频、文档、压缩包或其他文件；只处理文件夹第一层。</p>
        </section>
      )}
    </main>
  )
}
