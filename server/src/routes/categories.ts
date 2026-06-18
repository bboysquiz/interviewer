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
  LEFT JOIN notes n ON n.category_id = c.id AND n.user_id = c.user_id
  LEFT JOIN attachments a ON a.category_id = c.id AND a.user_id = c.user_id
`

const hasOwn = (value: Record<string, unknown>, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(value, key)

const buildUniqueSlug = (
  db: SqliteDatabase,
  rawValue: string,
  username: string,
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
  const normalizedUsername = slugify(username)

  while (
    (existingStatement.get(
      candidate,
      excludeId ?? null,
      excludeId ?? null,
    ) as {
      count: number
    }).count > 0
  ) {
    const scopedBase =
      suffix === 2 && normalizedUsername
        ? `${baseSlug}-${normalizedUsername}`
        : baseSlug
    candidate = `${scopedBase}-${suffix}`
    suffix += 1
  }

  return candidate
}

export const createCategoriesRouter = (db: SqliteDatabase): Router => {
  const router = Router()

  const noteIdsStatement = db.prepare(
    'SELECT id FROM notes WHERE user_id = ? AND category_id = ? ORDER BY created_at ASC',
  )
  const nextSortOrderStatement = db.prepare(
    'SELECT COALESCE(MAX(sort_order), -1) + 1 AS sort_order FROM categories WHERE user_id = ?',
  )
  const categoryIdsStatement = db.prepare(
    'SELECT id FROM categories WHERE user_id = ? ORDER BY sort_order ASC, name ASC',
  )
  const listStatement = db.prepare(`
    ${baseCategorySelect}
    WHERE c.user_id = ?
    GROUP BY c.id
    ORDER BY c.sort_order ASC, c.name ASC
  `)
  const byIdStatement = db.prepare(`
    ${baseCategorySelect}
    WHERE c.user_id = ? AND c.id = ?
    GROUP BY c.id
  `)
  const deleteStatement = db.prepare(
    'DELETE FROM categories WHERE user_id = ? AND id = ?',
  )
  const updateSortOrderStatement = db.prepare(
    'UPDATE categories SET sort_order = ?, updated_at = ? WHERE user_id = ? AND id = ?',
  )
  const updateCategoryOrder = db.transaction(
    (userId: string, categoryIds: string[], updatedAt: string) => {
      categoryIds.forEach((categoryId, index) => {
        updateSortOrderStatement.run(index, updatedAt, userId, categoryId)
      })
    },
  )

  const mapCategory = (userId: string, row: CategoryRow) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    color: row.color,
    icon: row.icon,
    sortOrder: row.sort_order,
    noteIds: (noteIdsStatement.all(userId, row.id) as Array<{ id: string }>).map(
      (record) => record.id,
    ),
    noteCount: row.note_count,
    attachmentCount: row.attachment_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  })

  const getCategoryById = (userId: string, categoryId: string) => {
    const row = byIdStatement.get(userId, categoryId) as CategoryRow | undefined
    return row ? mapCategory(userId, row) : null
  }

  router.get('/', (request, response) => {
    const userId = request.authUser!.id
    const rows = listStatement.all(userId) as CategoryRow[]
    response.json(rows.map((row) => mapCategory(userId, row)))
  })

  router.post('/', (request, response) => {
    const userId = request.authUser!.id
    const username = request.authUser!.username
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
        : ((nextSortOrderStatement.get(userId) as { sort_order: number })
            .sort_order ?? 0)
    const timestamp = nowIso()
    const id = createId()
    const slug = buildUniqueSlug(
      db,
      coerceString(body.slug, name),
      username,
    )

    db.prepare(
      `
        INSERT INTO categories (
          id,
          user_id,
          slug,
          name,
          description,
          color,
          icon,
          sort_order,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    ).run(
      id,
      userId,
      slug,
      name,
      description,
      color,
      icon,
      sortOrder,
      timestamp,
      timestamp,
    )

    response.status(201).json(getCategoryById(userId, id))
  })

  router.patch('/order', (request, response) => {
    const userId = request.authUser!.id
    const body = request.body as Record<string, unknown>

    if (!Array.isArray(body.categoryIds)) {
      response.status(400).json({
        message: 'Field "categoryIds" must be an array.',
      })
      return
    }

    const requestedIds = body.categoryIds.map((value) => coerceString(value))

    if (requestedIds.some((categoryId) => !categoryId)) {
      response.status(400).json({
        message: 'Field "categoryIds" must contain only non-empty strings.',
      })
      return
    }

    const uniqueRequestedIds = [...new Set(requestedIds)]

    if (uniqueRequestedIds.length !== requestedIds.length) {
      response.status(400).json({
        message: 'Field "categoryIds" must not contain duplicate ids.',
      })
      return
    }

    const currentIds = (
      categoryIdsStatement.all(userId) as Array<{ id: string }>
    ).map((record) => record.id)
    const currentIdSet = new Set(currentIds)
    const unknownId = uniqueRequestedIds.find(
      (categoryId) => !currentIdSet.has(categoryId),
    )

    if (unknownId) {
      response.status(404).json({
        message: `Category "${unknownId}" was not found.`,
      })
      return
    }

    const requestedIdSet = new Set(uniqueRequestedIds)
    const nextIds = [
      ...uniqueRequestedIds,
      ...currentIds.filter((categoryId) => !requestedIdSet.has(categoryId)),
    ]
    const updatedAt = nowIso()

    updateCategoryOrder(userId, nextIds, updatedAt)

    const rows = listStatement.all(userId) as CategoryRow[]
    response.json(rows.map((row) => mapCategory(userId, row)))
  })

  router.patch('/:id', (request, response) => {
    const userId = request.authUser!.id
    const username = request.authUser!.username
    const categoryId = request.params.id
    const existing = byIdStatement.get(userId, categoryId) as CategoryRow | undefined

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
        : buildUniqueSlug(db, rawSlugSource, username, categoryId)
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

    response.json(getCategoryById(userId, categoryId))
  })

  router.delete('/:id', (request, response) => {
    const userId = request.authUser!.id
    const categoryId = request.params.id
    const result = deleteStatement.run(userId, categoryId)

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
