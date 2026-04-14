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

interface LocalTopicEntry {
  title: string
  aliases: string[]
  advancedSignals: string[]
  whatItIs: string
  addFocus: string
  deepenFocus: string
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
    ].filter((current): current is string => Boolean(current))

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
      .filter((current): current is string => Boolean(current))
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

const JS_TOPIC_CATALOG: LocalTopicEntry[] = [
  {
    title: 'this и контекст вызова',
    aliases: [' this ', 'контекст вызова', 'this'],
    advancedSignals: ['bind', 'call', 'apply', 'arrow', 'стрелочн', 'new '],
    whatItIs: 'Механика привязки контекста вызова у функций и методов в JavaScript.',
    addFocus:
      'Разобрать правила привязки this, потерю контекста, bind/call/apply и поведение стрелочных функций.',
    deepenFocus:
      'Углубить различия между разными режимами привязки this и разобрать типичные ловушки в колбэках и методах.',
  },
  {
    title: 'Прототипы и prototype chain',
    aliases: ['prototype', 'прототип', '__proto__', 'prototype chain'],
    advancedSignals: ['instanceof', 'constructor', 'object.create', 'class extends'],
    whatItIs: 'Модель наследования объектов через цепочку прототипов.',
    addFocus:
      'Добавить связь между объектами, функциями-конструкторами, prototype и поиском свойств по цепочке.',
    deepenFocus:
      'Раскрыть lookup по цепочке прототипов, instanceof, shadowing свойств и связь с классами.',
  },
  {
    title: 'Модули и изоляция кода',
    aliases: ['module', 'import', 'export', 'esm', 'commonjs', 'модул'],
    advancedSignals: ['dynamic import', 'tree shaking', 'live binding', 'top-level await'],
    whatItIs: 'Способы разделения кода на модули и управления зависимостями.',
    addFocus:
      'Добавить import/export, разницу между ESM и CommonJS и базовые правила загрузки модулей.',
    deepenFocus:
      'Углубить live bindings, циклические зависимости, dynamic import и нюансы исполнения модулей.',
  },
  {
    title: 'Symbol и скрытые ключи',
    aliases: ['symbol', 'символ'],
    advancedSignals: ['iterator', 'toStringTag', 'well-known symbol', 'symbol.for'],
    whatItIs: 'Тип данных Symbol и его применение для уникальных ключей и протоколов языка.',
    addFocus:
      'Добавить использование Symbol как уникальных ключей, Symbol.for и встроенные well-known symbols.',
    deepenFocus:
      'Углубить итерационные протоколы, переопределение поведения объектов через well-known symbols.',
  },
  {
    title: 'Итераторы и генераторы',
    aliases: ['iterator', 'итератор', 'generator', 'генератор', 'yield'],
    advancedSignals: ['for...of', 'next()', 'return()', 'throw()', 'async generator'],
    whatItIs: 'Протокол итерации и функции-генераторы для ленивого производства значений.',
    addFocus:
      'Добавить базовый протокол iterator, генераторы, yield и их связь с for...of.',
    deepenFocus:
      'Раскрыть ручное управление next/throw/return, async generators и практические сценарии.',
  },
  {
    title: 'Proxy и Reflect',
    aliases: ['proxy', 'reflect', 'прокси'],
    advancedSignals: ['trap', 'receiver', 'reflect.get', 'reflect.set', 'invariant'],
    whatItIs: 'Перехват операций над объектами и безопасное делегирование через Reflect.',
    addFocus:
      'Добавить traps, связь Proxy и Reflect, а также ограничения и инварианты прокси.',
    deepenFocus:
      'Углубить receiver, инварианты, производительность и сценарии валидации/логирования.',
  },
  {
    title: 'Обработка ошибок и try/catch/finally',
    aliases: ['try', 'catch', 'finally', 'throw', 'error', 'ошибк', 'исключен'],
    advancedSignals: ['custom error', 'rethrow', 'async stack', 'promise rejection'],
    whatItIs: 'Механика выброса и перехвата ошибок в синхронном и асинхронном коде.',
    addFocus:
      'Добавить throw, try/catch/finally, типы ошибок и базовые практики обработки.',
    deepenFocus:
      'Углубить rethrow, пользовательские классы ошибок, async error flow и unhandled rejections.',
  },
  {
    title: 'Устройство промисов глубже',
    aliases: ['promise', 'промис', 'promises'],
    advancedSignals: ['allsettled', 'race', 'any', 'finally', 'microtask', 'thenable'],
    whatItIs: 'Внутренняя модель промисов и композиция асинхронных операций.',
    addFocus:
      'Добавить статические методы Promise, состояние промиса и правила цепочек then/catch/finally.',
    deepenFocus:
      'Углубить microtask queue, thenable assimilation, combinators и обработку ошибок в цепочках.',
  },
  {
    title: 'Event loop и очереди задач глубже',
    aliases: ['event loop', 'eventloop', 'микрозадач', 'macrotask', 'microtask', 'очеред'],
    advancedSignals: ['rendering', 'task queue', 'microtask queue', 'requestanimationframe'],
    whatItIs: 'Модель выполнения задач, микрозадач и взаимодействия с рендерингом.',
    addFocus:
      'Добавить разницу между macrotask и microtask, порядок выполнения и типичные источники задач.',
    deepenFocus:
      'Углубить влияние рендеринга, starvation, flush микрозадач и практические отладочные кейсы.',
  },
  {
    title: 'Классы, наследование и private fields',
    aliases: ['class ', 'класс', 'extends', 'super', '#', 'private field'],
    advancedSignals: ['static', 'private', 'getter', 'setter', 'extends', 'super'],
    whatItIs: 'Синтаксический слой классов поверх прототипной модели.',
    addFocus:
      'Добавить class, extends, super, статические члены, геттеры/сеттеры и private fields.',
    deepenFocus:
      'Углубить связь классов с prototype chain, инициализацию полей и ограничения private fields.',
  },
  {
    title: 'Регулярные выражения глубже',
    aliases: ['regexp', 'regex', 'регуляр', 'pattern', 'replace(', 'match('],
    advancedSignals: ['lookahead', 'lookbehind', 'named group', 'unicode flag', 'sticky'],
    whatItIs: 'Инструмент для поиска, валидации и преобразования строк по шаблонам.',
    addFocus:
      'Добавить базовый синтаксис regex, флаги, группы, match/replace/test и практические примеры.',
    deepenFocus:
      'Углубить именованные группы, lookaround, unicode/sticky режимы и граничные случаи парсинга.',
  },
  {
    title: 'Map, Set, WeakMap и WeakSet',
    aliases: ['map', 'set', 'weakmap', 'weakset'],
    advancedSignals: ['weak reference', 'garbage collection', 'iteration order'],
    whatItIs: 'Коллекции для хранения пар ключ-значение и уникальных значений.',
    addFocus:
      'Добавить сценарии выбора между Object, Map, Set, WeakMap и WeakSet.',
    deepenFocus:
      'Углубить слабые ссылки, сборку мусора, ограничения WeakMap/WeakSet и реальные кейсы кеширования.',
  },
  {
    title: 'Дескрипторы свойств и Object API',
    aliases: ['defineproperty', 'descriptor', 'writable', 'enumerable', 'configurable', 'object.'],
    advancedSignals: ['getOwnPropertyDescriptor', 'seal', 'freeze', 'preventExtensions'],
    whatItIs: 'Низкоуровневое управление свойствами объектов через дескрипторы.',
    addFocus:
      'Добавить writable/enumerable/configurable, defineProperty и влияние дескрипторов на поведение объекта.',
    deepenFocus:
      'Углубить seal/freeze/preventExtensions и тонкости геттеров/сеттеров в дескрипторах.',
  },
  {
    title: 'Память, ссылки и сборка мусора',
    aliases: ['memory', 'garbage collection', 'утечк', 'сборк мусора', 'weak'],
    advancedSignals: ['closure leak', 'detached dom', 'weakref', 'finalizationregistry'],
    whatItIs: 'Как объекты удерживаются в памяти и когда они могут быть освобождены.',
    addFocus:
      'Добавить модель ссылок, удержание памяти замыканиями и типовые источники утечек.',
    deepenFocus:
      'Углубить weak references, detached DOM, профилирование памяти и сценарии утечек в приложениях.',
  },
]

