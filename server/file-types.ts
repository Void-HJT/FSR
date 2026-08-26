import type { ConcreteFileCategory } from './types.js'

const CATEGORY_EXTENSIONS: Record<Exclude<ConcreteFileCategory, 'other'>, ReadonlySet<string>> = {
  image: new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tif', '.tiff', '.avif', '.heic', '.svg']),
  video: new Set(['.mp4', '.mkv', '.mov', '.avi', '.webm', '.wmv', '.m4v', '.flv', '.mpeg', '.mpg', '.3gp', '.ts']),
  audio: new Set(['.mp3', '.wav', '.flac', '.aac', '.ogg', '.m4a', '.wma', '.opus', '.aiff']),
  document: new Set(['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.md', '.rtf', '.csv', '.json', '.xml', '.epub']),
  archive: new Set(['.zip', '.rar', '.7z', '.tar', '.gz', '.bz2', '.xz', '.cab', '.iso']),
}

export function fileCategoryOf(extension: string): ConcreteFileCategory {
  const normalized = extension.toLocaleLowerCase()
  for (const [category, extensions] of Object.entries(CATEGORY_EXTENSIONS)) {
    if (extensions.has(normalized)) return category as ConcreteFileCategory
  }
  return 'other'
}
