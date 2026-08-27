import { describe, expect, it } from 'vitest'
import { advanceSelectionPath, excludeMovingDragSlots, findStableDropSlot, insertBatchAtRemainingIndex } from './order-utils'

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

  it('cannot target any position belonging to the moving group', () => {
    const available = excludeMovingDragSlots([
      ...slots,
      { targetId: 'c', left: 220, right: 320, top: 0, bottom: 100 },
      { targetId: 'd', left: 330, right: 430, top: 0, bottom: 100 },
    ], ['b', 'c', 'd'])

    expect(available.map((slot) => slot.targetId)).toEqual(['a'])
    expect(findStableDropSlot(available, 275, 50)).toMatchObject({ slot: { targetId: 'a' } })
  })
})
