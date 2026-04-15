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

interface ReorganizeExistingNoteOptions {
  mode?: 'ai' | 'local'
  sectionTitles?: string[]
}

interface OrganizationBudgetProfile {
  totalChars: number
  minBlockChars: number
  maxTextBlockChars: number
  maxImageTextChars: number
  maxImageDescriptionChars: number
}

interface TopicPattern {
  key: string
  title: string
  patterns: RegExp[]
}

interface BlockHeuristicProfile {
  index: number
  block: NoteContentBlock
  sourceText: string
  normalizedTokens: string[]
  tokenWeights: Map<string, number>
  titleCandidates: string[]
  topicKeys: Set<string>
  primaryKey: string
  primaryTitle: string
  signalScore: number
  canStartSection: boolean
  hasStrongTopic: boolean
  hasStrongHeading: boolean
  isLowInformation: boolean
}

interface HeuristicCluster {
  key: string
  title: string
  firstIndex: number
  lastIndex: number
  blockIndexes: number[]
  tokenWeights: Map<string, number>
  titleWeights: Map<string, number>
  topicKeys: Set<string>
  signalScore: number
  strongSignalCount: number
}

interface LocalSectionGuide {
  title: string
  key: string
  normalizedTitle: string
  titleTokens: Set<string>
  tokenWeights: Map<string, number>
  topicKeys: Set<string>
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
  'если',
  'когда',
  'где',
  'почему',
  'зачем',
  'пример',
  'примеры',
  'вопрос',
  'ответ',
  'который',
  'которая',
  'которые',
  'этой',
  'этот',
  'эти',
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

const TOKEN_ALIASES = new Map<string, string>([
  ['closure', 'замыкание'],
  ['closures', 'замыкание'],
  ['замыкание', 'замыкание'],
  ['замыкания', 'замыкание'],
  ['class', 'класс'],
  ['classes', 'класс'],
  ['класс', 'класс'],
  ['классы', 'класс'],
  ['object', 'объект'],
  ['objects', 'объект'],
  ['объект', 'объект'],
  ['объекты', 'объект'],
  ['prototype', 'прототип'],
  ['prototypes', 'прототип'],
  ['прототип', 'прототип'],
  ['прототипы', 'прототип'],
  ['proxy', 'proxy'],
  ['proxies', 'proxy'],
  ['прокси', 'proxy'],
  ['reflect', 'reflect'],
  ['regexp', 'regexp'],
  ['regex', 'regexp'],
  ['регэксп', 'regexp'],
  ['регулярн', 'regexp'],
  ['promise', 'promise'],
  ['promises', 'promise'],
  ['промис', 'promise'],
  ['async', 'async'],
  ['await', 'await'],
  ['асинхрон', 'async'],
  ['currying', 'каррирование'],
  ['curried', 'каррирование'],
  ['каррирование', 'каррирование'],
  ['partial', 'частичное'],
  ['memoization', 'мемоизация'],
  ['memoized', 'мемоизация'],
  ['memoize', 'мемоизация'],
  ['cache', 'мемоизация'],
  ['caching', 'мемоизация'],
  ['cached', 'мемоизация'],
  ['кэширование', 'мемоизация'],
  ['мемоизация', 'мемоизация'],
  ['constructor', 'конструктор'],
  ['constructors', 'конструктор'],
  ['конструктор', 'конструктор'],
  ['construct', 'конструктор'],
  ['module', 'модуль'],
  ['modules', 'модуль'],
  ['модуль', 'модуль'],
  ['модули', 'модуль'],
  ['destructuring', 'деструктуризация'],
  ['деструктуризация', 'деструктуризация'],
  ['reactivity', 'reactivity'],
  ['computed', 'computed'],
  ['watch', 'watch'],
  ['reactive', 'reactive'],
  ['selector', 'селектор'],
  ['selectors', 'селектор'],
  ['селектор', 'селектор'],
  ['селекторы', 'селектор'],
  ['grid', 'grid'],
  ['flex', 'flex'],
  ['flexbox', 'flex'],
])

const TOPIC_PATTERNS: TopicPattern[] = [
  {
    key: 'замыкание',
    title: 'Замыкания',
    patterns: [/\bclosure\b/iu, /замыкан/iu],
  },
  {
    key: 'класс',
    title: 'Классы',
    patterns: [/\bclass(?:es)?\b/iu, /класс/iu],
  },
  {
    key: 'объект',
    title: 'Объекты',
    patterns: [/\bobject(?:s)?\b/iu, /объект/iu],
  },
  {
    key: 'прототип',
    title: 'Прототипы',
    patterns: [/\bprototype(?:s)?\b/iu, /прототип/iu],
  },
  {
    key: 'proxy-reflect',
    title: 'Proxy и Reflect',
    patterns: [/\bproxy\b/iu, /\breflect\b/iu, /прокси/iu, /рефлект/iu],
  },
  {
    key: 'regexp',
    title: 'Регулярные выражения',
    patterns: [/\bregex\b/iu, /\bregexp\b/iu, /regular expression/iu, /регулярн.{0,20}выражен/iu],
  },
  {
    key: 'event-loop',
    title: 'Event loop',
    patterns: [/event loop/iu, /microtask/iu, /macrotask/iu, /eventloop/iu],
  },
  {
    key: 'async-await',
    title: 'Async/await',
    patterns: [/\basync\b/iu, /\bawait\b/iu, /асинхрон/iu],
  },
  {
    key: 'promise',
    title: 'Promise',
    patterns: [/\bpromise(?:s)?\b/iu, /промис/iu],
  },
  {
    key: 'currying',
    title: 'Каррирование и частичное применение',
    patterns: [/currying/iu, /partial application/iu, /каррирован/iu, /частичн.{0,20}применен/iu],
  },
  {
    key: 'memoization',
    title: 'Мемоизация',
    patterns: [/memoi[sz]ation/iu, /\bcach(?:e|ing|ed)\b/iu, /мемоизац/iu, /кэширован/iu],
  },
  {
    key: 'constructor',
    title: 'Функции-конструкторы',
    patterns: [/constructor/iu, /конструктор/iu],
  },
  {
    key: 'this',
    title: 'Контекст this',
    patterns: [/\bthis\b/iu, /контекст this/iu],
  },
  {
    key: 'module',
    title: 'Модули',
    patterns: [/\bmodule(?:s)?\b/iu, /модул/iu],
  },
  {
    key: 'map-set',
    title: 'Map и Set',
    patterns: [/\bmap\b/iu, /\bset\b/iu, /map и set/iu],
  },
  {
    key: 'destructuring',
    title: 'Деструктуризация',
    patterns: [/destructur/iu, /деструктуризац/iu],
  },
  {
    key: 'vue-reactivity',
    title: 'Vue reactivity',
    patterns: [/reactivit/iu, /\bcomputed\b/iu, /\bwatch\b/iu, /\bref\b/iu, /\breactive\b/iu, /composition api/iu],
  },
  {
    key: 'css-layout',
    title: 'CSS layout',
    patterns: [/\bflexbox\b/iu, /\bgrid\b/iu, /селектор/iu, /specificity/iu, /каскад/iu, /\blayout\b/iu],
  },
]

const TOPIC_TITLE_BY_KEY = new Map(
  TOPIC_PATTERNS.map((topic) => [topic.key, topic.title] as const),
)

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

const normalizeToken = (value: string): string => {
  let token = value
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/^[^a-zа-я0-9]+|[^a-zа-я0-9]+$/giu, '')

