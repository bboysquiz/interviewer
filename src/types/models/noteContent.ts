import type { EntityId } from './base'

export interface NoteTextBlock {
  id: string
  type: 'text'
  text: string
}

export interface NoteImageBlock {
  id: string
  type: 'image'
  attachmentId: EntityId
}

export type NoteContentBlock = NoteTextBlock | NoteImageBlock