const GENERIC_TOPIC_CATALOG: LocalTopicEntry[] = [
  {
    title: 'Граничные случаи и edge cases',
    aliases: ['edge case', 'граничн', 'corner case'],
    advancedSignals: ['pitfall', 'trap', 'ошибка', 'bug'],
    whatItIs: 'Нетипичные сценарии, на которых быстро проявляются пробелы в понимании темы.',
    addFocus:
      'Собрать отдельные edge cases и контрпримеры по теме заметки, чтобы лучше видеть реальные ограничения.',
    deepenFocus:
      'Расширить раздел граничных случаев и добавить разбор причин неожиданных результатов.',
  },
  {
    title: 'Производительность и стоимость операций',
    aliases: ['performance', 'производительн', 'оптимизац', 'slow'],
    advancedSignals: ['complexity', 'memory', 'benchmark', 'profiling'],
    whatItIs: 'Практический взгляд на цену операций, памяти и производительности.',
    addFocus:
      'Добавить, какие операции дорогие, где возникают узкие места и как это измерять.',
    deepenFocus:
      'Углубить профилирование, сравнение вариантов и компромиссы производительности.',
  },
  {
    title: 'Отладка и диагностика',
    aliases: ['debug', 'отлад', 'console', 'trace'],
    advancedSignals: ['breakpoint', 'profiling', 'devtools', 'stack trace'],
    whatItIs: 'Инструменты и подходы, которые помогают разбираться с поведением системы.',
    addFocus:
      'Добавить практику диагностики, ключевые инструменты и типичные шаги при поиске проблемы.',
    deepenFocus:
      'Углубить системную отладку, анализ стеков, профилирование и воспроизведение багов.',
  },
]

