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

interface DigestProfile {
  targetTextLimit: number
  targetScreenshotLimit: number
  otherNoteLimit: number
  otherNotesTotalLimit: number
  maxAttachmentDigestsPerNote: number
  maxOtherNotes: number
}

const TARGET_ADD_TOPICS = 7
const TARGET_DEEPEN_TOPICS = 3

const DIGEST_PROFILES: DigestProfile[] = [
  {
    targetTextLimit: 1_600,
    targetScreenshotLimit: 900,
    otherNoteLimit: 220,
    otherNotesTotalLimit: 2_200,
    maxAttachmentDigestsPerNote: 4,
    maxOtherNotes: 12,
  },
  {
    targetTextLimit: 1_000,
    targetScreenshotLimit: 560,
    otherNoteLimit: 150,
    otherNotesTotalLimit: 1_300,
    maxAttachmentDigestsPerNote: 3,
    maxOtherNotes: 8,
  },
  {
    targetTextLimit: 700,
    targetScreenshotLimit: 320,
    otherNoteLimit: 100,
    otherNotesTotalLimit: 750,
    maxAttachmentDigestsPerNote: 2,
    maxOtherNotes: 5,
  },
]

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

const buildAttachmentDigest = (attachment: NoteKnowledgeAttachment): string => {
  const keyTerms = parseStringArray(attachment.keyTermsJson ?? '[]')
    .slice(0, 5)
    .join(', ')

  return [
    attachment.extractedText
      ? `OCR: ${truncate(normalizeWhitespace(attachment.extractedText), 150)}`
      : null,
    attachment.imageDescription
      ? `Desc: ${truncate(normalizeWhitespace(attachment.imageDescription), 120)}`
      : null,
    keyTerms ? `Terms: ${keyTerms}` : null,
    attachment.originalFileName ? `File: ${attachment.originalFileName}` : null,
  ]
    .filter((current): current is string => Boolean(current))
    .join(' | ')
}

const collectAttachmentDigestLines = (
  attachments: NoteKnowledgeAttachment[],
  limits: Pick<DigestProfile, 'targetScreenshotLimit' | 'maxAttachmentDigestsPerNote'>,
): string[] => {
  const lines: string[] = []
  let consumed = 0

  for (const attachment of attachments.slice(0, limits.maxAttachmentDigestsPerNote)) {
    const line = buildAttachmentDigest(attachment)

    if (!line) {
      continue
    }

    const formattedLine = `- ${line}`

    if (consumed + formattedLine.length > limits.targetScreenshotLimit) {
      break
    }

    lines.push(formattedLine)
    consumed += formattedLine.length
  }

  return lines
}

const buildTargetNoteDigest = (
  note: NoteKnowledgeSnapshot,
  profile: DigestProfile,
): string => {
  const textDigest = truncate(normalizeWhitespace(note.rawText), profile.targetTextLimit)
  const attachmentLines = collectAttachmentDigestLines(note.attachments, profile)

  return [
    `Category: ${note.categoryName ?? 'Без категории'}`,
    `Note: ${note.noteTitle}`,
    textDigest ? `Text:\n${textDigest}` : 'Text: нет',
    attachmentLines.length > 0
      ? `Screenshots:\n${attachmentLines.join('\n')}`
      : 'Screenshots: нет AI-выжимки',
  ].join('\n\n')
}

const buildOtherNotesDigest = (
  notes: NoteKnowledgeSnapshot[],
  targetNoteId: string,
  profile: DigestProfile,
): string => {
  const lines: string[] = []
  let consumed = 0

  for (const note of notes) {
    if (note.noteId === targetNoteId) {
      continue
    }

    if (lines.length >= profile.maxOtherNotes) {
      break
    }

    const noteText = truncate(normalizeWhitespace(note.rawText), Math.floor(profile.otherNoteLimit * 0.6))
    const firstAttachmentDigest = note.attachments
      .map((attachment) => buildAttachmentDigest(attachment))
      .find(Boolean)

    const combined = truncate(
      [
        `${note.categoryName ?? 'Без категории'} / ${note.noteTitle}`,
        noteText ? `Text: ${noteText}` : null,
        firstAttachmentDigest
          ? `Screenshot: ${truncate(firstAttachmentDigest, Math.floor(profile.otherNoteLimit * 0.45))}`
          : null,
      ]
        .filter((current): current is string => Boolean(current))
        .join(' | '),
      profile.otherNoteLimit,
    )

    const line = `- ${combined}`

    if (consumed + line.length > profile.otherNotesTotalLimit) {
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

const hasMeaningfulKnowledge = (note: NoteKnowledgeSnapshot): boolean => {
  if (normalizeWhitespace(note.rawText)) {
    return true
  }

  return note.attachments.some((attachment) =>
    Boolean(
      normalizeWhitespace(attachment.extractedText) ||
        normalizeWhitespace(attachment.imageDescription) ||
        parseStringArray(attachment.keyTermsJson ?? '[]').length > 0,
    ),
  )
}

const buildIncompleteSuggestionsError = (
  addCount: number,
  deepenCount: number,
): AiServiceError =>
  new AiServiceError(
    `ИИ не смог собрать полный топ-10 тем. Сейчас получилось ${addCount} на добавление и ${deepenCount} на углубление. Попробуй ещё раз чуть позже.`,
    {
      status: 422,
      code: 'ai_invalid_response',
      details: {
        addCount,
        deepenCount,
      },
    },
  )

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

  if (!hasMeaningfulKnowledge(targetNote)) {
    throw new AiServiceError(
      'Сначала добавь в заметку текст или проанализированные скриншоты, чтобы ИИ смог предложить новые темы.',
      {
        status: 400,
        code: 'ai_validation_error',
      },
    )
  }

  const excludedTopicTitles = [
    ...new Set(
      (input.excludedTopicTitles ?? [])
        .map((title) => title.trim())
        .filter(Boolean),
    ),
  ]

  const blockedTitles = new Set(
    excludedTopicTitles.map((title) => normalizeTopicTitle(title)),
  )

  let topicsToAdd: NoteStudySuggestionItem[] = []
  let topicsToDeepen: NoteStudySuggestionItem[] = []
  let model = ''
  let requestId: string | null = null
  let usage: SuggestNoteStudyTopicsResult['usage'] = null
  let lastAiError: AiServiceError | null = null

  for (const profile of DIGEST_PROFILES) {
    const dynamicExcludedTopicTitles = [
      ...excludedTopicTitles,
      ...topicsToAdd.map((suggestion) => suggestion.title),
      ...topicsToDeepen.map((suggestion) => suggestion.title),
    ]

    try {
      const result = await suggestNoteStudyTopics({
        targetCategoryName: targetNote.categoryName,
        targetNoteTitle: targetNote.noteTitle,
        targetNoteDigest: buildTargetNoteDigest(targetNote, profile),
        otherNotesDigest: buildOtherNotesDigest(input.notes, input.targetNoteId, profile),
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
        return {
          suggestions: [...topicsToAdd, ...topicsToDeepen],
          model,
          requestId,
          usage,
        }
      }
    } catch (error) {
      if (error instanceof AiServiceError) {
        lastAiError = error
        continue
      }

      throw error
    }
  }

  if (topicsToAdd.length > 0 || topicsToDeepen.length > 0) {
    throw buildIncompleteSuggestionsError(topicsToAdd.length, topicsToDeepen.length)
  }

  if (lastAiError) {
    throw lastAiError
  }

  throw buildIncompleteSuggestionsError(topicsToAdd.length, topicsToDeepen.length)
}
