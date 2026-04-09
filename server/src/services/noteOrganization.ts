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

interface OrganizationBudgetProfile {
  totalChars: number
  minBlockChars: number
  maxTextBlockChars: number
  maxImageTextChars: number
  maxImageDescriptionChars: number
}

interface HeuristicCluster {
  title: string
  firstIndex: number
  blockIndexes: number[]
  keywordWeights: Map<string, number>
}

const DEFAULT_ORGANIZATION_BUDGET: OrganizationBudgetProfile = {
  totalChars: 5200,
  minBlockChars: 48,
  maxTextBlockChars: 160,
  maxImageTextChars: 96,
  maxImageDescriptionChars: 72,
}

const COMPACT_ORGANIZATION_BUDGET: OrganizationBudgetProfile = {
  totalChars: 3200,
  minBlockChars: 28,
  maxTextBlockChars: 96,
  maxImageTextChars: 56,
  maxImageDescriptionChars: 40,
}

const ULTRA_COMPACT_ORGANIZATION_BUDGET: OrganizationBudgetProfile = {
  totalChars: 1900,
  minBlockChars: 20,
  maxTextBlockChars: 64,
  maxImageTextChars: 36,
  maxImageDescriptionChars: 28,
}

const HEURISTIC_STOP_WORDS = new Set([
  'это',
  'как',
  'что',
  'для',
  'при',
  'или',
  'если',
  'она',
  'они',
  'его',
  'еще',
  'ещё',
  'надо',
  'нужно',
  'можно',
  'также',
  'через',
  'после',
  'before',
  'after',
  'with',
  'from',
  'into',
  'this',
  'that',
  'there',
  'then',
  'when',
  'where',
  'which',
  'about',
  'your',
  'note',
  'text',
  'image',
  'block',
  'const',
  'let',
  'var',
  'return',
  'function',
  'true',
  'false',
  'null',
  'undefined',
  'void',
  'string',
  'number',
  'object',
  'array',
  'value',
  'values',
  'user',
  'users',
])

export interface OrganizeExistingNoteResult
  extends OrganizeKnowledgeBaseNoteResult {
  contentBlocks: NoteContentBlock[]
  sectionCount: number
}

const uniqueIndexes = (indexes: number[]): number[] => [...new Set(indexes)]

const normalizeInlineText = (value: string | null | undefined): string =>
  (value ?? '').replace(/\s+/g, ' ').trim()

const truncateText = (value: string, maxChars: number): string => {
  if (value.length <= maxChars) {
    return value
  }

  return `${value.slice(0, Math.max(1, maxChars - 1)).trimEnd()}…`
}

const toKeywordWeight = (token: string): number => {
  if (token.length >= 10) {
    return 3
  }

  if (token.length >= 6) {
    return 2
  }

  return 1
}

const tokenizeForHeuristic = (value: string): string[] =>
  (value
    .toLowerCase()
    .match(/[\p{L}\p{N}_-]{3,}/gu) ?? [])
    .map((token) => token.trim())
    .filter(
      (token) =>
        token.length >= 3 &&
        !HEURISTIC_STOP_WORDS.has(token) &&
        !/^\d+$/.test(token),
    )

const getBlockHeuristicSourceText = (
  block: NoteContentBlock,
  input: OrganizeExistingNoteInput,
): string => {
  if (block.type === 'text') {
    return block.text
  }

  const attachment = input.attachmentsById[block.attachmentId]

  return [
    attachment?.extractedText ?? '',
    attachment?.imageDescription ?? '',
    attachment?.originalFileName ?? '',
  ]
    .filter(Boolean)
    .join('\n')
}

const buildHeuristicTitle = (
  keywordWeights: Map<string, number>,
  fallbackIndex: number,
): string => {
  const topKeywords = [...keywordWeights.entries()]
    .sort((left, right) => {
      if (left[1] !== right[1]) {
        return right[1] - left[1]
      }

      return left[0].localeCompare(right[0], 'ru')
    })
    .slice(0, 2)
    .map(([keyword]) => keyword)

  if (topKeywords.length === 0) {
    return `Раздел ${fallbackIndex}`
  }

  if (topKeywords.length === 1) {
    return topKeywords[0]!.charAt(0).toUpperCase() + topKeywords[0]!.slice(1)
  }

  return topKeywords
    .map((keyword) => keyword.charAt(0).toUpperCase() + keyword.slice(1))
    .join(' / ')
}

const scoreClusterMatch = (
  cluster: HeuristicCluster,
  tokens: string[],
): number => {
  let score = 0

  for (const token of tokens) {
    score += cluster.keywordWeights.get(token) ?? 0
  }

  return score
}