  if (!token) {
    return ''
  }

  token = TOKEN_ALIASES.get(token) ?? token

  if (token.length > 5) {
    token = token
      .replace(/(изация|ирования|ирование|ирова|ирования|ениями|ениями|ением|ениями)$/u, '')
      .replace(/(иями|ями|ами|ого|ему|ому|ыми|ими|иях|ах|ях|ов|ев|ей|ом|ем|ую|юю|ая|яя|ое|ее|ые|ие|ий|ый|ой|ам|ям|а|я|ы|и|о|е|у|ю)$/u, '')
      .replace(/(ization|isation|ations|ation|ments|ment|ings|ing|ized|izer|ers|ies|ied|ed|es|s)$/u, '')
  }

  token = TOKEN_ALIASES.get(token) ?? token

  if (!token || token.length < 3 || HEURISTIC_STOP_WORDS.has(token)) {
    return ''
  }

  return token
}

const tokenizeForHeuristic = (value: string): string[] =>
  (value.match(/[\p{L}\p{N}_-]{3,}/gu) ?? [])
    .map((token) => normalizeToken(token))
    .filter(Boolean)

const addWeight = (weights: Map<string, number>, token: string, value: number): void => {
  weights.set(token, (weights.get(token) ?? 0) + value)
}

const mergeWeights = (
  target: Map<string, number>,
  source: Map<string, number>,
  multiplier = 1,
): void => {
  for (const [token, weight] of source.entries()) {
    addWeight(target, token, weight * multiplier)
  }
}

const getWeight = (weights: Map<string, number>, key: string): number =>
  weights.get(key) ?? 0