const normalizeCorpus = (value: string): string =>
  ` ${normalizeWhitespace(value).toLocaleLowerCase('ru')} `

const joinAttachmentKnowledge = (attachments: NoteKnowledgeAttachment[]): string =>
  attachments
    .flatMap((attachment) => [
      attachment.extractedText ?? '',
      attachment.imageDescription ?? '',
      parseStringArray(attachment.keyTermsJson ?? '[]').join(' '),
      attachment.originalFileName ?? '',
    ])
    .join(' ')

const buildNoteCorpus = (note: NoteKnowledgeSnapshot): string =>
  normalizeCorpus(
    [
      note.categoryName ?? '',
      note.noteTitle,
      note.rawText,
      joinAttachmentKnowledge(note.attachments),
    ].join(' '),
  )

const includesAlias = (corpus: string, alias: string): boolean => {
  const normalizedAlias = normalizeCorpus(alias)
  return normalizedAlias.trim().length > 0 && corpus.includes(normalizedAlias)
}

const countSignals = (corpus: string, signals: string[]): number =>
  signals.reduce(
    (count, signal) => count + (includesAlias(corpus, signal) ? 1 : 0),
    0,
  )

const selectTopicCatalog = (targetNote: NoteKnowledgeSnapshot): LocalTopicEntry[] => {
  const categoryHint = normalizeCorpus(
    `${targetNote.categoryName ?? ''} ${targetNote.noteTitle} ${targetNote.rawText}`,
  )

  if (
    ['javascript', 'java script', 'js ', ' js', 'ecmascript', 'frontend', 'browser']
      .some((token) => includesAlias(categoryHint, token))
  ) {
    return [...JS_TOPIC_CATALOG, ...GENERIC_TOPIC_CATALOG]
  }

  return GENERIC_TOPIC_CATALOG
}

