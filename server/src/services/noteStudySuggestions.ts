import { parseStringArray } from '../lib/json.js'

import type {
  NoteStudySuggestionItem,
  SuggestNoteStudyTopicsResult,
} from './ai/dto.js'
import { AiServiceError } from './ai/errors.js'
import { suggestNoteStudyTopics } from './ai/openAiService.js'

interface NoteKnowledgeAttachment {
  originalFileName: string | null
  extractedText: string | null
  imageDescription: string | null
  keyTermsJson: string | null
}

export interface NoteKnowledgeSnapshot {
  noteId: string
  categoryId: string
  categoryName: string | null
  noteTitle: string
  rawText: string
  attachments: NoteKnowledgeAttachment[]
}

export interface BuildStudyTopicSuggestionsInput {
  targetNoteId: string
  excludedTopicTitles?: string[]
  notes: NoteKnowledgeSnapshot[]
}

const TARGET_TEXT_LIMIT = 3200
const TARGET_SCREENSHOT_LIMIT = 1800
const OTHER_NOTE_LIMIT = 520
const OTHER_NOTES_TOTAL_LIMIT = 7000
const MAX_ATTACHMENT_DIGESTS_PER_NOTE = 5
const MAX_OTHER_NOTES = 24

const normalizeWhitespace = (value: string | null | undefined): string =>
  (value ?? '').replace(/\s+/g, ' ').trim()

const truncate = (value: string, maxLength: number): string => {
  if (value.length <= maxLength) {
    return value
  }

  return `${value.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`
}

const normalizeTopicTitle = (value: string): string =>
  value.toLocaleLowerCase('ru').replace(/\s+/g, ' ').trim()

const collectAttachmentDigestLines = (
  attachments: NoteKnowledgeAttachment[],
  maxTotalChars: number,
): string[] => {
  const lines: string[] = []
  let consumed = 0

  for (const attachment of attachments.slice(0, MAX_ATTACHMENT_DIGESTS_PER_NOTE)) {
    const keyTerms = parseStringArray(attachment.keyTermsJson ?? '[]').slice(0, 6)
    const parts = [
      attachment.extractedText
        ? `OCR: ${truncate(normalizeWhitespace(attachment.extractedText), 220)}`
        : null,
      attachment.imageDescription
        ? `Описание: ${truncate(normalizeWhitespace(attachment.imageDescription), 180)}`
        : null,
      keyTerms.length > 0 ? `Ключевые слова: ${keyTerms.join(', ')}` : null,
      attachment.originalFileName ? `Файл: ${attachment.originalFileName}` : null,
    ].filter((value): value is string => Boolean(value))

    if (parts.length === 0) {
      continue
    }

    const line = `- ${parts.join(' | ')}`

    if (consumed + line.length > maxTotalChars) {
      break
    }

    lines.push(line)
    consumed += line.length
  }

  return lines
}

const buildTargetNoteDigest = (note: NoteKnowledgeSnapshot): string => {
  const textDigest = truncate(normalizeWhitespace(note.rawText), TARGET_TEXT_LIMIT)
  const attachmentLines = collectAttachmentDigestLines(
    note.attachments,
    TARGET_SCREENSHOT_LIMIT,
  )

  return [
    `Категория: ${note.categoryName ?? 'Без категории'}`,
    `Заметка: ${note.noteTitle}`,
    textDigest ? `Текст заметки:\n${textDigest}` : 'Текст заметки: нет',
    attachmentLines.length > 0
      ? `Скриншоты и AI-выжимка:\n${attachmentLines.join('\n')}`
      : 'Скриншоты и AI-выжимка: нет данных',
  ].join('\n\n')
}

const buildOtherNotesDigest = (
  notes: NoteKnowledgeSnapshot[],
  targetNoteId: string,
): string => {
  const lines: string[] = []
  let consumed = 0

  for (const note of notes) {
    if (note.noteId === targetNoteId) {
      continue
    }

    if (lines.length >= MAX_OTHER_NOTES) {
      break
    }

    const textDigest = truncate(normalizeWhitespace(note.rawText), 220)
    const attachmentLines = collectAttachmentDigestLines(note.attachments, 220)
    const combined = [
      `${note.categoryName ?? 'Без категории'} / ${note.noteTitle}`,
      textDigest ? `Текст: ${textDigest}` : null,
      attachmentLines.length > 0
        ? `Скриншоты: ${attachmentLines.join(' ')}`
        : null,
    ]
      .filter((value): value is string => Boolean(value))
      .join(' | ')

    const line = `- ${truncate(combined, OTHER_NOTE_LIMIT)}`

    if (consumed + line.length > OTHER_NOTES_TOTAL_LIMIT) {
      break
    }

    lines.push(line)
    consumed += line.length
  }

  return lines.join('\n')
}

const filterDuplicateSuggestions = (
  suggestions: NoteStudySuggestionItem[],
  excludedTopicTitles: string[],
): NoteStudySuggestionItem[] => {
  const blockedTitles = new Set(excludedTopicTitles.map(normalizeTopicTitle))
  const result: NoteStudySuggestionItem[] = []

  for (const suggestion of suggestions) {
    const normalizedTitle = normalizeTopicTitle(suggestion.title)

    if (!normalizedTitle || blockedTitles.has(normalizedTitle)) {
      continue
    }

    blockedTitles.add(normalizedTitle)
    result.push(suggestion)
  }

  return result
}

export const buildStudyTopicSuggestions = async (
  input: BuildStudyTopicSuggestionsInput,
): Promise<SuggestNoteStudyTopicsResult> => {
  const targetNote = input.notes.find((note) => note.noteId === input.targetNoteId)

  if (!targetNote) {
    throw new AiServiceError('Заметка для рекомендаций не найдена.', {
      status: 404,
      code: 'ai_not_found',
    })
  }

  const excludedTopicTitles = [
    ...new Set((input.excludedTopicTitles ?? []).map((title) => title.trim()).filter(Boolean)),
  ]

  const targetNoteDigest = buildTargetNoteDigest(targetNote)

  if (!normalizeWhitespace(targetNoteDigest)) {
    throw new AiServiceError(
      'Сначала добавь в заметку хотя бы немного текста или скриншотов, чтобы AI смог предложить новые темы.',
      {
        status: 400,
        code: 'ai_validation_error',
      },
    )
  }

  const result = await suggestNoteStudyTopics({
    targetCategoryName: targetNote.categoryName,
    targetNoteTitle: targetNote.noteTitle,
    targetNoteDigest,
    otherNotesDigest: buildOtherNotesDigest(input.notes, input.targetNoteId),
    excludedTopicTitles,
  })

  const filteredSuggestions = filterDuplicateSuggestions(
    result.suggestions,
    excludedTopicTitles,
  )

  if (filteredSuggestions.length === 0) {
    throw new AiServiceError(
      'Не удалось подобрать новые темы без повторов в рамках этой сессии. Попробуй ещё раз позже.',
      {
        status: 422,
        code: 'ai_invalid_response',
      },
    )
  }

  return {
    ...result,
    suggestions: filteredSuggestions,
  }
}