const getSortedWeights = (
  weights: Map<string, number>,
): Array<[string, number]> =>
  [...weights.entries()].sort((left, right) => {
    if (left[1] !== right[1]) {
      return right[1] - left[1]
    }

    return left[0].localeCompare(right[0], 'ru')
  })

const keepTopWeights = (
  weights: Map<string, number>,
  maxSize: number,
): Map<string, number> =>
  new Map(getSortedWeights(weights).slice(0, maxSize))

const CODE_HEAVY_LINE_PATTERN =
  /[{};=>]|^\s*(?:const|let|var|function|return|if|else|for|while|switch|case|class|import|export|console)\b/iu

const GENERIC_HEADING_PATTERN =
  /^(?:пример|примеры|примеры кода|код|задача|решение|ответ|вопрос|разбор|схема|конспект|заметка|слайд)$/iu

const toKeywordWeight = (token: string): number => {
  if (TOPIC_TITLE_BY_KEY.has(token)) {
    return 5
  }

  if (token.length >= 10) {
    return 3
  }

  if (token.length >= 6) {
    return 2
  }

  return 1
}

const getBlockHeuristicSourceText = (
  block: NoteContentBlock,
  input: OrganizeExistingNoteInput,
): string => {
  if (block.type === 'text') {
    return block.text
  }

  if (block.type === 'code') {
    return `${block.language}\n${block.code}`
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

const isCodeLikeLine = (value: string): boolean => {
  const normalized = value.trim()

  if (!normalized) {
    return false
  }

  return (
    CODE_HEAVY_LINE_PATTERN.test(normalized) ||
    ((normalized.match(/[{}()[\];=<>]/gu) ?? []).length >= 3 &&
      normalized.split(/\s+/u).length >= 4)
  )
}

const stripHeadingPrefix = (value: string): string =>
  value
    .replace(/^[\s>*#-]+/u, '')
    .replace(/^\d+[.)]\s*/u, '')
    .replace(/^(что такое|как работает|как устроен[ао]?|как использовать|пример|примеры|основы|зачем нужен[аоы]?|почему)\s+/iu, '')
    .trim()

const isLikelyHeadingLine = (value: string): boolean => {
  const normalized = stripHeadingPrefix(value)

  if (!normalized || normalized.length < 3 || normalized.length > 96) {
    return false
  }

  if (/[{};=<>]/u.test(normalized)) {
    return false
  }

  if (GENERIC_HEADING_PATTERN.test(normalized) || isCodeLikeLine(normalized)) {
    return false
  }

  const wordCount = normalized.split(/\s+/u).length

  if (wordCount > 10) {
    return false
  }

  return true
}

const normalizeDisplayTitle = (value: string): string => {
  const cleaned = stripHeadingPrefix(value)
    .replace(/[?!.:]+$/u, '')
    .replace(/\s+/gu, ' ')
    .trim()

  if (!cleaned) {
    return 'Раздел'
  }

  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1)
}

const extractHeadingCandidates = (value: string): string[] => {
  const lines = value
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)

  const candidates = lines
    .slice(0, 6)
    .filter((line) => isLikelyHeadingLine(line))
    .map((line) => normalizeDisplayTitle(line))

  return [...new Set(candidates)]
}

const sanitizeHeuristicText = (value: string): string => {
  const compactLines = value
    .split(/\r?\n/u)
    .map((line) => normalizeInlineText(line))
    .filter(Boolean)
    .filter((line) => !(isCodeLikeLine(line) && line.length > 120))
    .slice(0, 24)

  return compactLines.join('\n')
}

const detectTopicPatterns = (value: string): Array<{ key: string; title: string }> => {
  const normalized = value.toLowerCase()

  return TOPIC_PATTERNS.filter((topic) =>
    topic.patterns.some((pattern) => pattern.test(normalized)),
  ).map((topic) => ({
    key: topic.key,
    title: topic.title,
  }))
}

const buildTitleFromWeights = (
  tokenWeights: Map<string, number>,
  fallbackIndex: number,
): string => {
  const tokens = getSortedWeights(tokenWeights)
    .slice(0, 2)
    .map(([token]) => TOPIC_TITLE_BY_KEY.get(token) ?? token)

  if (tokens.length === 0) {
    return `Раздел ${fallbackIndex}`
  }

  if (tokens.length === 1) {
    return normalizeDisplayTitle(tokens[0]!)
  }

  return tokens.map((token) => normalizeDisplayTitle(token)).join(' / ')
}

const buildPrimaryKeyFromTitle = (title: string): string => {
  const titleTopics = detectTopicPatterns(title)

  if (titleTopics.length > 0) {
    return titleTopics[0]!.key
  }

  const normalizedTokens = tokenizeForHeuristic(title)

  if (normalizedTokens.length === 0) {
    return 'misc'
  }

  return normalizedTokens.slice(0, 3).join('-')
}

const normalizeSectionTitles = (values: string[]): string[] => {
  const result: string[] = []
  const seen = new Set<string>()

  for (const value of values) {
    const normalized = normalizeDisplayTitle(value).slice(0, 80)

    if (!normalized) {
      continue
    }

    const dedupeKey = normalized.toLocaleLowerCase('ru')

    if (seen.has(dedupeKey)) {
      continue
    }

    seen.add(dedupeKey)
    result.push(normalized)
  }

  return result
}

const buildLocalSectionGuide = (title: string): LocalSectionGuide => {
  const topicMatches = detectTopicPatterns(title)
  const tokenWeights = new Map<string, number>()
  const titleTokens = new Set(tokenizeForHeuristic(title))

  for (const token of titleTokens) {
    addWeight(tokenWeights, token, 8)
  }

  for (const topic of topicMatches) {
    addWeight(tokenWeights, topic.key, 18)
  }

  return {
    title,
    key: topicMatches[0]?.key ?? buildPrimaryKeyFromTitle(title),
    normalizedTitle: title.toLocaleLowerCase('ru').replace(/ё/gu, 'е').trim(),
    titleTokens,
    tokenWeights: keepTopWeights(tokenWeights, 12),
    topicKeys: new Set(topicMatches.map((topic) => topic.key)),
  }
}

const scoreSectionGuideForProfile = (
  guide: LocalSectionGuide,
  profile: BlockHeuristicProfile,
  isActiveGuide: boolean,
): number => {
  let score = 0
  const normalizedSourceText = profile.sourceText
    .toLocaleLowerCase('ru')
    .replace(/ё/gu, 'е')
  const normalizedTitleCandidates = profile.titleCandidates.map((title) =>
    title.toLocaleLowerCase('ru').replace(/ё/gu, 'е'),
  )

  if (guide.key === profile.primaryKey && guide.key !== 'misc') {
    score += 24
  }

  if (
    guide.normalizedTitle &&
    normalizedSourceText.includes(guide.normalizedTitle)
  ) {
    score += 34
  }

  if (
    normalizedTitleCandidates.some(
      (candidate) =>
        candidate.includes(guide.normalizedTitle) ||
        guide.normalizedTitle.includes(candidate),
    )
  ) {
    score += 18
  }

  for (const topicKey of profile.topicKeys) {
    if (guide.topicKeys.has(topicKey)) {
      score += 14
    }
  }

  for (const [token, weight] of profile.tokenWeights.entries()) {
    const guideWeight = guide.tokenWeights.get(token) ?? 0

    if (guideWeight > 0) {
      score += Math.min(guideWeight + 2, weight + 4)
    }

    if (guide.titleTokens.has(token)) {
      score += 6
    }
  }

  if (profile.titleCandidates.includes(guide.title)) {
    score += 12
  }

  if (isActiveGuide && profile.isLowInformation) {
    score += 8
  }

  return score
}

const buildBlockProfile = (
  input: OrganizeExistingNoteInput,
  block: NoteContentBlock,
  index: number,
): BlockHeuristicProfile => {
  const sourceText = sanitizeHeuristicText(getBlockHeuristicSourceText(block, input))
  const titleCandidates = extractHeadingCandidates(sourceText)
  const topicMatches = detectTopicPatterns(
    [sourceText, ...titleCandidates].join('\n'),
  )
  const tokenWeights = new Map<string, number>()
  const normalizedTokens = tokenizeForHeuristic(sourceText)

  for (const token of normalizedTokens) {
    addWeight(tokenWeights, token, toKeywordWeight(token))
  }

  for (const title of titleCandidates) {
    for (const token of tokenizeForHeuristic(title)) {
      addWeight(tokenWeights, token, 8)
    }
  }

  for (const topic of topicMatches) {
    addWeight(tokenWeights, topic.key, 18)
  }

  const trimmedWeights = keepTopWeights(tokenWeights, 18)
  const hasStrongTopic = topicMatches.length > 0
  const hasStrongHeading = titleCandidates.length > 0
  const signalScore =
    topicMatches.length * 18 +
    (hasStrongHeading ? 10 : 0) +
    Math.min(normalizedTokens.length, 12)

  const primaryTitle =
    topicMatches[0]?.title ??
    titleCandidates[0] ??
    buildTitleFromWeights(trimmedWeights, index + 1)
  const primaryKey =
    topicMatches[0]?.key ?? buildPrimaryKeyFromTitle(primaryTitle)

  return {
    index,
    block,
    sourceText,
    normalizedTokens,
    tokenWeights: trimmedWeights,
    titleCandidates: topicMatches.map((topic) => topic.title).concat(titleCandidates),
    topicKeys: new Set(topicMatches.map((topic) => topic.key)),
    primaryKey,
    primaryTitle,
    signalScore,
    canStartSection:
      hasStrongTopic || hasStrongHeading || signalScore >= 14,
    hasStrongTopic,
    hasStrongHeading,
    isLowInformation:
      signalScore < 14 && normalizedTokens.length < 6,
  }
}

const createClusterFromProfile = (profile: BlockHeuristicProfile): HeuristicCluster => {
  const titleWeights = new Map<string, number>()
  addWeight(titleWeights, profile.primaryTitle, 10)

  return {
    key: profile.primaryKey,
    title: profile.primaryTitle,
    firstIndex: profile.index + 1,
    lastIndex: profile.index + 1,
    blockIndexes: [],
    tokenWeights: new Map(profile.tokenWeights),
    titleWeights,
    topicKeys: new Set(profile.topicKeys),
    signalScore: profile.signalScore,
    strongSignalCount: profile.canStartSection ? 1 : 0,
  }
}

const scoreClusterForProfile = (
  cluster: HeuristicCluster,
  profile: BlockHeuristicProfile,
): number => {
  let score = 0

  if (cluster.key === profile.primaryKey && profile.primaryKey !== 'misc') {
    score += 28
  }

  for (const topicKey of profile.topicKeys) {
    if (cluster.topicKeys.has(topicKey)) {
      score += 14
    }
  }

  for (const [token, weight] of profile.tokenWeights.entries()) {
    const clusterWeight = cluster.tokenWeights.get(token) ?? 0

    if (clusterWeight > 0) {
      score += Math.min(clusterWeight, weight + 3)
    }
  }

  if (profile.titleCandidates.some((title) => getWeight(cluster.titleWeights, title) > 0)) {
    score += 10
  }

  const distance = Math.max(0, profile.index + 1 - cluster.lastIndex)

  if (distance <= 2) {
    score += 6 - distance
  }

  return score
}

const rebuildClusterTitle = (cluster: HeuristicCluster): string => {
  const bestTopicKey = [...cluster.topicKeys]
    .map((key) => ({
      key,
      weight:
        getWeight(cluster.tokenWeights, key) +
        getWeight(cluster.titleWeights, TOPIC_TITLE_BY_KEY.get(key) ?? key),
    }))
    .sort((left, right) => right.weight - left.weight)[0]?.key

  if (bestTopicKey) {
    return TOPIC_TITLE_BY_KEY.get(bestTopicKey) ?? normalizeDisplayTitle(bestTopicKey)
  }

  const explicitTitle = [...cluster.titleWeights.entries()]
    .sort((left, right) => {
      if (left[1] !== right[1]) {
        return right[1] - left[1]
      }

      return left[0].localeCompare(right[0], 'ru')
    })
    .map(([title]) => normalizeDisplayTitle(title))
    .find((title) => title && title !== 'Раздел')

  if (explicitTitle) {
    return explicitTitle
  }

  return buildTitleFromWeights(cluster.tokenWeights, cluster.firstIndex)
}

const assignProfileToCluster = (
  cluster: HeuristicCluster,
  profile: BlockHeuristicProfile,
): void => {
  cluster.blockIndexes.push(profile.index + 1)
  cluster.firstIndex = Math.min(cluster.firstIndex, profile.index + 1)
  cluster.lastIndex = Math.max(cluster.lastIndex, profile.index + 1)
  mergeWeights(cluster.tokenWeights, profile.tokenWeights)
  cluster.tokenWeights = keepTopWeights(cluster.tokenWeights, 20)
  addWeight(cluster.titleWeights, profile.primaryTitle, profile.isLowInformation ? 2 : 8)

  for (const title of profile.titleCandidates) {
    addWeight(cluster.titleWeights, title, 4)
  }

  for (const topicKey of profile.topicKeys) {
    cluster.topicKeys.add(topicKey)
  }

  cluster.signalScore += profile.signalScore
  if (profile.canStartSection) {
    cluster.strongSignalCount += 1
  }
  cluster.title = rebuildClusterTitle(cluster)
}

const selectNearestCluster = (
  clusters: HeuristicCluster[],
  profile: BlockHeuristicProfile,
): HeuristicCluster | null => {
  let bestCluster: HeuristicCluster | null = null
  let bestScore = Number.NEGATIVE_INFINITY

  for (const cluster of clusters) {
    const semanticScore = scoreClusterForProfile(cluster, profile)
    const distancePenalty = Math.abs(cluster.lastIndex - (profile.index + 1))
    const totalScore = semanticScore - Math.min(distancePenalty, 12)

    if (totalScore > bestScore) {
      bestScore = totalScore
      bestCluster = cluster
    }
  }

  return bestCluster
}

const mergeCompatibleClusters = (clusters: HeuristicCluster[]): HeuristicCluster[] => {
  const merged = [...clusters]
  let changed = true

  while (changed) {
    changed = false

    for (let leftIndex = 0; leftIndex < merged.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < merged.length; rightIndex += 1) {
        const left = merged[leftIndex]!
        const right = merged[rightIndex]!
        const overlapScore = scoreClusterForProfile(left, {
          index: right.firstIndex - 1,
          block: { id: createId(), type: 'text', text: right.title },
          sourceText: right.title,
          normalizedTokens: tokenizeForHeuristic(right.title),
          tokenWeights: right.tokenWeights,
          titleCandidates: [right.title],
          topicKeys: right.topicKeys,
          primaryKey: right.key,
          primaryTitle: right.title,
          signalScore: right.signalScore,
          canStartSection: right.strongSignalCount > 0,
          hasStrongTopic: right.topicKeys.size > 0,
          hasStrongHeading: true,
          isLowInformation: false,
        })
        const shouldMerge =
          left.key === right.key ||
          [...left.topicKeys].some((key) => right.topicKeys.has(key)) ||
          overlapScore >= 18 ||
          (Math.min(left.blockIndexes.length, right.blockIndexes.length) <= 1 &&
            overlapScore >= 10)

        if (!shouldMerge) {
          continue
        }

        for (const blockIndex of right.blockIndexes) {
          if (!left.blockIndexes.includes(blockIndex)) {
            left.blockIndexes.push(blockIndex)
          }
        }

        left.firstIndex = Math.min(left.firstIndex, right.firstIndex)
        left.lastIndex = Math.max(left.lastIndex, right.lastIndex)
        mergeWeights(left.tokenWeights, right.tokenWeights)
        left.tokenWeights = keepTopWeights(left.tokenWeights, 20)
        mergeWeights(left.titleWeights, right.titleWeights)
        for (const topicKey of right.topicKeys) {
          left.topicKeys.add(topicKey)
        }
        left.signalScore += right.signalScore
        left.strongSignalCount += right.strongSignalCount
        left.title = rebuildClusterTitle(left)

        merged.splice(rightIndex, 1)
        changed = true
        break
      }

      if (changed) {
        break
      }
    }
  }

  return merged
}

