import { describe, expect, it } from 'vitest'
import { fileCategoryOf } from './file-types.js'

describe('fileCategoryOf', () => {
  it('distinguishes common file categories', () => {
    expect(fileCategoryOf('.JPG')).toBe('image')
    expect(fileCategoryOf('.mp4')).toBe('video')
    expect(fileCategoryOf('.flac')).toBe('audio')
    expect(fileCategoryOf('.pdf')).toBe('document')
    expect(fileCategoryOf('.zip')).toBe('archive')
    expect(fileCategoryOf('.blend')).toBe('other')
    expect(fileCategoryOf('')).toBe('other')
  })
})
