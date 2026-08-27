import { describe, expect, it } from 'vitest'
import { advanceSelectionPath, findStableDropSlot, getBatchInsertionIndex, getRemainingInsertionIndex, hasMovedOneGridCell, insertBatchAtRemainingIndex } from './order-utils'

describe('insertBatchAtRemainingIndex', () => {
  it('inserts a non-contiguous group into the remaining-file sequence', () => {
    expect(insertBatchAtRemainingIndex(['a', 'b', 'c', 'd', 'e'], ['d', 'b'], 2)).toEqual(['a', 'c', 'b', 'd', 'e'])
  })

  it('supports the gap after the final remaining file', () => {
    expect(insertBatchAtRemainingIndex(['a', 'b', 'c', 'd'], ['b', 'd'], 2)).toEqual(['a', 'c', 'b', 'd'])
  })

  it('treats adjacent moving files as one block while retaining every other position', () => {
    expect(insertBatchAtRemainingIndex(['a', 'b', 'c', 'd', 'e', 'f'], ['b', 'c', 'd'], 2)).toEqual([
      'a', 'e', 'b', 'c', 'd', 'f',
    ])
  })

  it('keeps the original order when a moving block is inserted back into its remaining gap', () => {
    expect(insertBatchAtRemainingIndex(['a', 'b', 'c', 'd', 'e'], ['b', 'c', 'd'], 1)).toEqual([
      'a', 'b', 'c', 'd', 'e',
    ])
  })

  it('places the first moving file at the requested absolute grid position', () => {
    const order = Array.from({ length: 14 }, (_, index) => String(index + 1))
    const result = insertBatchAtRemainingIndex(order, ['1', '2', '3'], 6)

    expect(result).toEqual(['4', '5', '6', '7', '8', '9', '1', '2', '3', '10', '11', '12', '13', '14'])
    expect(result.indexOf('1')).toBe(6)
  })
})

describe('advanceSelectionPath', () => {
  it('cancels the turning image and the image crossed again when tracing backward', () => {
    expect(advanceSelectionPath(['a', 'b', 'c'], 'b')).toEqual({
      path: ['a'],
      toggledIds: ['c', 'b'],
    })
    expect(advanceSelectionPath(['a'], 'a')).toEqual({ path: [], toggledIds: ['a'] })
  })
})

describe('getBatchInsertionIndex', () => {
  it('uses the first moving file as the absolute insertion anchor across rows', () => {
    expect(getBatchInsertionIndex(14, 3, 5, 'after')).toBe(6)
    expect(getBatchInsertionIndex(14, 3, 6, 'before')).toBe(6)
  })

  it('clamps the first moving file to the final available start position', () => {
    expect(getBatchInsertionIndex(14, 3, 13, 'after')).toBe(11)
  })
})

describe('getRemainingInsertionIndex', () => {
  it('uses the current grid position after the remaining files move forward', () => {
    const insertionIndex = getRemainingInsertionIndex(11, 2, 'after')
    const result = insertBatchAtRemainingIndex(
      Array.from({ length: 14 }, (_, index) => String(index + 1)),
      ['1', '2', '3'],
      insertionIndex,
    )

    expect(insertionIndex).toBe(3)
    expect(result.slice(0, 6)).toEqual(['4', '5', '6', '1', '2', '3'])
  })

  it('supports both boundaries of the grid without counting moving files', () => {
    expect(getRemainingInsertionIndex(11, 0, 'before')).toBe(0)
    expect(getRemainingInsertionIndex(11, 10, 'after')).toBe(11)
  })
})

describe('hasMovedOneGridCell', () => {
  it('activates only after the pointer travels one normalized grid length', () => {
    expect(hasMovedOneGridCell(99, 0, 100, 180)).toBe(false)
    expect(hasMovedOneGridCell(100, 0, 100, 180)).toBe(true)
    expect(hasMovedOneGridCell(0, 180, 100, 180)).toBe(true)
    expect(hasMovedOneGridCell(80, 108, 100, 180)).toBe(true)
  })
})

describe('findStableDropSlot', () => {
  const slots = [
    { targetId: 'a', left: 0, right: 100, top: 0, bottom: 100 },
    { targetId: 'b', left: 110, right: 210, top: 0, bottom: 100 },
  ]

  it('keeps both the left and right side stable until the pointer clearly crosses the middle', () => {
    expect(findStableDropSlot(slots, 150, 50, { targetId: 'b', side: 'after' })).toMatchObject({
      slot: { targetId: 'b' },
      side: 'after',
    })
    expect(findStableDropSlot(slots, 170, 50, { targetId: 'b', side: 'before' })).toMatchObject({
      slot: { targetId: 'b' },
      side: 'before',
    })
  })

  it('selects the fixed gap between cards without depending on their preview order', () => {
    expect(findStableDropSlot(slots, 105, 50)).toMatchObject({
      slot: { targetId: 'a' },
      side: 'after',
    })
  })

  it('keeps the current right-edge target when a nearby slot is only slightly closer', () => {
    expect(findStableDropSlot(slots, 106, 50, { targetId: 'a', side: 'after' })).toMatchObject({
      slot: { targetId: 'a' },
      side: 'after',
    })
  })

})