const absorbWeakClusters = (clusters: HeuristicCluster[]): HeuristicCluster[] => {
  if (clusters.length <= 1) {
    return clusters
  }

  const ordered = [...clusters].sort((left, right) => left.firstIndex - right.firstIndex)
  const result: HeuristicCluster[] = []

  for (let index = 0; index < ordered.length; index += 1) {
    const cluster = ordered[index]!
    const isWeak =
      cluster.strongSignalCount === 0 ||
      (cluster.blockIndexes.length === 1 &&
        cluster.signalScore < 18 &&
        cluster.topicKeys.size === 0)

    if (!isWeak) {
      result.push(cluster)
      continue
    }

    const previous = result.at(-1) ?? null
    const next = ordered[index + 1] ?? null
    const candidates = [previous, next].filter(
      (value): value is HeuristicCluster => value !== null,
    )

    if (candidates.length === 0) {
      result.push(cluster)
      continue
    }

    const target = candidates
      .map((candidate) => ({
        candidate,
        score: scoreClusterForProfile(candidate, {
          index: cluster.firstIndex - 1,
          block: { id: createId(), type: 'text', text: cluster.title },
          sourceText: cluster.title,
          normalizedTokens: tokenizeForHeuristic(cluster.title),
          tokenWeights: cluster.tokenWeights,
          titleCandidates: [cluster.title],
          topicKeys: cluster.topicKeys,
          primaryKey: cluster.key,
          primaryTitle: cluster.title,
          signalScore: cluster.signalScore,
          canStartSection: cluster.strongSignalCount > 0,
          hasStrongTopic: cluster.topicKeys.size > 0,
          hasStrongHeading: true,
          isLowInformation: false,
        }),
      }))
      .sort((left, right) => right.score - left.score)[0]!.candidate

    for (const blockIndex of cluster.blockIndexes) {
      if (!target.blockIndexes.includes(blockIndex)) {
        target.blockIndexes.push(blockIndex)
      }
    }

    target.firstIndex = Math.min(target.firstIndex, cluster.firstIndex)
    target.lastIndex = Math.max(target.lastIndex, cluster.lastIndex)
    mergeWeights(target.tokenWeights, cluster.tokenWeights)
    target.tokenWeights = keepTopWeights(target.tokenWeights, 20)
    mergeWeights(target.titleWeights, cluster.titleWeights)
    for (const topicKey of cluster.topicKeys) {
      target.topicKeys.add(topicKey)
    }
    target.signalScore += cluster.signalScore
    target.strongSignalCount += cluster.strongSignalCount
    target.title = rebuildClusterTitle(target)
  }

  return result
}

