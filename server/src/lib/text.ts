import { randomUUID } from 'node:crypto'

export const nowIso = (): string => new Date().toISOString()

export const createId = (): string => randomUUID()

export const slugify = (value: string): string =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || `item-${randomUUID().slice(0, 8)}`

export const coerceString = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value.trim() : fallback

export const coerceNullableString = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
}

export const coerceStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []

export const coerceNumber = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }

  return null
}

export const makeExcerpt = (value: string, maxLength = 160): string =>
  value.length <= maxLength ? value : `${value.slice(0, maxLength).trimEnd()}...`
