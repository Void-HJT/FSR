export type SortRule =
  | 'created-asc'
  | 'created-desc'
  | 'modified-asc'
  | 'modified-desc'
  | 'size-asc'
  | 'size-desc'
  | 'name-asc'
  | 'name-desc'

export interface ImageItem {
  id: string
  name: string
  extension: string
  size: number
  createdAt: number
  modifiedAt: number
}

export interface StoredImage extends ImageItem {
  absolutePath: string
}

export interface ScanSession {
  id: string
  folderPath: string
  createdAt: number
  images: StoredImage[]
}
