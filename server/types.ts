export type SortRule =
  | 'created-asc'
  | 'created-desc'
  | 'modified-asc'
  | 'modified-desc'
  | 'size-asc'
  | 'size-desc'
  | 'name-asc'
  | 'name-desc'

export type FileCategory = 'all' | 'image' | 'video' | 'audio' | 'document' | 'archive' | 'other'
export type ConcreteFileCategory = Exclude<FileCategory, 'all'>

export interface FileItem {
  id: string
  name: string
  extension: string
  size: number
  createdAt: number
  modifiedAt: number
  category: ConcreteFileCategory
}

export interface StoredFile extends FileItem {
  absolutePath: string
}

export interface ScanSession {
  id: string
  folderPath: string
  createdAt: number
  files: StoredFile[]
}
