export type EntityId = string
export type ISODateString = string

export interface BaseEntity {
  id: EntityId
  createdAt: ISODateString
  updatedAt: ISODateString
}
