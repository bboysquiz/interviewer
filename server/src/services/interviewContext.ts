import type { SqliteDatabase } from '../db.js'
import { OPENAI_INTERVIEW_CONTEXT_MAX_CHARS } from '../config.js'
import { parseStringArray } from '../lib/json.js'
import {
  parseNoteContentBlocks,
  type NoteImageContentBlock,
} from '../lib/noteContent.js'
import { makeExcerpt } from '../lib/text.js'
import { splitTextIntoChunks } from '../lib/chunks.js'

import type { AiInterviewSourceType } from './ai/dto.js'
import { AiServiceError } from './ai/errors.js'

interface CategoryRow {
  id: string
  name: string
}

interface NoteRow {
  id: string
  category_id: string
  category_name: string
  title: string
  content: string
  content_json: string | null
  updated_at: string
}

interface AttachmentRow {
  id: string
  note_id: string
  original_file_name: string
  storage_path: string
  extracted_text: string | null
  image_description: string | null
  key_terms_json: string
}

type InterviewFragmentSource =
  | 'note_title'
  | 'note_content'
  | 'attachment_extracted_text'
  | 'attachment_description'

interface ContextFragment {
  note_id: string
  category_id: string
  note_title: string
  source: InterviewFragmentSource
  content: string
  attachment_id: string | null
  foundation_key: string
}

interface ResolveInterviewContextInput {
  sourceType: AiInterviewSourceType
  categoryId: string | null
  noteIds: string[]
  preferredTitle: string | null
}

export interface InterviewKnowledgeBaseContext {
  sourceType: AiInterviewSourceType
  title: string
  categoryId: string | null
  categoryName: string | null
  noteIds: string[]
  noteTitles: string[]
  noteCount: number
  chunkCount: number
  contextText: string
  sources: InterviewKnowledgeSource[]
}

export interface InterviewKnowledgeSource {
  foundationKey: string
  noteId: string
  categoryId: string
  noteTitle: string
  sourceType: InterviewFragmentSource
  sourceLabel: string
  excerpt: string
  content: string
  attachmentId: string | null
  attachmentStoragePath: string | null
  attachmentOriginalFileName: string | null
  lastQuestionedAt: string | null
}

export interface InterviewFoundationUsageRecord {
  foundationKey: string
  lastUsedAt: string
  useCount: number
}

const tokenizeForQuestionMatching = (value: string): string[] =>
  [
    ...new Set(
      value
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
        .split(/\s+/)
        .map((token) => token.trim())
        .filter((token) => token.length >= 3),
    ),
  ]

const uniqueNonEmpty = (value: string[]): string[] =>
  [...new Set(value.map((item) => item.trim()).filter(Boolean))]

const sourceLabels: Record<InterviewFragmentSource, string> = {
  note_title: 'Note title',
  note_content: 'Note text',
  attachment_extracted_text: 'Screenshot extracted text',
  attachment_description: 'Screenshot summary',
}

const buildListPlaceholders = (length: number): string =>
  Array.from({ length }, () => '?').join(', ')

const deriveContextTitle = (
  preferredTitle: string | null,
  sourceType: AiInterviewSourceType,
  categoryName: string | null,
  notes: NoteRow[],
): string => {
  if (preferredTitle?.trim()) {
    return preferredTitle.trim()
  }

  if (sourceType === 'note' && notes[0]) {
    return notes[0].title
  }

  if (sourceType === 'category' && categoryName) {
    return `${categoryName} interview practice`
  }

  if (notes.length === 1) {
    return notes[0].title
  }

  if (notes.length > 1) {
    return `Selected notes: ${notes
      .slice(0, 2)
      .map((note) => note.title)
      .join(', ')}`
  }

  return 'Interview practice'
}

const splitFragmentContent = (
  noteId: string,
  categoryId: string,
  noteTitle: string,
  source: InterviewFragmentSource,
  content: string,
  foundationKey: string,
  attachmentId: string | null = null,
): ContextFragment[] =>
  splitTextIntoChunks(content).map((chunk) => ({
    note_id: noteId,
    category_id: categoryId,
    note_title: noteTitle,
    source,
    content: chunk.content,
    attachment_id: attachmentId,
    foundation_key: attachmentId ? foundationKey : `${foundationKey}:${chunk.chunkIndex}`,
  }))

