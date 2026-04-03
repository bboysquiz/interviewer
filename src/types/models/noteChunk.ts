import type { BaseEntity, EntityId } from './base'

export type NoteChunkSource =
  | 'note_title'
  | 'note_content'
  | 'attachment_extracted_text'
  | 'attachment_description'

export type NoteChunkEmbeddingStatus = 'pending' | 'ready' | 'failed'

export interface NoteChunk extends BaseEntity {
  noteId: EntityId
  categoryId: EntityId
  attachmentId: EntityId | null
  source: NoteChunkSource
  chunkIndex: number
  content: string
  summary: string | null
  searchText: string
  startOffset: number | null
  endOffset: number | null
  embeddingStatus: NoteChunkEmbeddingStatus
  embeddingModel: string | null
  embeddingUpdatedAt: string | null
  embeddingChecksum: string | null
}
