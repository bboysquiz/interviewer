import type { BaseEntity, EntityId } from './base'
import type { NoteContentBlock } from './noteContent'

export interface Note extends BaseEntity {
  categoryId: EntityId
  title: string
  rawText: string
  contentBlocks: NoteContentBlock[]
  attachmentIds: EntityId[]
  chunkIds: EntityId[]
}