const buildScreenshotFragments = (
  note: NoteRow,
  block: NoteImageContentBlock,
  attachmentsById: Map<string, AttachmentRow>,
): ContextFragment[] => {
  const attachment = attachmentsById.get(block.attachmentId)

  if (!attachment) {
    return []
  }

  const fragments: ContextFragment[] = []
  const keyTerms = parseStringArray(attachment.key_terms_json)
  const fileNamePrefix = attachment.original_file_name
    ? `Screenshot file: ${attachment.original_file_name}\n`
    : ''

  if (attachment.extracted_text?.trim()) {
    fragments.push(
      ...splitFragmentContent(
        note.id,
        note.category_id,
        note.title,
        'attachment_extracted_text',
        `${fileNamePrefix}Visible text:\n${attachment.extracted_text}`,
        `attachment:${attachment.id}`,
        attachment.id,
      ),
    )
  }

  const summaryParts = [
    attachment.image_description?.trim() || null,
    keyTerms.length > 0 ? `Key terms: ${keyTerms.join(', ')}` : null,
  ].filter(Boolean)

  if (summaryParts.length > 0) {
    fragments.push(
      ...splitFragmentContent(
        note.id,
        note.category_id,
        note.title,
        'attachment_description',
        `${fileNamePrefix}${summaryParts.join('\n')}`,
        `attachment:${attachment.id}`,
        attachment.id,
      ),
    )
  }

  return fragments
}

const buildNoteFragments = (
  note: NoteRow,
  attachmentsById: Map<string, AttachmentRow>,
): ContextFragment[] => {
  const noteAttachments = [...attachmentsById.values()]
    .filter((attachment) => attachment.note_id === note.id)
    .map((attachment) => attachment.id)
  const contentBlocks = parseNoteContentBlocks(
    note.content_json,
    note.content,
    noteAttachments,
  )
  const fragments: ContextFragment[] = [
    {
      note_id: note.id,
      category_id: note.category_id,
      note_title: note.title,
      source: 'note_title',
      content: note.title,
      attachment_id: null,
      foundation_key: `title:${note.id}`,
    },
  ]

  for (const block of contentBlocks) {
    if (block.type === 'text') {
      fragments.push(
        ...splitFragmentContent(
          note.id,
          note.category_id,
          note.title,
          'note_content',
          block.text,
          `text:${note.id}:${block.id}`,
        ),
      )
      continue
    }

    fragments.push(...buildScreenshotFragments(note, block, attachmentsById))
  }

  return fragments
}

const interleaveFragmentsByNote = (groups: ContextFragment[][]): ContextFragment[] => {
  const maxLength = groups.reduce(
    (currentMax, group) => Math.max(currentMax, group.length),
    0,
  )
  const ordered: ContextFragment[] = []

  for (let index = 0; index < maxLength; index += 1) {
    for (const group of groups) {
      if (group[index]) {
        ordered.push(group[index])
      }
    }
  }

  return ordered
}

const buildContextPayload = (
  sourceType: AiInterviewSourceType,
  title: string,
  categoryName: string | null,
  notes: NoteRow[],
  fragments: ContextFragment[],
): { contextText: string; usedFragments: ContextFragment[] } => {
  const header = [
    `Session title: ${title}`,
    `Source type: ${sourceType}`,
    categoryName ? `Category: ${categoryName}` : null,
    notes.length > 0
      ? `Notes: ${notes.map((note) => note.title).join(', ')}`
      : null,
  ]
    .filter(Boolean)
    .join('\n')

  const sections: string[] = [header]
  let usedChars = header.length
  const usedFragments: ContextFragment[] = []

  for (const fragment of fragments) {
    const section = [
      `Note: ${fragment.note_title}`,
      `Source: ${sourceLabels[fragment.source]}`,
      fragment.content,
    ].join('\n')

    if (
      sections.length > 1 &&
      usedChars + section.length + 2 > OPENAI_INTERVIEW_CONTEXT_MAX_CHARS
    ) {
      break
    }

    sections.push(section)
    usedChars += section.length + 2
    usedFragments.push(fragment)
  }

  return {
    contextText: sections.join('\n\n'),
    usedFragments,
  }
}

