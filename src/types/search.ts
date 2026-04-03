import type { EntityId, ISODateString } from './models'

export type SearchResultSource =
  | 'note_title'
  | 'note_content'
  | 'attachment_extracted_text'
  | 'attachment_description'

export interface SearchResult {
  chunkId: EntityId
  noteId: EntityId
  categoryId: EntityId
  attachmentId: EntityId | null
  attachmentStoragePath: string | null
  source: SearchResultSource
  noteTitle: string
  categoryName: string
  attachmentName: string | null
  excerpt: string
  matchedText: string
  rank: number
  updatedAt: ISODateString
}