export const buildHeuristicOrganization = (
  input: OrganizeExistingNoteInput,
  blocks: NoteContentBlock[],
): OrganizeExistingNoteResult => {
  const profiles = blocks.map((block, index) =>
    buildBlockProfile(input, block, index),
  )
  const clusters: HeuristicCluster[] = []
  const clustersByKey = new Map<string, HeuristicCluster>()
  const deferredProfiles: BlockHeuristicProfile[] = []
  let activeCluster: HeuristicCluster | null = null

  for (const profile of profiles) {
    const exactCluster =
      profile.primaryKey !== 'misc'
        ? (clustersByKey.get(profile.primaryKey) ?? null)
        : null

    if (exactCluster) {
      assignProfileToCluster(exactCluster, profile)
      activeCluster = exactCluster
      continue
    }

    let bestCluster: HeuristicCluster | null = null
    let bestScore = 0

    for (const cluster of clusters) {
      const score = scoreClusterForProfile(cluster, profile)

      if (score > bestScore) {
        bestScore = score
        bestCluster = cluster
      }
    }

    const shouldStickToActiveCluster: boolean =
      profile.isLowInformation && activeCluster !== null
    const shouldReuseBestCluster: boolean =
      bestCluster !== null &&
      (bestScore >= 22 ||
        (!profile.canStartSection && bestScore >= 6) ||
        (activeCluster === bestCluster && bestScore >= 10))

    const targetCluster: HeuristicCluster | null =
      shouldStickToActiveCluster
        ? activeCluster
        : shouldReuseBestCluster
          ? bestCluster
          : null

    if (targetCluster) {
      assignProfileToCluster(targetCluster, profile)
      activeCluster = targetCluster
      clustersByKey.set(targetCluster.key, targetCluster)
      continue
    }

    if (!profile.canStartSection) {
      deferredProfiles.push(profile)
      continue
    }

    const createdCluster = createClusterFromProfile(profile)
    assignProfileToCluster(createdCluster, profile)
    clusters.push(createdCluster)
    if (createdCluster.key !== 'misc') {
      clustersByKey.set(createdCluster.key, createdCluster)
    }
    activeCluster = createdCluster
  }

  for (const profile of deferredProfiles) {
    const targetCluster =
      selectNearestCluster(clusters, profile) ??
      activeCluster

    if (targetCluster) {
      assignProfileToCluster(targetCluster, profile)
      continue
    }

    const createdCluster = createClusterFromProfile(profile)
    assignProfileToCluster(createdCluster, profile)
    clusters.push(createdCluster)
    if (createdCluster.key !== 'misc') {
      clustersByKey.set(createdCluster.key, createdCluster)
    }
    activeCluster = createdCluster
  }

  const normalizedClusters = absorbWeakClusters(mergeCompatibleClusters(clusters))
    .map((cluster) => ({
      ...cluster,
      blockIndexes: uniqueIndexes(cluster.blockIndexes).sort((left, right) => left - right),
      title: rebuildClusterTitle(cluster),
    }))
    .filter((cluster) => cluster.blockIndexes.length > 0)
    .sort((left, right) => left.firstIndex - right.firstIndex)

  const sections = normalizedClusters.map((cluster) => ({
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

const buildGuidedLocalOrganization = (
  input: OrganizeExistingNoteInput,
  blocks: NoteContentBlock[],
  rawSectionTitles: string[],
): OrganizeExistingNoteResult => {
  const sectionTitles = normalizeSectionTitles(rawSectionTitles)

  if (sectionTitles.length === 0) {
    throw new AiServiceError('Добавь хотя бы одно название раздела для локальной сортировки.', {
      status: 400,
      code: 'ai_validation_error',
    })
  }

  const guides = sectionTitles.map((title) => buildLocalSectionGuide(title))
  const profiles = blocks.map((block, index) => buildBlockProfile(input, block, index))
  const sections = guides.map((guide) => ({
    title: guide.title,
    blockIndexes: [] as number[],
  }))
  const unassignedIndexes: number[] = []
  let activeGuideIndex: number | null = null

  for (const profile of profiles) {
    let bestGuideIndex = -1
    let bestScore = Number.NEGATIVE_INFINITY

    guides.forEach((guide, guideIndex) => {
      const score = scoreSectionGuideForProfile(
        guide,
        profile,
        activeGuideIndex === guideIndex,
      )

      if (score > bestScore) {
        bestScore = score
        bestGuideIndex = guideIndex
      }
    })

    const hasStrongMatch = bestScore >= (profile.canStartSection ? 10 : 3)
    const hasAnyMatch = bestScore > 0
    const canReuseActiveSection: boolean =
      activeGuideIndex !== null &&
      (profile.isLowInformation ||
        bestScore <= 0 ||
        (!profile.hasStrongTopic && bestScore < 6))

    const targetGuideIndex: number = hasStrongMatch
      ? bestGuideIndex
      : hasAnyMatch
        ? bestGuideIndex
      : canReuseActiveSection
        ? (activeGuideIndex ?? -1)
        : -1

    if (targetGuideIndex < 0) {
      unassignedIndexes.push(profile.index + 1)
      continue
    }

    sections[targetGuideIndex]!.blockIndexes.push(profile.index + 1)

    if (profile.canStartSection || hasStrongMatch) {
      activeGuideIndex = targetGuideIndex
    }
  }

  const filteredSections = sections.filter((section) => section.blockIndexes.length > 0)
  const organization: OrganizeKnowledgeBaseNoteResult = {
    sections: filteredSections,
    model: 'local:user-sections',
    requestId: null,
    usage: null,
  }
  const organized = buildOrganizedContentBlocks(blocks, organization)

  if (unassignedIndexes.length > 0) {
    const usedIndexes = new Set(filteredSections.flatMap((section) => section.blockIndexes))
    const remaining = unassignedIndexes.filter((index) => !usedIndexes.has(index))

    if (remaining.length > 0) {
      organization.sections = [
        ...filteredSections,
        {
          title: 'Разное',
          blockIndexes: remaining,
        },
      ]
      const rebuilt = buildOrganizedContentBlocks(blocks, organization)

      return {
        ...organization,
        contentBlocks: rebuilt.contentBlocks,
        sectionCount: rebuilt.sectionCount,
      }
    }
  }

  return {
    ...organization,
    contentBlocks: organized.contentBlocks,
    sectionCount: organized.sectionCount,
  }
}

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

      if (block.type === 'code') {
        const normalizedCode = normalizeInlineText(block.code)

        return {
          id: block.id,
          type: 'text',
          text: truncateText(
            `Код (${block.language})\n${normalizedCode}`,
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
  options: ReorganizeExistingNoteOptions = {},
): Promise<OrganizeExistingNoteResult> => {
  const sourceBlocks = stripGeneratedSectionHeadingBlocks(input.blocks)

  if (sourceBlocks.length === 0) {
    throw new AiServiceError('В теме пока нет содержимого для группировки.', {
      status: 400,
      code: 'ai_validation_error',
    })
  }

  if (options.mode === 'local') {
    return buildGuidedLocalOrganization(
      input,
      sourceBlocks,
      options.sectionTitles ?? [],
    )
  }

  const budgets: OrganizationBudgetProfile[] = [
    DEFAULT_ORGANIZATION_BUDGET,
    COMPACT_ORGANIZATION_BUDGET,
    ULTRA_COMPACT_ORGANIZATION_BUDGET,
  ]
  let organization: OrganizeKnowledgeBaseNoteResult | null = null
  let lastError: unknown = null

  for (let index = 0; index < budgets.length; index += 1) {
    try {
      organization = await organizeKnowledgeBaseNote(
        buildOrganizationInput(input, sourceBlocks, budgets[index]!),
      )
      break
    } catch (error) {
      lastError = error
      if (!shouldRetryWithCompactInput(error) || index === budgets.length - 1) {
        organization = null
        break
      }
    }
  }

  if (!organization) {
    if (lastError instanceof AiServiceError) {
      throw lastError
    }

    throw new AiServiceError('Не удалось получить ответ для AI-сортировки заметки.', {
      status: 502,
      code: 'ai_invalid_response',
    })
  }

  const organized = buildOrganizedContentBlocks(sourceBlocks, organization)

  return {
    ...organization,
    contentBlocks: organized.contentBlocks,
    sectionCount: organized.sectionCount,
  }
}
