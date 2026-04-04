import type { NoteContentBlock } from '../lib/noteContent.js'
import { createId } from '../lib/text.js'

import type {
  OrganizeKnowledgeBaseNoteInput,
  OrganizeKnowledgeBaseNoteResult,
} from './ai/dto.js'
import { AiServiceError } from './ai/errors.js'
import { organizeKnowledgeBaseNote } from './ai/openAiService.js'

const SECTION_DIVIDER = '___________________________________'
const GENERATED_SECTION_HEADING_PATTERN =
  /^\s*[^\n]{1,120}\n_{10,}\s*$/u

interface NoteOrganizationAttachmentContext {
  id: string
  originalFileName: string | null
  extractedText: string | null
  imageDescription: string | null
}

interface OrganizeExistingNoteInput {
  categoryName?: string | null
  noteTitle?: string | null
  blocks: NoteContentBlock[]
  attachmentsById: Record<string, NoteOrganizationAttachmentContext>
}

export interface OrganizeExistingNoteResult
  extends OrganizeKnowledgeBaseNoteResult {
  contentBlocks: NoteContentBlock[]
  sectionCount: number
}

const uniqueIndexes = (indexes: number[]): number[] => [...new Set(indexes)]

const normalizeSectionTitle = (value: string): string => {
  const normalized = value.trim()

  if (!normalized) {
    return 'Раздел'
  }

  return normalized.slice(0, 80)
}

const createSectionHeadingBlock = (title: string): NoteContentBlock => ({
  id: createId(),
  type: 'text',
  text: `${normalizeSectionTitle(title)}\n${SECTION_DIVIDER}`,
})

const isGeneratedSectionHeadingBlock = (block: NoteContentBlock): boolean =>
  block.type === 'text' &&
  GENERATED_SECTION_HEADING_PATTERN.test(block.text.trim())

const stripGeneratedSectionHeadingBlocks = (
  blocks: NoteContentBlock[],
): NoteContentBlock[] => blocks.filter((block) => !isGeneratedSectionHeadingBlock(block))

const buildOrganizationInput = (
  input: OrganizeExistingNoteInput,
  blocks: NoteContentBlock[],
): OrganizeKnowledgeBaseNoteInput => ({
  categoryName: input.categoryName ?? null,
  noteTitle: input.noteTitle ?? null,
  blocks: blocks.map((block) => {
    if (block.type === 'text') {
      return {
        id: block.id,
        type: 'text',
        text: block.text,
      }
    }

    const attachment = input.attachmentsById[block.attachmentId]

    return {
      id: block.id,
      type: 'image',
      fileName: attachment?.originalFileName ?? null,
      extractedText: attachment?.extractedText ?? null,
      imageDescription: attachment?.imageDescription ?? null,
    }
  }),
})

const buildOrganizedContentBlocks = (
  blocks: NoteContentBlock[],
  organization: OrganizeKnowledgeBaseNoteResult,
): { contentBlocks: NoteContentBlock[]; sectionCount: number } => {
  const sourceBlocksByIndex = new Map(
    blocks.map((block, index) => [index + 1, block] as const),
  )
  const organizedBlocks: NoteContentBlock[] = []
  const usedIndexes = new Set<number>()
  let sectionCount = 0

  for (const section of organization.sections) {
    const validIndexes = uniqueIndexes(section.blockIndexes).filter((index) => {
      if (usedIndexes.has(index)) {
        return false
      }

      return sourceBlocksByIndex.has(index)
    })

    if (validIndexes.length === 0) {
      continue
    }

    organizedBlocks.push(createSectionHeadingBlock(section.title))

    for (const index of validIndexes) {
      usedIndexes.add(index)
      organizedBlocks.push(sourceBlocksByIndex.get(index)!)
    }

    sectionCount += 1
  }

  const remainingBlocks = blocks.filter(
    (_block, index) => !usedIndexes.has(index + 1),
  )

  if (remainingBlocks.length > 0) {
    organizedBlocks.push(
      createSectionHeadingBlock(sectionCount > 0 ? 'Разное' : 'Материалы'),
    )
    organizedBlocks.push(...remainingBlocks)
    sectionCount += 1
  }

  if (organizedBlocks.length === 0) {
    organizedBlocks.push(createSectionHeadingBlock('Материалы'))
    organizedBlocks.push(...blocks)
    sectionCount = blocks.length > 0 ? 1 : 0
  }

  return {
    contentBlocks: organizedBlocks,
    sectionCount,
  }
}

export const reorganizeNoteContent = async (
  input: OrganizeExistingNoteInput,
): Promise<OrganizeExistingNoteResult> => {
  const sourceBlocks = stripGeneratedSectionHeadingBlocks(input.blocks)

  if (sourceBlocks.length === 0) {
    throw new AiServiceError('В теме пока нет содержимого для группировки.', {
      status: 400,
      code: 'ai_validation_error',
    })
  }

  const organization = await organizeKnowledgeBaseNote(
    buildOrganizationInput(input, sourceBlocks),
  )
  const organized = buildOrganizedContentBlocks(sourceBlocks, organization)

  return {
    ...organization,
    contentBlocks: organized.contentBlocks,
    sectionCount: organized.sectionCount,
  }
}
