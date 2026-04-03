import { Router } from 'express'

import type { SqliteDatabase } from '../db.js'
import {
  coerceNullableString,
  coerceString,
  createId,
  nowIso,
  slugify,
} from '../lib/text.js'

interface CategoryRow {
  id: string
  slug: string
  name: string
  description: string
  color: string | null
  icon: string | null
  sort_order: number
  created_at: string
  updated_at: string
  note_count: number
  attachment_count: number
}

const baseCategorySelect = `
  SELECT
    c.id,
    c.slug,
    c.name,
    c.description,
    c.color,
    c.icon,
    c.sort_order,
    c.created_at,
    c.updated_at,
    COUNT(DISTINCT n.id) AS note_count,
    COUNT(DISTINCT a.id) AS attachment_count
  FROM categories c
  LEFT JOIN notes n ON n.category_id = c.id
  LEFT JOIN attachments a ON a.category_id = c.id
`

const hasOwn = (value: Record<string, unknown>, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(value, key)

const buildUniqueSlug = (
  db: SqliteDatabase,
  rawValue: string,
  excludeId?: string,
): string => {
  const baseSlug = slugify(rawValue)
  const existingStatement = db.prepare(
    `
      SELECT COUNT(*) AS count
      FROM categories
      WHERE slug = ?
        AND (? IS NULL OR id <> ?)
    `,
  )

  let candidate = baseSlug
  let suffix = 2

  while (
    (existingStatement.get(candidate, excludeId ?? null, excludeId ?? null) as {
      count: number
    }).count > 0
  ) {
    candidate = `${baseSlug}-${suffix}`
    suffix += 1
  }

  return candidate
}

export const createCategoriesRouter = (db: SqliteDatabase): Router => {
  const router = Router()

  const noteIdsStatement = db.prepare(
    'SELECT id FROM notes WHERE category_id = ? ORDER BY created_at ASC',
  )
  const listStatement = db.prepare(`
    ${baseCategorySelect}
    GROUP BY c.id
    ORDER BY c.sort_order ASC, c.name ASC
  `)
  const byIdStatement = db.prepare(`
    ${baseCategorySelect}
    WHERE c.id = ?
    GROUP BY c.id
  `)
  const deleteStatement = db.prepare('DELETE FROM categories WHERE id = ?')

  const mapCategory = (row: CategoryRow) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    color: row.color,
    icon: row.icon,
    sortOrder: row.sort_order,
    noteIds: (noteIdsStatement.all(row.id) as Array<{ id: string }>).map(
      (record) => record.id,
    ),
    noteCount: row.note_count,
    attachmentCount: row.attachment_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  })

  const getCategoryById = (categoryId: string) => {
    const row = byIdStatement.get(categoryId) as CategoryRow | undefined
    return row ? mapCategory(row) : null
  }

  router.get('/', (_request, response) => {
    const rows = listStatement.all() as CategoryRow[]
    response.json(rows.map(mapCategory))
  })

  router.post('/', (request, response) => {
    const body = request.body as Record<string, unknown>
    const name = coerceString(body.name)

    if (!name) {
      response.status(400).json({
        message: 'Field "name" is required.',
      })
      return
    }

    const description = coerceString(body.description)
    const color = coerceNullableString(body.color)
    const icon = coerceNullableString(body.icon)
    const sortOrder =
      typeof body.sortOrder === 'number' && Number.isFinite(body.sortOrder)
        ? body.sortOrder
        : 0
    const timestamp = nowIso()
    const id = createId()
    const slug = buildUniqueSlug(db, coerceString(body.slug, name))

    db.prepare(
      `
        INSERT INTO categories (
          id,
          slug,
          name,
          description,
          color,
          icon,
          sort_order,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    ).run(
      id,
      slug,
      name,
      description,
      color,
      icon,
      sortOrder,
      timestamp,
      timestamp,
    )

    response.status(201).json(getCategoryById(id))
  })

  router.patch('/:id', (request, response) => {
    const categoryId = request.params.id
    const existing = byIdStatement.get(categoryId) as CategoryRow | undefined

    if (!existing) {
      response.status(404).json({
        message: `Category "${categoryId}" was not found.`,
      })
      return
    }

    const body = request.body as Record<string, unknown>
    const nextName = hasOwn(body, 'name')
      ? coerceString(body.name)
      : existing.name

    if (!nextName) {
      response.status(400).json({
        message: 'Field "name" cannot be empty.',
      })
      return
    }

    const nextDescription = hasOwn(body, 'description')
      ? coerceString(body.description)
      : existing.description
    const nextColor = hasOwn(body, 'color')
      ? coerceNullableString(body.color)
      : existing.color
    const nextIcon = hasOwn(body, 'icon')
      ? coerceNullableString(body.icon)
      : existing.icon
    const nextSortOrder =
      hasOwn(body, 'sortOrder') &&
      typeof body.sortOrder === 'number' &&
      Number.isFinite(body.sortOrder)
        ? body.sortOrder
        : existing.sort_order

    const rawSlugSource = hasOwn(body, 'slug')
      ? coerceString(body.slug, nextName)
      : hasOwn(body, 'name')
        ? nextName
        : existing.slug
    const nextSlug =
      rawSlugSource === existing.slug
        ? existing.slug
        : buildUniqueSlug(db, rawSlugSource, categoryId)
    const updatedAt = nowIso()

    db.prepare(
      `
        UPDATE categories
        SET
          slug = ?,
          name = ?,
          description = ?,
          color = ?,
          icon = ?,
          sort_order = ?,
          updated_at = ?
        WHERE id = ?
      `,
    ).run(
      nextSlug,
      nextName,
      nextDescription,
      nextColor,
      nextIcon,
      nextSortOrder,
      updatedAt,
      categoryId,
    )

    response.json(getCategoryById(categoryId))
  })

  router.delete('/:id', (request, response) => {
    const categoryId = request.params.id
    const result = deleteStatement.run(categoryId)

    if (result.changes === 0) {
      response.status(404).json({
        message: `Category "${categoryId}" was not found.`,
      })
      return
    }

    response.status(204).send()
  })

  return router
}
