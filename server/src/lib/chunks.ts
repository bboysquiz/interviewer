import type Database from 'better-sqlite3'

import { createId, makeExcerpt, nowIso } from './text.js'

const NOTE_CHUNK_TARGET_LENGTH = 900
const NOTE_CHUNK_MIN_LENGTH = 280
const NOTE_CHUNK_MAX_LENGTH = 1100

interface SplitChunk {
  chunkIndex: number
  content: string
  startOffset: number
  endOffset: number
}

const normalizeChunkInput = (value: string): string =>
  value
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

const toSearchText = (value: string): string =>
  value.replace(/\s+/g, ' ').trim()

const findBoundaryBefore = (
  value: string,
  boundary: string,
  fromIndex: number,
  minIndex: number,
): number | null => {
  const index = value.lastIndexOf(boundary, fromIndex)
  return index >= minIndex ? index : null
}

const findBoundaryAfter = (
  value: string,
  boundary: string,
  fromIndex: number,
  maxIndex: number,
): number | null => {
  const index = value.indexOf(boundary, fromIndex)
  return index !== -1 && index <= maxIndex ? index : null
}

const findChunkEnd = (value: string, startOffset: number): number => {
  const remainingLength = value.length - startOffset

  if (remainingLength <= NOTE_CHUNK_MAX_LENGTH) {
    return value.length
  }

  const minBoundary = Math.min(
    value.length,
    startOffset + NOTE_CHUNK_MIN_LENGTH,
  )
  const targetBoundary = Math.min(
    value.length,
    startOffset + NOTE_CHUNK_TARGET_LENGTH,
  )
  const maxBoundary = Math.min(
    value.length,
    startOffset + NOTE_CHUNK_MAX_LENGTH,
  )

  for (const boundary of ['\n\n', '\n', ' ']) {
    const backward = findBoundaryBefore(
      value,
      boundary,
      targetBoundary,
      minBoundary,
    )

    if (backward !== null) {
      return backward
    }

    const forward = findBoundaryAfter(
      value,
      boundary,
      targetBoundary,
      maxBoundary,
    )

    if (forward !== null) {
      return forward
    }
  }

  return maxBoundary
}

export const splitTextIntoChunks = (value: string): SplitChunk[] => {
  const normalized = normalizeChunkInput(value)

  if (!normalized) {
    return []
  }

  const chunks: SplitChunk[] = []
  let startOffset = 0
  let chunkIndex = 0

  while (startOffset < normalized.length) {
    const endOffset = findChunkEnd(normalized, startOffset)
    const rawChunk = normalized.slice(startOffset, endOffset)
    const leadingTrim = rawChunk.search(/\S/)
    const trimmedChunk = rawChunk.trim()

    if (trimmedChunk) {
      const safeLeadingTrim = leadingTrim >= 0 ? leadingTrim : 0
      const trailingTrimLength = rawChunk.length - rawChunk.trimEnd().length

      chunks.push({
        chunkIndex,
        content: trimmedChunk,
        startOffset: startOffset + safeLeadingTrim,
        endOffset: endOffset - trailingTrimLength,
      })
      chunkIndex += 1
    }

    startOffset = endOffset

    while (
      startOffset < normalized.length &&
      /\s/.test(normalized[startOffset])
    ) {
      startOffset += 1
    }
  }

  return chunks
}

type SqliteDatabase = Database.Database

interface NoteChunkPayload {
  noteId: string
  categoryId: string
  title: string
  content: string
}

interface AttachmentChunkPayload {
  attachmentId: string
  noteId: string
  categoryId: string
  extractedText: string | null
  imageDescription: string | null
  keyTerms?: string[]
}

export const replaceNoteContentChunks = (
  db: SqliteDatabase,
  payload: NoteChunkPayload,
): void => {
  const deleteStatement = db.prepare(
    `
      DELETE FROM note_chunks
      WHERE note_id = ?
        AND attachment_id IS NULL
    `,
  )

  const insertStatement = db.prepare(
    `
      INSERT INTO note_chunks (
        id,
        note_id,
        category_id,
        attachment_id,
        source,
        chunk_index,
        content,
        summary,
        search_text,
        start_offset,
        end_offset,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  )

  const transaction = db.transaction(() => {
    deleteStatement.run(payload.noteId)

    const timestamp = nowIso()

    const normalizedTitle = payload.title.trim()

    if (normalizedTitle) {
      insertStatement.run(
        createId(),
        payload.noteId,
        payload.categoryId,
        'note_title',
        0,
        normalizedTitle,
        normalizedTitle,
        toSearchText(normalizedTitle),
        0,
        normalizedTitle.length,
        timestamp,
        timestamp,
      )
    }

    for (const chunk of splitTextIntoChunks(payload.content)) {
      insertStatement.run(
        createId(),
        payload.noteId,
        payload.categoryId,
        'note_content',
        chunk.chunkIndex + 1,
        chunk.content,
        makeExcerpt(chunk.content, 120),
        toSearchText(chunk.content),
        chunk.startOffset,
        chunk.endOffset,
        timestamp,
        timestamp,
      )
    }
  })

  transaction()
}

export const replaceAttachmentChunks = (
  db: SqliteDatabase,
  payload: AttachmentChunkPayload,
): void => {
  const deleteStatement = db.prepare(
    `
      DELETE FROM note_chunks
      WHERE attachment_id = ?
    `,
  )

  const insertStatement = db.prepare(
    `
      INSERT INTO note_chunks (
        id,
        note_id,
        category_id,
        attachment_id,
        source,
        chunk_index,
        content,
        summary,
        search_text,
        start_offset,
        end_offset,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  )

  const keyTermsText = payload.keyTerms?.filter(Boolean).join(' ') ?? ''

  const insertChunks = (
    source: 'attachment_extracted_text' | 'attachment_description',
    value: string | null,
    searchText: string | null,
    timestamp: string,
  ): void => {
    if (!value || !value.trim()) {
      return
    }

    for (const chunk of splitTextIntoChunks(value)) {
      const normalizedSearchText = toSearchText(chunk.content)
      insertStatement.run(
        createId(),
        payload.noteId,
        payload.categoryId,
        payload.attachmentId,
        source,
        chunk.chunkIndex,
        chunk.content,
        makeExcerpt(chunk.content, 120),
        searchText && searchText.trim().length > 0
          ? `${normalizedSearchText} ${toSearchText(searchText)}`.trim()
          : normalizedSearchText,
        chunk.startOffset,
        chunk.endOffset,
        timestamp,
        timestamp,
      )
    }
  }

  const transaction = db.transaction(() => {
    deleteStatement.run(payload.attachmentId)

    const timestamp = nowIso()
    insertChunks(
      'attachment_extracted_text',
      payload.extractedText,
      keyTermsText,
      timestamp,
    )
    insertChunks(
      'attachment_description',
      payload.imageDescription ?? (keyTermsText || null),
      keyTermsText,
      timestamp,
    )
  })

  transaction()
}
