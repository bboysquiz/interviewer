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
const TARGET_ADD_TOPICS = 7
const TARGET_DEEPEN_TOPICS = 3
const MAX_SUGGESTION_ATTEMPTS = 3

const normalizeWhitespace = (value: string | null | undefined): string =>
  (value ?? '').replace(/\s+/g, ' ').trim()

const truncate = (value: string, maxLength: number): string => {
  if (value.length <= maxLength) {
    return value
  }

  return `${value.slice(0, Math.max(1, maxLength - 3)).trimEnd()}...`
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

const mergeUsage = (
  left: SuggestNoteStudyTopicsResult['usage'],
  right: SuggestNoteStudyTopicsResult['usage'],
): SuggestNoteStudyTopicsResult['usage'] => {
  const sum = (
    first: number | null | undefined,
    second: number | null | undefined,
  ): number => (first ?? 0) + (second ?? 0)

  if (!left && !right) {
    return null
  }

  return {
    inputTokens: sum(left?.inputTokens, right?.inputTokens),
    outputTokens: sum(left?.outputTokens, right?.outputTokens),
    totalTokens: sum(left?.totalTokens, right?.totalTokens),
  }
}

const appendUniqueSuggestions = (
  current: NoteStudySuggestionItem[],
  incoming: NoteStudySuggestionItem[],
  blockedTitles: Set<string>,
  maxItems: number,
): NoteStudySuggestionItem[] => {
  if (current.length >= maxItems) {
    return current
  }

  const next = [...current]
  const seenTitles = new Set([
    ...blockedTitles,
    ...current.map((suggestion) => normalizeTopicTitle(suggestion.title)),
  ])

  for (const suggestion of incoming) {
    const normalizedTitle = normalizeTopicTitle(suggestion.title)

    if (!normalizedTitle || seenTitles.has(normalizedTitle)) {
      continue
    }

    next.push(suggestion)
    seenTitles.add(normalizedTitle)

    if (next.length >= maxItems) {
      break
    }
  }

  return next
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
    ...new Set(
      (input.excludedTopicTitles ?? [])
        .map((title) => title.trim())
        .filter(Boolean),
    ),
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

  const blockedTitles = new Set(
    excludedTopicTitles.map((title) => normalizeTopicTitle(title)),
  )
  const otherNotesDigest = buildOtherNotesDigest(input.notes, input.targetNoteId)
  let topicsToAdd: NoteStudySuggestionItem[] = []
  let topicsToDeepen: NoteStudySuggestionItem[] = []
  let model = ''
  let requestId: string | null = null
  let usage: SuggestNoteStudyTopicsResult['usage'] = null

  for (let attempt = 0; attempt < MAX_SUGGESTION_ATTEMPTS; attempt += 1) {
    const dynamicExcludedTopicTitles = [
      ...excludedTopicTitles,
      ...topicsToAdd.map((suggestion) => suggestion.title),
      ...topicsToDeepen.map((suggestion) => suggestion.title),
    ]

    const result = await suggestNoteStudyTopics({
      targetCategoryName: targetNote.categoryName,
      targetNoteTitle: targetNote.noteTitle,
      targetNoteDigest,
      otherNotesDigest,
      excludedTopicTitles: dynamicExcludedTopicTitles,
    })

    model = result.model
    requestId = result.requestId
    usage = mergeUsage(usage, result.usage)

    const filteredSuggestions = filterDuplicateSuggestions(
      result.suggestions,
      dynamicExcludedTopicTitles,
    )

    topicsToAdd = appendUniqueSuggestions(
      topicsToAdd,
      filteredSuggestions.filter((suggestion) => suggestion.kind === 'add'),
      blockedTitles,
      TARGET_ADD_TOPICS,
    )
    topicsToDeepen = appendUniqueSuggestions(
      topicsToDeepen,
      filteredSuggestions.filter((suggestion) => suggestion.kind === 'deepen'),
      blockedTitles,
      TARGET_DEEPEN_TOPICS,
    )

    if (
      topicsToAdd.length >= TARGET_ADD_TOPICS &&
      topicsToDeepen.length >= TARGET_DEEPEN_TOPICS
    ) {
      break
    }
  }

  const suggestions = [...topicsToAdd, ...topicsToDeepen]

  if (suggestions.length === 0) {
    throw new AiServiceError(
      'Не удалось подобрать новые темы без повторов в рамках этой сессии. Попробуй ещё раз позже.',
      {
        status: 422,
        code: 'ai_invalid_response',
      },
    )
  }

  return {
    model,
    requestId,
    usage,
    suggestions,
  }
}
