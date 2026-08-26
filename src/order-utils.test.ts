import { describe, expect, it } from 'vitest'
import { advanceSelectionPath, findStableDropSlot, insertBatchAtIndex } from './order-utils'

describe('insertBatchAtIndex', () => {
  it('inserts a non-contiguous group at a gap while preserving visual order', () => {
    expect(insertBatchAtIndex(['a', 'b', 'c', 'd', 'e'], ['d', 'b'], 3)).toEqual(['a', 'c', 'b', 'd', 'e'])
  })

  it('supports the gap after the final image', () => {
    expect(insertBatchAtIndex(['a', 'b', 'c', 'd'], ['b', 'd'], 4)).toEqual(['a', 'c', 'b', 'd'])
  })

  it('allows a gap next to an image in the moving group', () => {
    expect(insertBatchAtIndex(['a', 'b', 'c', 'd', 'e'], ['b', 'd'], 2)).toEqual(['a', 'b', 'd', 'c', 'e'])
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
})
