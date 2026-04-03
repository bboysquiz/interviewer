import path from 'node:path'

import multer from 'multer'
import { Router } from 'express'

import { UPLOADS_DIR } from '../config.js'
import type { SqliteDatabase } from '../db.js'
import { parseStringArray, toJson } from '../lib/json.js'
import { replaceAttachmentChunks } from '../lib/chunks.js'
import {
  coerceNullableString,
  coerceNumber,
  coerceString,
  createId,
  nowIso,
} from '../lib/text.js'
import { analyzeAttachmentWithOpenAI } from '../services/openaiImageAnalysis.js'

interface AttachmentRow {
  id: string
  note_id: string
  category_id: string
  type: 'image'
  original_file_name: string
  stored_file_name: string
  storage_path: string
  mime_type: string
  size_bytes: number
  width: number | null
  height: number | null
  extracted_text: string | null
  image_description: string | null
  key_terms_json: string
  processing_status: 'pending' | 'processing' | 'ready' | 'failed'
  processed_at: string | null
  processing_error: string | null
  analysis_model: string | null
  analysis_request_id: string | null
  created_at: string
  updated_at: string
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (_request, _file, callback) => {
      callback(null, UPLOADS_DIR)
    },
    filename: (_request, file, callback) => {
      const extension = path.extname(file.originalname)
      callback(null, `${createId()}${extension}`)
    },
  }),
  limits: {
    fileSize: 10 * 1024 * 1024,
  },
})

