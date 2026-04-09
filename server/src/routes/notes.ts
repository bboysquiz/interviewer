import fs from 'node:fs'
import path from 'node:path'

import { Router } from 'express'

import { UPLOADS_DIR } from '../config.js'
import type { SqliteDatabase } from '../db.js'
import { replaceNoteContentChunks } from '../lib/chunks.js'
import {
  buildLegacyNoteContentBlocks,
  deriveRawTextFromContentBlocks,
  extractAttachmentIdsFromContentBlocks,
  parseNoteContentBlocks,
  serializeNoteContentBlocks,
  type NoteContentBlock,
} from '../lib/noteContent.js'
import { coerceString, createId, nowIso } from '../lib/text.js'
import { createAnalyticsRepository } from '../services/analyticsRepository.js'
import { AiServiceError } from '../services/ai/errors.js'
import { reorganizeNoteContent } from '../services/noteOrganization.js'

interface NoteRow {
  id: string
  category_id: string
  title: string
  content: string
  content_json: string | null
  created_at: string
  updated_at: string
}

const hasOwn = (value: Record<string, unknown>, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(value, key)

const parseProviderFromModel = (model: string): string => {
  const normalized = model.trim()
  const separatorIndex = normalized.indexOf(':')

  if (separatorIndex <= 0) {
    return 'unknown'
  }

  return normalized.slice(0, separatorIndex)
}

export const createNotesRouter = (db: SqliteDatabase): Router => {
  const router = Router()
  const analyticsRepository = createAnalyticsRepository(db)

  const buildListPlaceholders = (length: number): string =>
    Array.from({ length }, () => '?').join(', ')

  const removeStoredFiles = (
    attachmentRows: Array<{ stored_file_name: string }>,
  ): void => {
    for (const attachment of attachmentRows) {
      if (!attachment.stored_file_name) {
        continue
      }

      try {
        fs.rmSync(path.join(UPLOADS_DIR, attachment.stored_file_name), {
          force: true,
        })
      } catch {
        // The database state is already updated; missing files should not break the request.
      }
    }
  }

  const categoryExistsStatement = db.prepare(
    'SELECT id FROM categories WHERE id = ? LIMIT 1',
  )
  const categoryByIdStatement = db.prepare(
    'SELECT id, name FROM categories WHERE id = ? LIMIT 1',
  )
  const attachmentRowsStatement = db.prepare(
    `
      SELECT id, stored_file_name
      FROM attachments
      WHERE note_id = ?
      ORDER BY created_at ASC
    `,
  )
  const attachmentDetailsStatement = db.prepare(
    `
      SELECT
        id,
        original_file_name,
        extracted_text,
        image_description
      FROM attachments
      WHERE note_id = ?
      ORDER BY created_at ASC
    `,
  )
  const chunkIdsStatement = db.prepare(
    'SELECT id FROM note_chunks WHERE note_id = ? ORDER BY chunk_index ASC',
  )
  const listStatement = db.prepare(
    `
      SELECT
        id,
        category_id,
        title,
        content,
        content_json,
        created_at,
        updated_at
      FROM notes
      WHERE (? IS NULL OR category_id = ?)
      ORDER BY updated_at DESC, created_at DESC
    `,
  )
  const byIdStatement = db.prepare(
    `
      SELECT
        id,
        category_id,
        title,
        content,
        content_json,
        created_at,
        updated_at
      FROM notes
      WHERE id = ?
    `,
  )
  const insertStatement = db.prepare(
    `
      INSERT INTO notes (
        id,
        category_id,
        title,
        content,
        content_json,
        content_format,
        summary,
        tags_json,
        status,
        last_reviewed_at,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, 'mixed_blocks', NULL, '[]', 'active', NULL, ?, ?)
    `,
  )
  const updateStatement = db.prepare(
    `
      UPDATE notes
      SET
        title = ?,
        content = ?,
        content_json = ?,
        content_format = 'mixed_blocks',
        updated_at = ?
      WHERE id = ?
    `,
  )
  const deleteStatement = db.prepare('DELETE FROM notes WHERE id = ?')

  const mapNote = (row: NoteRow) => {
    const attachmentRows = attachmentRowsStatement.all(row.id) as Array<{
      id: string
      stored_file_name: string
    }>
    const attachmentIds = attachmentRows.map((attachment) => attachment.id)
    const contentBlocks = parseNoteContentBlocks(
      row.content_json,
      row.content,
      attachmentIds,
    )

    return {
      id: row.id,
      categoryId: row.category_id,
      title: row.title,
      rawText: row.content,
      contentBlocks,
      attachmentIds,
      chunkIds: (chunkIdsStatement.all(row.id) as Array<{ id: string }>).map(
        (record) => record.id,
      ),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }

  const getNoteById = (noteId: string) => {
    const row = byIdStatement.get(noteId) as NoteRow | undefined
    return row ? mapNote(row) : null
  }

  router.get('/', (request, response) => {
    const categoryId =
      typeof request.query.categoryId === 'string'
        ? request.query.categoryId
        : null

    const rows = listStatement.all(categoryId, categoryId) as NoteRow[]
    response.json(rows.map(mapNote))
  })

  router.get('/:id', (request, response) => {
    const note = getNoteById(request.params.id)

    if (!note) {
      response.status(404).json({
        message: `Note "${request.params.id}" was not found.`,
      })
      return
    }

    response.json(note)
  })

  router.post('/', (request, response) => {
    const body = request.body as Record<string, unknown>
    const categoryId = coerceString(body.categoryId)
    const title = coerceString(body.title)
    const rawTextInput = coerceString(body.rawText, coerceString(body.content))
    const contentBlocks = hasOwn(body, 'contentBlocks')
      ? parseNoteContentBlocks(body.contentBlocks, rawTextInput)
      : buildLegacyNoteContentBlocks(rawTextInput)
    const rawText = deriveRawTextFromContentBlocks(contentBlocks)

    if (!categoryId || !title) {
      response.status(400).json({
        message: 'Fields "categoryId" and "title" are required.',
      })
      return
    }

    const referencedAttachmentIds = extractAttachmentIdsFromContentBlocks(
      contentBlocks,
    )

    if (referencedAttachmentIds.length > 0) {
      response.status(400).json({
        message:
          'New notes cannot reference attachments before the files are uploaded.',
      })
      return
    }

    const category = categoryExistsStatement.get(categoryId) as
      | { id: string }
      | undefined

    if (!category) {
      response.status(404).json({
        message: `Category "${categoryId}" was not found.`,
      })
      return
    }

    const id = createId()
    const timestamp = nowIso()

    insertStatement.run(
      id,
      categoryId,
      title,
      rawText,
      serializeNoteContentBlocks(contentBlocks),
      timestamp,
      timestamp,
    )

    replaceNoteContentChunks(db, {
      noteId: id,
      categoryId,
      title,
      content: rawText,
    })

    response.status(201).json(getNoteById(id))
  })

  router.patch('/:id', (request, response) => {
    const noteId = request.params.id
    const existing = byIdStatement.get(noteId) as NoteRow | undefined

    if (!existing) {
      response.status(404).json({
        message: `Note "${noteId}" was not found.`,
      })
      return
    }

    const body = request.body as Record<string, unknown>
    const currentAttachmentRows = attachmentRowsStatement.all(noteId) as Array<{
      id: string
      stored_file_name: string
    }>
    const currentAttachmentIds = currentAttachmentRows.map(
      (attachment) => attachment.id,
    )
    const nextTitle = hasOwn(body, 'title')
      ? coerceString(body.title)
      : existing.title
    const nextRawTextInput = hasOwn(body, 'rawText')
      ? coerceString(body.rawText, coerceString(body.content))
      : hasOwn(body, 'content')
        ? coerceString(body.content)
        : null
    const nextContentBlocks: NoteContentBlock[] = hasOwn(body, 'contentBlocks')
      ? parseNoteContentBlocks(
          body.contentBlocks,
          nextRawTextInput ?? existing.content,
        )
      : nextRawTextInput !== null
        ? buildLegacyNoteContentBlocks(nextRawTextInput, currentAttachmentIds)
        : parseNoteContentBlocks(
            existing.content_json,
            existing.content,
            currentAttachmentIds,
          )
    const nextRawText =
      hasOwn(body, 'contentBlocks') || nextRawTextInput === null
        ? deriveRawTextFromContentBlocks(nextContentBlocks)
        : nextRawTextInput

    if (!nextTitle) {
      response.status(400).json({
        message: 'Field "title" cannot be empty.',
      })
      return
    }

    const referencedAttachmentIds = extractAttachmentIdsFromContentBlocks(
      nextContentBlocks,
    )
    const invalidAttachmentId = referencedAttachmentIds.find(
      (attachmentId) => !currentAttachmentIds.includes(attachmentId),
    )

    if (invalidAttachmentId) {
      response.status(400).json({
        message: `Attachment "${invalidAttachmentId}" does not belong to note "${noteId}".`,
      })
      return
    }

    const removedAttachmentRows = currentAttachmentRows.filter(
      (attachment) => !referencedAttachmentIds.includes(attachment.id),
    )
    const updatedAt = nowIso()

    const saveNoteTransaction = db.transaction(() => {
      if (removedAttachmentRows.length > 0) {
        const deleteRemovedAttachmentsStatement = db.prepare(
          `
            DELETE FROM attachments
            WHERE id IN (${buildListPlaceholders(removedAttachmentRows.length)})
          `,
        )

        deleteRemovedAttachmentsStatement.run(
          ...removedAttachmentRows.map((attachment) => attachment.id),
        )
      }

      updateStatement.run(
        nextTitle,
        nextRawText,
        serializeNoteContentBlocks(nextContentBlocks),
        updatedAt,
        noteId,
      )

      replaceNoteContentChunks(db, {
        noteId,
        categoryId: existing.category_id,
        title: nextTitle,
        content: nextRawText,
      })
    })

    saveNoteTransaction()
    removeStoredFiles(removedAttachmentRows)

    response.json(getNoteById(noteId))
  })

  router.post('/:id/organize', async (request, response) => {
    const noteId = request.params.id
    const existing = byIdStatement.get(noteId) as NoteRow | undefined

    if (!existing) {
      response.status(404).json({
        message: `Note "${noteId}" was not found.`,
      })
      return
    }

    const attachmentRows = attachmentDetailsStatement.all(noteId) as Array<{
      id: string
      original_file_name: string | null
      extracted_text: string | null
      image_description: string | null
    }>
    const currentAttachmentIds = attachmentRows.map((attachment) => attachment.id)
    const currentContentBlocks = parseNoteContentBlocks(
      existing.content_json,
      existing.content,
      currentAttachmentIds,
    )
    const categoryRow = categoryByIdStatement.get(existing.category_id) as
      | { id: string; name?: string }
      | undefined

    try {
      const organized = await reorganizeNoteContent({
        categoryName: categoryRow?.name ?? null,
        noteTitle: existing.title,
        blocks: currentContentBlocks,
        attachmentsById: Object.fromEntries(
          attachmentRows.map((attachment) => [
            attachment.id,
            {
              id: attachment.id,
              originalFileName: attachment.original_file_name,
              extractedText: attachment.extracted_text,
              imageDescription: attachment.image_description,
            },
          ]),
        ),
      })
      const updatedAt = nowIso()
      const nextRawText = deriveRawTextFromContentBlocks(organized.contentBlocks)

      updateStatement.run(
        existing.title,
        nextRawText,
        serializeNoteContentBlocks(organized.contentBlocks),
        updatedAt,
        noteId,
      )

      replaceNoteContentChunks(db, {
        noteId,
        categoryId: existing.category_id,
        title: existing.title,
        content: nextRawText,
      })

      if (!organized.model.startsWith('local:')) {
        analyticsRepository.recordAiUsageEvent({
          task: 'note_organization',
          provider: parseProviderFromModel(organized.model),
          model: organized.model,
          requestId: organized.requestId,
          categoryId: existing.category_id,
          noteId,
          inputTokens: organized.usage?.inputTokens ?? null,
          outputTokens: organized.usage?.outputTokens ?? null,
          totalTokens: organized.usage?.totalTokens ?? null,
          occurredAt: updatedAt,
        })
      }

      response.json({
        note: getNoteById(noteId),
        organized: {
          sectionCount: organized.sectionCount,
        },
        ai: {
          model: organized.model,
          requestId: organized.requestId,
          usage: organized.usage,
        },
      })
    } catch (error) {
      if (error instanceof AiServiceError) {
        const safeStatus =
          error.status >= 500
            ? error.code === 'ai_invalid_response'
              ? 422
              : 424
            : error.status

        response.status(safeStatus).json({
          message: error.message,
          code: error.code,
          ...(error.details !== undefined ? { details: error.details } : {}),
        })
        return
      }

      response.status(500).json({
        message:
          error instanceof Error
            ? error.message
            : 'AI note organization failed.',
      })
    }
  })

  router.delete('/:id', (request, response) => {
    const attachmentRows = attachmentRowsStatement.all(
      request.params.id,
    ) as Array<{
      id: string
      stored_file_name: string
    }>
    const result = deleteStatement.run(request.params.id)

    if (result.changes === 0) {
      response.status(404).json({
        message: `Note "${request.params.id}" was not found.`,
      })
      return
    }

    removeStoredFiles(attachmentRows)
    response.status(204).send()
  })

  return router
}
