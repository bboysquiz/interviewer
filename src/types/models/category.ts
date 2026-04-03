import type { BaseEntity, EntityId } from './base'

export interface Category extends BaseEntity {
  slug: string
  name: string
  description: string
  color: string | null
  icon: string | null
  sortOrder: number
  noteIds: EntityId[]
  noteCount: number
  attachmentCount: number
}