const buildKnowledgeSources = (
  fragments: ContextFragment[],
  attachmentsById: Map<string, AttachmentRow>,
): InterviewKnowledgeSource[] => {
  const sources: InterviewKnowledgeSource[] = []
  const seen = new Set<string>()

  for (const fragment of fragments) {
    const excerpt = makeExcerpt(fragment.content, 120)
    const key = `${fragment.foundation_key}:${fragment.source}:${excerpt}`

    if (seen.has(key)) {
      continue
    }

    seen.add(key)
    const attachment = fragment.attachment_id
      ? (attachmentsById.get(fragment.attachment_id) ?? null)
      : null
    sources.push({
      foundationKey: fragment.foundation_key,
      noteId: fragment.note_id,
      categoryId: fragment.category_id,
      noteTitle: fragment.note_title,
      sourceType: fragment.source,
      sourceLabel: sourceLabels[fragment.source],
      excerpt,
      content: fragment.content,
      attachmentId: fragment.attachment_id,
      attachmentStoragePath: attachment?.storage_path ?? null,
      attachmentOriginalFileName: attachment?.original_file_name ?? null,
      lastQuestionedAt: null,
    })
  }

  return sources
}

const sourceTypePriority: Record<InterviewFragmentSource, number> = {
  attachment_extracted_text: 4,
  note_content: 3,
  attachment_description: 2,
  note_title: 1,
}

export const selectRelevantInterviewSources = (
  sources: InterviewKnowledgeSource[],
  question: string,
): InterviewKnowledgeSource[] => {
  const questionTokens = tokenizeForQuestionMatching(question)

  if (questionTokens.length === 0) {
    return sources
      .filter((source) => source.sourceType !== 'note_title')
      .slice(0, 4)
  }

  const scoredSources = sources
    .map((source) => {
      const sourceTokens = tokenizeForQuestionMatching(
        `${source.content}\n${source.excerpt}`,
      )
      const overlap = questionTokens.filter((token) =>
        sourceTokens.includes(token),
      ).length

      return {
        source,
        score:
          overlap * 10 +
          sourceTypePriority[source.sourceType] +
          Math.min(source.excerpt.length / 200, 1),
      }
    })
    .sort((left, right) => right.score - left.score)

  const relevantSources = scoredSources
    .filter((entry) => entry.score > 0)
    .map((entry) => entry.source)

  if (relevantSources.length > 0) {
    return relevantSources.slice(0, 4)
  }

  return sources
    .filter((source) => source.sourceType !== 'note_title')
    .slice(0, 4)
}

export const pickInterviewSourcesByIndexes = (
  sources: InterviewKnowledgeSource[],
  sourceIndexes: number[],
): InterviewKnowledgeSource[] => {
  if (sourceIndexes.length === 0) {
    return []
  }

  return [...new Map(
    sourceIndexes
      .map((index) => sources[index - 1] ?? null)
      .filter((source): source is InterviewKnowledgeSource => source !== null)
      .map((source) => [
        `${source.noteId}:${source.sourceType}:${source.attachmentId ?? source.excerpt}`,
        source,
      ]),
  ).values()]
}

export const applyFoundationUsageToSources = (
  sources: InterviewKnowledgeSource[],
  usageRecords: Map<string, InterviewFoundationUsageRecord>,
): InterviewKnowledgeSource[] =>
  sources.map((source) => {
    const usageRecord = usageRecords.get(source.foundationKey) ?? null

    return {
      ...source,
      lastQuestionedAt: usageRecord?.lastUsedAt ?? null,
    }
  })

const getFoundationRecencyWeight = (
  lastQuestionedAt: string | null,
): number => {
  if (!lastQuestionedAt) {
    return 1.25
  }

  const parsedTimestamp = Date.parse(lastQuestionedAt)

  if (Number.isNaN(parsedTimestamp)) {
    return 1
  }

  const hoursSinceLastQuestion = Math.max(
    0,
    (Date.now() - parsedTimestamp) / (1000 * 60 * 60),
  )

  return Math.min(1.2, 0.18 + hoursSinceLastQuestion / 36)
}

