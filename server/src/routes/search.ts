import { Router } from 'express'

import type { SqliteDatabase } from '../db.js'
import { makeExcerpt } from '../lib/text.js'

interface SearchRow {
  chunk_id: string
  note_id: string
  category_id: string
  attachment_id: string | null
  attachment_storage_path: string | null
  source:
    | 'note_title'
    | 'note_content'
    | 'attachment_extracted_text'
    | 'attachment_description'
  content: string
  note_title: string
  category_name: string
  attachment_name: string | null
  updated_at: string
  rank: number
}

const buildFtsQuery = (value: string): string => {
  const tokens = value
    .trim()
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean)

  return tokens
    .map((token) => `"${token.replace(/"/g, '""')}"*`)
    .join(' AND ')
}

export const createSearchRouter = (db: SqliteDatabase): Router => {
  const router = Router()

  const searchStatement = db.prepare(
    `
      SELECT
        nc.id AS chunk_id,
        nc.note_id,
        nc.category_id,
        nc.attachment_id,
        a.storage_path AS attachment_storage_path,
        nc.source,
        nc.content,
        n.title AS note_title,
        c.name AS category_name,
        a.original_file_name AS attachment_name,
        n.updated_at,
        bm25(note_chunks_fts) AS rank
      FROM note_chunks_fts
      INNER JOIN note_chunks nc ON nc.id = note_chunks_fts.chunk_id
      INNER JOIN notes n ON n.id = nc.note_id
      INNER JOIN categories c ON c.id = nc.category_id
      LEFT JOIN attachments a ON a.id = nc.attachment_id
      WHERE note_chunks_fts MATCH ?
        AND (? IS NULL OR nc.category_id = ?)
      ORDER BY
        CASE nc.source
          WHEN 'note_title' THEN 0
          WHEN 'note_content' THEN 1
          WHEN 'attachment_extracted_text' THEN 2
          ELSE 3
        END ASC,
        rank ASC,
        n.updated_at DESC
      LIMIT 50
    `,
  )

  router.get('/', (request, response) => {
    const query =
      typeof request.query.q === 'string' ? request.query.q.trim() : ''
    const categoryId =
      typeof request.query.categoryId === 'string'
        ? request.query.categoryId.trim()
        : null

    if (!query) {
      response.json([])
      return
    }

    const ftsQuery = buildFtsQuery(query)

    if (!ftsQuery) {
      response.json([])
      return
    }

    const rows = searchStatement.all(
      ftsQuery,
      categoryId || null,
      categoryId || null,
    ) as SearchRow[]

    const results = rows.map((row) => ({
      chunkId: row.chunk_id,
      noteId: row.note_id,
      categoryId: row.category_id,
      attachmentId: row.attachment_id,
      attachmentStoragePath: row.attachment_storage_path,
      source: row.source,
      noteTitle: row.note_title,
      categoryName: row.category_name,
      attachmentName: row.attachment_name,
      excerpt: makeExcerpt(row.content, 180),
      matchedText: row.content,
      rank: row.rank,
      updatedAt: row.updated_at,
    }))

    response.json(results)
  })

  return router
}