const buildAttachment = (row: AttachmentRow) => ({
  id: row.id,
  noteId: row.note_id,
  categoryId: row.category_id,
  type: row.type,
  originalFileName: row.original_file_name,
  storedFileName: row.stored_file_name,
  storagePath: row.storage_path,
  mimeType: row.mime_type,
  sizeBytes: row.size_bytes,
  width: row.width,
  height: row.height,
  extractedText: row.extracted_text,
  imageDescription: row.image_description,
  keyTerms: parseStringArray(row.key_terms_json),
  processingStatus: row.processing_status,
  processedAt: row.processed_at,
  processingError: row.processing_error,
  analysisModel: row.analysis_model,
  analysisRequestId: row.analysis_request_id,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

export const createAttachmentsRouter = (db: SqliteDatabase): Router => {
  const router = Router()

  const noteLookupStatement = db.prepare(
    'SELECT id, category_id FROM notes WHERE id = ? LIMIT 1',
  )
  const attachmentByIdStatement = db.prepare(
    `
      SELECT
        id,
        note_id,
        category_id,
        type,
        original_file_name,
        stored_file_name,
        storage_path,
        mime_type,
        size_bytes,
        width,
        height,
        extracted_text,
        image_description,
        key_terms_json,
        processing_status,
        processed_at,
        processing_error,
        analysis_model,
        analysis_request_id,
        created_at,
        updated_at
      FROM attachments
      WHERE id = ?
    `,
  )
  const listStatement = db.prepare(
    `
      SELECT
        id,
        note_id,
        category_id,
        type,
        original_file_name,
        stored_file_name,
        storage_path,
        mime_type,
        size_bytes,
        width,
        height,
        extracted_text,
        image_description,
        key_terms_json,
        processing_status,
        processed_at,
        processing_error,
        analysis_model,
        analysis_request_id,
        created_at,
        updated_at
      FROM attachments
      WHERE (? IS NULL OR note_id = ?)
        AND (? IS NULL OR category_id = ?)
      ORDER BY created_at DESC
    `,
  )

  const getAttachmentById = (attachmentId: string) => {
    const row = attachmentByIdStatement.get(attachmentId) as
      | AttachmentRow
      | undefined
    return row ? buildAttachment(row) : null
  }

  router.get('/', (request, response) => {
    const noteId =
      typeof request.query.noteId === 'string' ? request.query.noteId : null
    const categoryId =
      typeof request.query.categoryId === 'string'
        ? request.query.categoryId
        : null

    const rows = listStatement.all(
      noteId,
      noteId,
      categoryId,
      categoryId,
    ) as AttachmentRow[]

    response.json(rows.map(buildAttachment))
  })

  router.post('/', upload.single('file'), (request, response) => {
    const file = request.file
    const noteId = coerceString((request.body as Record<string, unknown>).noteId)

    if (!file || !noteId) {
      response.status(400).json({
        message: 'Multipart upload requires "file" and "noteId".',
      })
      return
    }

    const note = noteLookupStatement.get(noteId) as
      | { id: string; category_id: string }
      | undefined

    if (!note) {
      response.status(404).json({
        message: `Note "${noteId}" was not found.`,
      })
      return
    }

    const body = request.body as Record<string, unknown>
    const extractedText = coerceNullableString(body.extractedText)
    const imageDescription = coerceNullableString(body.imageDescription)
    const keyTerms = Array.isArray(body.keyTerms)
      ? body.keyTerms.filter(
          (term): term is string => typeof term === 'string' && term.trim() !== '',
        )
      : []
    const explicitStatus = coerceNullableString(body.processingStatus)
    const hasAnalysisData =
      Boolean(extractedText) || Boolean(imageDescription) || keyTerms.length > 0
    const processingStatus = explicitStatus ?? (hasAnalysisData ? 'ready' : 'pending')
    const processedAt = processingStatus === 'ready' ? nowIso() : null
    const timestamp = nowIso()
    const id = createId()

    db.prepare(
      `
        INSERT INTO attachments (
          id,
          note_id,
          category_id,
          type,
          original_file_name,
          stored_file_name,
          storage_path,
          mime_type,
          size_bytes,
          width,
          height,
          extracted_text,
          image_description,
          key_terms_json,
          processing_status,
          processed_at,
          processing_error,
          analysis_model,
          analysis_request_id,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, 'image', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?)
      `,
    ).run(
      id,
      note.id,
      note.category_id,
      file.originalname,
      file.filename,
      `/uploads/${file.filename}`,
      file.mimetype,
      file.size,
      coerceNumber(body.width),
      coerceNumber(body.height),
      extractedText,
      imageDescription,
      toJson(keyTerms),
      processingStatus,
      processedAt,
      timestamp,
      timestamp,
    )

    replaceAttachmentChunks(db, {
      attachmentId: id,
      noteId: note.id,
      categoryId: note.category_id,
      extractedText,
      imageDescription,
      keyTerms,
    })

    const attachment = getAttachmentById(id)

    response.status(201).json(attachment)

    if (!hasAnalysisData) {
      queueMicrotask(() => {
        void analyzeAttachmentWithOpenAI(db, id).catch(() => {
          // The analysis service writes the failed state into the database.
        })
      })
    }
  })

  router.patch('/:id/processing', (request, response) => {
    const attachmentId = request.params.id
    const attachment = attachmentByIdStatement.get(attachmentId) as
      | AttachmentRow
      | undefined

    if (!attachment) {
      response.status(404).json({
        message: `Attachment "${attachmentId}" was not found.`,
      })
      return
    }

    const body = request.body as Record<string, unknown>
    const extractedText =
      coerceNullableString(body.extractedText) ?? attachment.extracted_text
    const imageDescription =
      coerceNullableString(body.imageDescription) ?? attachment.image_description
    const keyTerms = Array.isArray(body.keyTerms)
      ? body.keyTerms.filter(
          (term): term is string => typeof term === 'string' && term.trim() !== '',
        )
      : parseStringArray(attachment.key_terms_json)
    const processingStatus =
      coerceNullableString(body.processingStatus) ??
      attachment.processing_status
    const processingError =
      coerceNullableString(body.processingError) ?? attachment.processing_error
    const analysisModel =
      coerceNullableString(body.analysisModel) ?? attachment.analysis_model
    const analysisRequestId =
      coerceNullableString(body.analysisRequestId) ?? attachment.analysis_request_id
    const width = coerceNumber(body.width) ?? attachment.width
    const height = coerceNumber(body.height) ?? attachment.height
    const processedAt =
      processingStatus === 'ready' ? nowIso() : attachment.processed_at
    const updatedAt = nowIso()

    db.prepare(
      `
        UPDATE attachments
        SET
          extracted_text = ?,
          image_description = ?,
          key_terms_json = ?,
          processing_status = ?,
          processed_at = ?,
          processing_error = ?,
          analysis_model = ?,
          analysis_request_id = ?,
          width = ?,
          height = ?,
          updated_at = ?
        WHERE id = ?
      `,
    ).run(
      extractedText,
      imageDescription,
      toJson(keyTerms),
      processingStatus,
      processedAt,
      processingError,
      analysisModel,
      analysisRequestId,
      width,
      height,
      updatedAt,
      attachmentId,
    )

    replaceAttachmentChunks(db, {
      attachmentId,
      noteId: attachment.note_id,
      categoryId: attachment.category_id,
      extractedText,
      imageDescription,
      keyTerms,
    })

    const updated = getAttachmentById(attachmentId)
    response.json(updated)
  })

  router.post('/:id/analyze', async (request, response) => {
    const attachmentId = request.params.id
    const body = request.body as Record<string, unknown>
    const force = body.force === true

    try {
      const analysis = await analyzeAttachmentWithOpenAI(db, attachmentId, {
        force,
      })
      const attachment = getAttachmentById(attachmentId)

      response.json({
        attachment,
        analysis,
      })
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'AI image analysis failed.'
      const status =
        typeof error === 'object' &&
        error !== null &&
        'status' in error &&
        typeof error.status === 'number'
          ? error.status
          : 500

      response.status(status).json({
        message,
      })
    }
  })

  return router
}
