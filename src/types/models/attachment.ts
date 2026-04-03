import type { BaseEntity, EntityId, ISODateString } from './base'

export type AttachmentType = 'image'
export type AttachmentProcessingStatus =
  | 'pending'
  | 'processing'
  | 'ready'
  | 'failed'

export interface Attachment extends BaseEntity {
  noteId: EntityId
  categoryId: EntityId
  type: AttachmentType
  originalFileName: string
  storedFileName: string
  storagePath: string
  mimeType: string
  sizeBytes: number
  width: number | null
  height: number | null
  extractedText: string | null
  imageDescription: string | null
  keyTerms: string[]
  processingStatus: AttachmentProcessingStatus
  processedAt: ISODateString | null
  processingError: string | null
  analysisModel: string | null
  analysisRequestId: string | null
}