const shuffleSources = (
  sources: InterviewKnowledgeSource[],
): InterviewKnowledgeSource[] => {
  const nextSources = [...sources]

  for (let index = nextSources.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1))
    const currentValue = nextSources[index]!
    nextSources[index] = nextSources[swapIndex]!
    nextSources[swapIndex] = currentValue
  }

  return nextSources
}

interface FoundationSourceGroup {
  foundationKey: string
  lastQuestionedAt: string | null
  sources: InterviewKnowledgeSource[]
}

export const selectQuestionGenerationSources = (
  sources: InterviewKnowledgeSource[],
): InterviewKnowledgeSource[] => {
  const candidateSources = sources.filter((source) => source.sourceType !== 'note_title')

  if (candidateSources.length <= 4) {
    return shuffleSources(candidateSources)
  }

  const sourceGroups = [...candidateSources.reduce((map, source) => {
    const existingGroup = map.get(source.foundationKey)

    if (existingGroup) {
      existingGroup.sources.push(source)
      return map
    }

    map.set(source.foundationKey, {
      foundationKey: source.foundationKey,
      lastQuestionedAt: source.lastQuestionedAt,
      sources: [source],
    })
    return map
  }, new Map<string, FoundationSourceGroup>()).values()]

  const targetGroupCount = Math.min(4, sourceGroups.length)
  const availableGroups = [...sourceGroups]
  const selectedGroups: FoundationSourceGroup[] = []

  while (availableGroups.length > 0 && selectedGroups.length < targetGroupCount) {
    const totalWeight = availableGroups.reduce(
      (sum, group) => sum + getFoundationRecencyWeight(group.lastQuestionedAt),
      0,
    )

    if (totalWeight <= 0) {
      const randomIndex = Math.floor(Math.random() * availableGroups.length)
      selectedGroups.push(availableGroups.splice(randomIndex, 1)[0]!)
      continue
    }

    let threshold = Math.random() * totalWeight
    let selectedIndex = 0

    for (let index = 0; index < availableGroups.length; index += 1) {
      threshold -= getFoundationRecencyWeight(
        availableGroups[index]!.lastQuestionedAt,
      )

      if (threshold <= 0) {
        selectedIndex = index
        break
      }
    }

    selectedGroups.push(availableGroups.splice(selectedIndex, 1)[0]!)
  }

  return shuffleSources(
    selectedGroups.flatMap((group) => group.sources),
  )
}

export const buildKnowledgeBaseContextFromSources = (
  context: InterviewKnowledgeBaseContext,
  sources: InterviewKnowledgeSource[],
): string => {
  const header = [
    `Session title: ${context.title}`,
    `Source type: ${context.sourceType}`,
    context.categoryName ? `Category: ${context.categoryName}` : null,
    context.noteTitles.length > 0
      ? `Notes: ${context.noteTitles.join(', ')}`
      : null,
  ]
    .filter(Boolean)
    .join('\n')

  const sections = sources.map((source) =>
    [
      `Note: ${source.noteTitle}`,
      `Source: ${source.sourceLabel}`,
      source.content,
    ].join('\n'),
  )

  return [header, ...sections].join('\n\n')
}