const buildLocalSuggestionReason = (
  title: string,
  targetNote: NoteKnowledgeSnapshot,
  kind: 'add' | 'deepen',
): string =>
  kind === 'add'
    ? `В заметке "${targetNote.noteTitle}" эта тема сейчас почти не раскрыта, но она хорошо дополняет текущую базу знаний по выбранному направлению.`
    : `Тема "${title}" уже просматривается в заметке "${targetNote.noteTitle}", но покрыта слишком поверхностно и просит более глубокого разбора.`

const buildLocalStudyTopicSuggestions = (
  input: BuildStudyTopicSuggestionsInput,
  targetNote: NoteKnowledgeSnapshot,
): SuggestNoteStudyTopicsResult | null => {
  const excludedTopicTitles = new Set(
    (input.excludedTopicTitles ?? []).map(normalizeTopicTitle),
  )
  const catalog = selectTopicCatalog(targetNote)
  const targetCorpus = buildNoteCorpus(targetNote)
  const otherCorpus = normalizeCorpus(
    input.notes
      .filter((note) => note.noteId !== input.targetNoteId)
      .map((note) => buildNoteCorpus(note))
      .join(' '),
  )

  const addSuggestions: NoteStudySuggestionItem[] = []
  const deepenCandidates: Array<NoteStudySuggestionItem & { score: number }> = []

  for (const entry of catalog) {
    const normalizedTitle = normalizeTopicTitle(entry.title)

    if (!normalizedTitle || excludedTopicTitles.has(normalizedTitle)) {
      continue
    }

    const targetHits = countSignals(targetCorpus, entry.aliases)
    const otherHits = countSignals(otherCorpus, entry.aliases)
    const advancedHits = countSignals(targetCorpus, entry.advancedSignals)

    if (targetHits === 0 && otherHits === 0) {
      addSuggestions.push({
        title: entry.title,
        kind: 'add',
        whatItIs: entry.whatItIs,
        whySuggested: buildLocalSuggestionReason(entry.title, targetNote, 'add'),
        recommendedFocus: entry.addFocus,
      })
      continue
    }

    if (targetHits > 0) {
      const needsDeepening = advancedHits === 0 || targetHits <= 1

      if (!needsDeepening) {
        continue
      }

      deepenCandidates.push({
        title: entry.title,
        kind: 'deepen',
        whatItIs: entry.whatItIs,
        whySuggested: buildLocalSuggestionReason(entry.title, targetNote, 'deepen'),
        recommendedFocus: entry.deepenFocus,
        score: targetHits + advancedHits,
      })
    }
  }

  const deepenSuggestions = deepenCandidates
    .sort((left, right) => left.score - right.score)
    .slice(0, TARGET_DEEPEN_TOPICS)
    .map(({ score: _score, ...suggestion }) => suggestion)

  const suggestions = [
    ...addSuggestions.slice(0, TARGET_ADD_TOPICS),
    ...deepenSuggestions,
  ]

  if (suggestions.length === 0) {
    return null
  }

  return {
    suggestions,
    model: 'local:study-topic-fallback',
    requestId: null,
    usage: null,
  }
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
  let lastAiError: AiServiceError | null = null

  for (let attempt = 0; attempt < MAX_SUGGESTION_ATTEMPTS; attempt += 1) {
    const dynamicExcludedTopicTitles = [
      ...excludedTopicTitles,
      ...topicsToAdd.map((suggestion) => suggestion.title),
      ...topicsToDeepen.map((suggestion) => suggestion.title),
    ]

    try {
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
    } catch (error) {
      if (error instanceof AiServiceError) {
        lastAiError = error
        continue
      }

      throw error
    }
  }

  const suggestions = [...topicsToAdd, ...topicsToDeepen]

  if (suggestions.length > 0) {
    return {
      model,
      requestId,
      usage,
      suggestions,
    }
  }

  const localFallback = buildLocalStudyTopicSuggestions(input, targetNote)

  if (localFallback) {
    return localFallback
  }

  if (lastAiError) {
    throw lastAiError
  }

  throw new AiServiceError(
    'Не удалось подобрать новые темы без повторов в рамках этой сессии. Попробуй ещё раз позже.',
    {
      status: 422,
      code: 'ai_invalid_response',
    },
  )
}