const buildHeuristicOrganization = (
  input: OrganizeExistingNoteInput,
  blocks: NoteContentBlock[],
): OrganizeExistingNoteResult => {
  const clusters: HeuristicCluster[] = []

  blocks.forEach((block, index) => {
    const sourceText = getBlockHeuristicSourceText(block, input)
    const tokens = tokenizeForHeuristic(sourceText)
    const uniqueTokens = [...new Set(tokens)]

    if (uniqueTokens.length === 0) {
      const fallbackCluster =
        clusters.find((cluster) => cluster.title === 'Разное') ??
        (() => {
          const createdCluster: HeuristicCluster = {
            title: 'Разное',
            firstIndex: index + 1,
            blockIndexes: [],
            keywordWeights: new Map(),
          }
          clusters.push(createdCluster)
          return createdCluster
        })()

      fallbackCluster.blockIndexes.push(index + 1)
      return
    }

    let bestCluster: HeuristicCluster | null = null
    let bestScore = 0

    for (const cluster of clusters) {
      const score = scoreClusterMatch(cluster, uniqueTokens)

      if (score > bestScore) {
        bestScore = score
        bestCluster = cluster
      }
    }

    const shouldCreateCluster =
      !bestCluster ||
      bestScore < 2 ||
      (clusters.length < 12 && bestScore < uniqueTokens.length)

    const targetCluster: HeuristicCluster =
      shouldCreateCluster
        ? (() => {
            const keywordWeights = new Map<string, number>()

            for (const token of uniqueTokens) {
              keywordWeights.set(token, toKeywordWeight(token))
            }

            const createdCluster: HeuristicCluster = {
              title: buildHeuristicTitle(keywordWeights, clusters.length + 1),
              firstIndex: index + 1,
              blockIndexes: [],
              keywordWeights,
            }
            clusters.push(createdCluster)
            return createdCluster
          })()
        : bestCluster!

    targetCluster.blockIndexes.push(index + 1)

    for (const token of uniqueTokens) {
      targetCluster.keywordWeights.set(
        token,
        (targetCluster.keywordWeights.get(token) ?? 0) + toKeywordWeight(token),
      )
    }

    targetCluster.title = buildHeuristicTitle(
      targetCluster.keywordWeights,
      clusters.indexOf(targetCluster) + 1,
    )
  })

  const sections = clusters
    .filter((cluster) => cluster.blockIndexes.length > 0)
    .sort((left, right) => left.firstIndex - right.firstIndex)
    .map((cluster) => ({
      title: cluster.title,
      blockIndexes: cluster.blockIndexes,
    }))

  const organized = buildOrganizedContentBlocks(blocks, {
    sections,
    model: 'local:heuristic-note-organization',
    requestId: null,
    usage: null,
  })

  return {
    sections,
    model: 'local:heuristic-note-organization',
    requestId: null,
    usage: null,
    contentBlocks: organized.contentBlocks,
    sectionCount: organized.sectionCount,
  }
}

const estimatePerBlockBudget = (
  blockCount: number,
  budget: OrganizationBudgetProfile,
): number =>
  Math.max(
    budget.minBlockChars,
    Math.floor(budget.totalChars / Math.max(blockCount, 1)),
  )

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
  budget: OrganizationBudgetProfile = DEFAULT_ORGANIZATION_BUDGET,
): OrganizeKnowledgeBaseNoteInput => {
  const perBlockBudget = estimatePerBlockBudget(blocks.length, budget)

  return {
    categoryName: input.categoryName ?? null,
    noteTitle: input.noteTitle ?? null,
    blocks: blocks.map((block) => {
      if (block.type === 'text') {
        const normalizedText = normalizeInlineText(block.text)

        return {
          id: block.id,
          type: 'text',
          text: truncateText(
            normalizedText,
            Math.min(budget.maxTextBlockChars, perBlockBudget * 2),
          ),
        }
      }

      const attachment = input.attachmentsById[block.attachmentId]
      const normalizedExtractedText = normalizeInlineText(attachment?.extractedText)
      const normalizedDescription = normalizeInlineText(
        attachment?.imageDescription,
      )

      return {
        id: block.id,
        type: 'image',
        fileName: attachment?.originalFileName ?? null,
        extractedText: normalizedExtractedText
          ? truncateText(
              normalizedExtractedText,
              Math.min(budget.maxImageTextChars, perBlockBudget),
            )
          : null,
        imageDescription: normalizedDescription
          ? truncateText(
              normalizedDescription,
              Math.min(
                budget.maxImageDescriptionChars,
                Math.max(budget.minBlockChars, Math.floor(perBlockBudget * 0.75)),
              ),
            )
          : null,
      }
    }),
  }
}

const shouldRetryWithCompactInput = (error: unknown): boolean => {
  if (!(error instanceof AiServiceError)) {
    return false
  }

  if (error.status === 413) {
    return true
  }

  const normalizedMessage = error.message.toLowerCase()

  return [
    'request too large',
    'context length',
    'tokens per minute',
    'tpm',
    'too many states',
    'constraint has too many states',
    'schema produces a constraint',
    'failed to validate json',
  ].some((pattern) => normalizedMessage.includes(pattern))
}

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

  const budgets: OrganizationBudgetProfile[] = [
    DEFAULT_ORGANIZATION_BUDGET,
    COMPACT_ORGANIZATION_BUDGET,
    ULTRA_COMPACT_ORGANIZATION_BUDGET,
  ]
  let organization: OrganizeKnowledgeBaseNoteResult | null = null

  for (let index = 0; index < budgets.length; index += 1) {
    try {
      organization = await organizeKnowledgeBaseNote(
        buildOrganizationInput(input, sourceBlocks, budgets[index]!),
      )
      break
    } catch (error) {
      if (!shouldRetryWithCompactInput(error) || index === budgets.length - 1) {
        organization = null
        break
      }
    }
  }

  if (!organization) {
    return buildHeuristicOrganization(input, sourceBlocks)
  }

  const organized = buildOrganizedContentBlocks(sourceBlocks, organization)

  return {
    ...organization,
    contentBlocks: organized.contentBlocks,
    sectionCount: organized.sectionCount,
  }
}