export const resolveInterviewKnowledgeBaseContext = (
  db: SqliteDatabase,
  input: ResolveInterviewContextInput,
): InterviewKnowledgeBaseContext => {
  const requestedNoteIds = uniqueNonEmpty(input.noteIds)
  const categoryStatement = db.prepare(
    `
      SELECT id, name
      FROM categories
      WHERE id = ?
      LIMIT 1
    `,
  )
  const notesByCategoryStatement = db.prepare(
    `
      SELECT
        n.id,
        n.category_id,
        c.name AS category_name,
        n.title,
        n.content,
        n.content_json,
        n.updated_at
      FROM notes n
      INNER JOIN categories c ON c.id = n.category_id
      WHERE n.category_id = ?
      ORDER BY n.updated_at DESC, n.created_at DESC
      LIMIT 24
    `,
  )

  const category = input.categoryId
    ? ((categoryStatement.get(input.categoryId) as CategoryRow | undefined) ??
      null)
    : null

  if (input.categoryId && !category) {
    throw new AiServiceError(`Category "${input.categoryId}" was not found.`, {
      status: 404,
      code: 'ai_not_found',
    })
  }

  let notes: NoteRow[] = []

  if (requestedNoteIds.length > 0) {
    const placeholders = buildListPlaceholders(requestedNoteIds.length)
    const notesByIdsStatement = db.prepare(
      `
        SELECT
          n.id,
          n.category_id,
          c.name AS category_name,
          n.title,
          n.content,
          n.content_json,
          n.updated_at
        FROM notes n
        INNER JOIN categories c ON c.id = n.category_id
        WHERE n.id IN (${placeholders})
        ORDER BY n.updated_at DESC, n.created_at DESC
      `,
    )

    notes = notesByIdsStatement.all(...requestedNoteIds) as NoteRow[]

    if (notes.length !== requestedNoteIds.length) {
      throw new AiServiceError(
        'One or more notes for interview context were not found.',
        {
          status: 404,
          code: 'ai_not_found',
        },
      )
    }
  } else if (input.categoryId) {
    notes = notesByCategoryStatement.all(input.categoryId) as NoteRow[]
  }

  if (notes.length === 0) {
    throw new AiServiceError(
      'No notes were found for the selected interview source.',
      {
        status: 404,
        code: 'ai_not_found',
      },
    )
  }

  if (input.categoryId) {
    const hasCrossCategoryNote = notes.some(
      (note) => note.category_id !== input.categoryId,
    )

    if (hasCrossCategoryNote) {
      throw new AiServiceError(
        'Selected notes do not belong to the requested category.',
        {
          status: 400,
          code: 'ai_validation_error',
        },
      )
    }
  }

  if (input.sourceType === 'note' && notes.length !== 1) {
    throw new AiServiceError(
      'Source type "note" requires exactly one note.',
      {
        status: 400,
        code: 'ai_validation_error',
      },
    )
  }

  const inferredCategoryId =
    input.categoryId ??
    (notes.every((note) => note.category_id === notes[0].category_id)
      ? notes[0].category_id
      : null)
  const inferredCategoryName =
    category?.name ??
    (notes.every((note) => note.category_name === notes[0].category_name)
      ? notes[0].category_name
      : null)

  const notePlaceholders = buildListPlaceholders(notes.length)
  const attachmentsStatement = db.prepare(
    `
      SELECT
        id,
        note_id,
        original_file_name,
        storage_path,
        extracted_text,
        image_description,
        key_terms_json
      FROM attachments
      WHERE note_id IN (${notePlaceholders})
      ORDER BY created_at ASC
    `,
  )
  const attachmentRows = attachmentsStatement.all(
    ...notes.map((note) => note.id),
  ) as AttachmentRow[]
  const attachmentsById = new Map(
    attachmentRows.map((attachment) => [attachment.id, attachment]),
  )
  const fragmentGroups = notes.map((note) => buildNoteFragments(note, attachmentsById))
  const fragments = interleaveFragmentsByNote(fragmentGroups).filter(
    (fragment) => fragment.content.trim().length > 0,
  )

  if (fragments.length === 0) {
    throw new AiServiceError(
      'No searchable knowledge fragments were found for the selected notes.',
      {
        status: 404,
        code: 'ai_not_found',
      },
    )
  }

  const title = deriveContextTitle(
    input.preferredTitle,
    input.sourceType,
    inferredCategoryName,
    notes,
  )
  const contextPayload = buildContextPayload(
    input.sourceType,
    title,
    inferredCategoryName,
    notes,
    fragments,
  )
  const sources = buildKnowledgeSources(
    contextPayload.usedFragments,
    attachmentsById,
  )

  return {
    sourceType: input.sourceType,
    title,
    categoryId: inferredCategoryId,
    categoryName: inferredCategoryName,
    noteIds: notes.map((note) => note.id),
    noteTitles: notes.map((note) => note.title),
    noteCount: notes.length,
    chunkCount: contextPayload.usedFragments.length,
    contextText: contextPayload.contextText,
    sources,
  }
}
