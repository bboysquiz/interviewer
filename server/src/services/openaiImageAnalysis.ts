import fs from 'node:fs/promises'
import path from 'node:path'

import { OPENAI_IMAGE_ANALYSIS_MODEL, UPLOADS_DIR } from '../config.js'
import type { SqliteDatabase } from '../db.js'
import { parseStringArray, toJson } from '../lib/json.js'
import { replaceAttachmentChunks } from '../lib/chunks.js'
import { nowIso } from '../lib/text.js'
import { analyzeImageForKnowledgeBase } from './ai/openAiService.js'
import { AiServiceError } from './ai/errors.js'

interface AttachmentAnalysisRow {
  id: string
  note_id: string
  category_id: string
  stored_file_name: string
  mime_type: string
  extracted_text: string | null
  image_description: string | null
  key_terms_json: string
  processing_status: 'pending' | 'processing' | 'ready' | 'failed'
}

export interface AttachmentAnalysisExecution {
  status: 'completed' | 'skipped'
  model: string | null
  requestId: string | null
  usage: {
    inputTokens: number | null
    outputTokens: number | null
    totalTokens: number | null
  } | null
}

const attachmentByIdStatementSql = `
  SELECT
    id,
    note_id,
    category_id,
    stored_file_name,
    mime_type,
    extracted_text,
    image_description,
    key_terms_json,
    processing_status
  FROM attachments
  WHERE id = ?
`

const normalizeOptionalString = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
}

const encodeImageAsDataUrl = async (
  filePath: string,
  mimeType: string,
): Promise<string> => {
  const fileBuffer = await fs.readFile(filePath)
  return `data:${mimeType};base64,${fileBuffer.toString('base64')}`
}

const markAttachmentAsFailed = (
  db: SqliteDatabase,
  attachmentId: string,
  message: string,
): void => {
  db.prepare(
    `
      UPDATE attachments
      SET
        processing_status = 'failed',
        processing_error = ?,
        updated_at = ?
      WHERE id = ?
    `,
  ).run(message, nowIso(), attachmentId)
}

export const analyzeAttachmentWithOpenAI = async (
  db: SqliteDatabase,
  attachmentId: string,
  options: { force?: boolean } = {},
): Promise<AttachmentAnalysisExecution> => {
  const attachmentByIdStatement = db.prepare(attachmentByIdStatementSql)
  const attachment = attachmentByIdStatement.get(attachmentId) as
    | AttachmentAnalysisRow
    | undefined

  if (!attachment) {
    throw new AiServiceError(`Attachment "${attachmentId}" was not found.`, {
      status: 404,
      code: 'ai_not_found',
    })
  }

  const existingKeyTerms = parseStringArray(attachment.key_terms_json)
  const alreadyProcessed =
    attachment.processing_status === 'ready' &&
    (Boolean(attachment.extracted_text) ||
      Boolean(attachment.image_description) ||
      existingKeyTerms.length > 0)

  if (alreadyProcessed && !options.force) {
    return {
      status: 'skipped',
      model: OPENAI_IMAGE_ANALYSIS_MODEL,
      requestId: null,
      usage: null,
    }
  }

  db.prepare(
    `
      UPDATE attachments
      SET
        processing_status = 'processing',
        processing_error = NULL,
        updated_at = ?
      WHERE id = ?
    `,
  ).run(nowIso(), attachmentId)

  try {
    const imagePath = path.join(UPLOADS_DIR, attachment.stored_file_name)
    const imageDataUrl = await encodeImageAsDataUrl(
      imagePath,
      attachment.mime_type,
    )
    const analysis = await analyzeImageForKnowledgeBase({
      imageDataUrl,
    })
    const extractedText = normalizeOptionalString(analysis.extractedText)
    const imageDescription = normalizeOptionalString(analysis.imageDescription)
    const keyTerms = analysis.keyTerms
    const processedAt = nowIso()

    db.prepare(
      `
        UPDATE attachments
        SET
          extracted_text = ?,
          image_description = ?,
          key_terms_json = ?,
          processing_status = 'ready',
          processed_at = ?,
          processing_error = NULL,
          analysis_model = ?,
          analysis_request_id = ?,
          updated_at = ?
        WHERE id = ?
      `,
    ).run(
      extractedText,
      imageDescription,
      toJson(keyTerms),
      processedAt,
      analysis.model,
      analysis.requestId,
      processedAt,
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

    return {
      status: 'completed',
      model: analysis.model,
      requestId: analysis.requestId,
      usage: analysis.usage,
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'AI image analysis failed.'

    markAttachmentAsFailed(db, attachmentId, message)

    if (error instanceof AiServiceError) {
      throw error
    }

    throw new AiServiceError(message, {
      status: 502,
      code: 'ai_upstream_error',
    })
  }
}
