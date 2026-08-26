export function insertBatchAtIndex(order: string[], movingIds: string[], insertionIndex: number): string[] {
  const movingSet = new Set(movingIds)
  if (movingIds.length === 0) return [...order]
  const moving = order.filter((id) => movingSet.has(id))
  const index = Math.max(0, Math.min(order.length, Math.trunc(insertionIndex)))
  const before = order.slice(0, index).filter((id) => !movingSet.has(id))
  const after = order.slice(index).filter((id) => !movingSet.has(id))
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
  current?: { targetId: string; side: DropSide } | null,
): { slot: DragSlot; side: DropSide } | null {
  let closest: { slot: DragSlot; distance: number } | null = null
  for (const slot of slots) {
    const distance = distanceToSlot(slot, pointerX, pointerY)
    if (!closest || distance < closest.distance) closest = { slot, distance }
  }
  if (!closest) return null

  const currentSlot = current && slots.find((slot) => slot.targetId === current.targetId)
  if (currentSlot && distanceToSlot(currentSlot, pointerX, pointerY) <= closest.distance + 18) {
    closest = { slot: currentSlot, distance: distanceToSlot(currentSlot, pointerX, pointerY) }
  }

  const width = Math.max(1, closest.slot.right - closest.slot.left)
  const relativeX = (pointerX - closest.slot.left) / width
  let side: DropSide
  if (current?.targetId === closest.slot.targetId) {
    side = current.side === 'before'
      ? relativeX > 0.68 ? 'after' : 'before'
      : relativeX < 0.32 ? 'before' : 'after'
  } else {
    side = relativeX < 0.5 ? 'before' : 'after'
  }
  return { slot: closest.slot, side }
}
