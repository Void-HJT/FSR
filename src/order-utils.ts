export function insertBatchAtRemainingIndex(order: string[], movingIds: string[], insertionIndex: number): string[] {
  const movingSet = new Set(movingIds)
  if (movingIds.length === 0) return [...order]
  const moving = order.filter((id) => movingSet.has(id))
  const remaining = order.filter((id) => !movingSet.has(id))
  const index = Math.max(0, Math.min(remaining.length, Math.trunc(insertionIndex)))
  const before = remaining.slice(0, index)
  const after = remaining.slice(index)
  return [...before, ...moving, ...after]
}

export function advanceSelectionPath(path: string[], id: string): { path: string[]; toggledIds: string[] } {
  if (path.length >= 2 && path[path.length - 2] === id) {
    return { path: path.slice(0, -2), toggledIds: [path[path.length - 1], id] }
  }
  if (path[path.length - 1] === id) {
    return { path: path.slice(0, -1), toggledIds: [id] }
  }
  return { path: [...path, id], toggledIds: [id] }
}

export interface DragSlot {
  targetId: string
  left: number
  right: number
  top: number
  bottom: number
}

export type DropSide = 'before' | 'after'

export function getBatchInsertionIndex(
  orderLength: number,
  movingCount: number,
  targetIndex: number,
  side: DropSide,
): number {
  const requested = targetIndex + (side === 'after' ? 1 : 0)
  return Math.max(0, Math.min(Math.max(0, orderLength - movingCount), requested))
}

export function getRemainingInsertionIndex(
  remainingCount: number,
  targetIndex: number,
  side: DropSide,
): number {
  const requested = targetIndex + (side === 'after' ? 1 : 0)
  return Math.max(0, Math.min(remainingCount, requested))
}

export function hasMovedHalfGridCell(
  deltaX: number,
  deltaY: number,
  cellWidth: number,
  cellHeight: number,
): boolean {
  const normalizedX = deltaX / Math.max(1, cellWidth)
  const normalizedY = deltaY / Math.max(1, cellHeight)
  return Math.hypot(normalizedX, normalizedY) >= 0.5
}

function distanceToSlot(slot: DragSlot, pointerX: number, pointerY: number): number {
  const horizontalDistance = pointerX < slot.left
    ? slot.left - pointerX
    : pointerX > slot.right ? pointerX - slot.right : 0
  const verticalDistance = pointerY < slot.top
    ? slot.top - pointerY
    : pointerY > slot.bottom ? pointerY - slot.bottom : 0
  return Math.hypot(horizontalDistance, verticalDistance)
}

export function findStableDropSlot(
  slots: DragSlot[],
  pointerX: number,
  pointerY: number,
): { slot: DragSlot; side: DropSide } | null {
  let closest: { slot: DragSlot; distance: number } | null = null
  for (const slot of slots) {
    const distance = distanceToSlot(slot, pointerX, pointerY)
    if (!closest || distance < closest.distance) closest = { slot, distance }
  }
  if (!closest) return null

  const width = Math.max(1, closest.slot.right - closest.slot.left)
  const relativeX = (pointerX - closest.slot.left) / width
  const side: DropSide = relativeX < 0.5 ? 'before' : 'after'
  return { slot: closest.slot, side }
}
