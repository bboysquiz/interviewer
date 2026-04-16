import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'

import {
  buildInterviewWeakSpots,
  toWeakSpotQuestionInput,
  type InterviewWeakSpot,
} from '@/entities/interview'
import { knowledgeBaseApi } from '@/services/client/knowledgeBaseApi'
import { API_BASE_URL } from '@/services/api'
import { useInterviewHistoryStore } from '@/stores/interviewHistory'
import { useKnowledgeBaseStore } from '@/stores/knowledgeBase'
import { useNotesStore } from '@/stores/notes'
import type {
  EvaluateInterviewAnswerResponse,
  GenerateInterviewQuestionInput,
  GenerateInterviewQuestionResponse,
  InterviewQuestionSource,
} from '@/types'

import type { InterviewModeOption, InterviewPracticeMode } from './types'

type InterviewPracticeSection = 'full' | 'weak_spots' | 'quick'

interface InterviewSectionOption {
  id: InterviewPracticeSection
  title: string
  description: string
}

interface QuestionProviderInfo {
  id: 'gemini' | 'groq' | 'other'
  label: string
  modelName: string | null
}

interface QuestionFoundationItem {
  id: string
  kind: 'text' | 'image' | 'mixed'
  text: string | null
  imageUrl: string | null
  lastQuestionedAt: string | null
  lastQuestionedLabel: string | null
}

interface FullInterviewEntry {
  question: GenerateInterviewQuestionResponse
  evaluation: EvaluateInterviewAnswerResponse | null
}

interface FullInterviewSessionState {
  startedAt: number
  completedAt: number | null
  input: GenerateInterviewQuestionInput
  entries: FullInterviewEntry[]
}

interface FullInterviewSummary {
  questionCount: number
  answeredCount: number
  averageKnowledgeBaseScore: number
  averageGeneralKnowledgeScore: number
  verdict: string
  commentary: string
  focusTips: string[]
}

interface BrowserSpeechRecognitionAlternative {
  transcript: string
}

interface BrowserSpeechRecognitionResult {
  isFinal: boolean
  length: number
  [index: number]: BrowserSpeechRecognitionAlternative
}

interface BrowserSpeechRecognitionResultList {
  length: number
  [index: number]: BrowserSpeechRecognitionResult
}

interface BrowserSpeechRecognitionEvent extends Event {
  resultIndex: number
  results: BrowserSpeechRecognitionResultList
}

interface BrowserSpeechRecognitionErrorEvent extends Event {
  error: string
}

interface BrowserSpeechRecognition extends EventTarget {
  continuous: boolean
  interimResults: boolean
  lang: string
  maxAlternatives: number
  onend: ((event: Event) => void) | null
  onerror: ((event: BrowserSpeechRecognitionErrorEvent) => void) | null
  onresult: ((event: BrowserSpeechRecognitionEvent) => void) | null
  onstart: ((event: Event) => void) | null
  abort: () => void
  start: () => void
  stop: () => void
}

type BrowserSpeechRecognitionConstructor = new () => BrowserSpeechRecognition

interface SpeechRecognitionWindow extends Window {
  SpeechRecognition?: BrowserSpeechRecognitionConstructor
  webkitSpeechRecognition?: BrowserSpeechRecognitionConstructor
}

const MODE_OPTIONS: InterviewModeOption[] = [
  {
    id: 'category',
    title: 'По категории',
    description: 'Быстрый вопрос по выбранной теме без лишних шагов.',
  },
  {
    id: 'note',
    title: 'По заметке',
    description: 'Точный вопрос по конкретной заметке или конспекту.',
  },
]

const SECTION_OPTIONS: InterviewSectionOption[] = [
  {
    id: 'full',
    title: 'Полный собес',
    description: 'Несколько вопросов подряд, таймер и общая сводка по сессии.',
  },
  {
    id: 'weak_spots',
    title: 'Слабые места',
    description: 'Повторение тем, где раньше были просадки в ответах.',
  },
  {
    id: 'quick',
    title: 'Быстрая тренировка',
    description: 'Один вопрос и мгновенная проверка без длинной сессии.',
  },
]

const FULL_INTERVIEW_QUESTION_TARGET = 5

const buildGenerationErrorMessage = (
  mode: InterviewPracticeMode,
): string =>
  mode === 'category'
    ? 'Выбери категорию перед генерацией вопроса.'
    : 'Выбери категорию и заметку перед генерацией вопроса.'

const toProviderInfo = (rawModel: string | null | undefined): QuestionProviderInfo | null => {
  const normalizedRawModel = rawModel?.trim() ?? ''

  if (!normalizedRawModel) {
    return null
  }

  const [providerName, ...modelParts] = normalizedRawModel.split(':')
  const normalizedProvider = providerName.trim().toLowerCase()
  const modelName = modelParts.join(':').trim() || normalizedRawModel

  if (normalizedProvider === 'gemini') {
    return {
      id: 'gemini',
      label: 'Gemini',
      modelName,
    }
  }

  if (normalizedProvider === 'groq') {
    return {
      id: 'groq',
      label: 'Groq',
      modelName,
    }
  }

  return {
    id: 'other',
    label: normalizedRawModel,
    modelName: null,
  }
}

const stripSourceNoise = (source: InterviewQuestionSource): string => {
  let value = source.content.trim()

  value = value.replace(/^Screenshot file:.*(?:\r?\n|$)/i, '')

  if (source.sourceType === 'attachment_extracted_text') {
    value = value.replace(/^Visible text:\s*/i, '')
  }

  if (source.sourceType === 'attachment_description') {
    value = value.replace(/^Key terms:\s*/i, '')
  }

  return value.trim()
}

const buildFoundationItems = (
  sources: InterviewQuestionSource[],
): QuestionFoundationItem[] => {
  const normalizedSources = sources.filter(
    (source) => source.sourceType !== 'note_title',
  )
  const groupedByAttachment = new Map<
    string,
    {
      imageUrl: string | null
      extractedText: string | null
      fallbackText: string | null
      lastQuestionedAt: string | null
    }
  >()
  const items: QuestionFoundationItem[] = []

  for (const source of normalizedSources) {
    if (source.attachmentId && source.attachmentStoragePath) {
      const group = groupedByAttachment.get(source.attachmentId) ?? {
        imageUrl: `${API_BASE_URL}${source.attachmentStoragePath}`,
        extractedText: null,
        fallbackText: null,
        lastQuestionedAt: source.lastQuestionedAt,
      }
      const cleanedText = stripSourceNoise(source)

      if (source.sourceType === 'attachment_extracted_text' && cleanedText) {
        group.extractedText = cleanedText
      } else if (!group.extractedText && !group.fallbackText && cleanedText) {
        group.fallbackText = cleanedText
      }

      if (
        source.lastQuestionedAt &&
        (!group.lastQuestionedAt ||
          Date.parse(source.lastQuestionedAt) > Date.parse(group.lastQuestionedAt))
      ) {
        group.lastQuestionedAt = source.lastQuestionedAt
      }

      groupedByAttachment.set(source.attachmentId, group)
      continue
    }

    if (source.sourceType !== 'note_content') {
      continue
    }

    const cleanedText = stripSourceNoise(source)

    if (!cleanedText) {
      continue
    }

    items.push({
      id: source.foundationKey,
      kind: 'text',
      text: cleanedText,
      imageUrl: null,
      lastQuestionedAt: source.lastQuestionedAt,
      lastQuestionedLabel: formatFoundationTimestamp(source.lastQuestionedAt),
    })
  }

  for (const [attachmentId, group] of groupedByAttachment.entries()) {
    const text = group.extractedText ?? group.fallbackText

    items.push({
      id: `attachment:${attachmentId}`,
      kind: group.imageUrl && text ? 'mixed' : group.imageUrl ? 'image' : 'text',
      text,
      imageUrl: group.imageUrl,
      lastQuestionedAt: group.lastQuestionedAt,
      lastQuestionedLabel: formatFoundationTimestamp(group.lastQuestionedAt),
    })
  }

  return items.slice(0, 6)
}

const buildQuestionHistoryKey = (
  input: GenerateInterviewQuestionInput,
): string =>
  [
    input.sourceType,
    input.categoryId ?? '',
    (input.noteIds ?? []).join(','),
  ].join('|')

const uniqueNonEmpty = (value: string[]): string[] =>
  [...new Set(value.map((item) => item.trim()).filter(Boolean))]

const foundationDateTimeFormatter = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

const formatFoundationTimestamp = (value: string | null): string | null => {
  if (!value) {
    return null
  }

  const timestamp = Date.parse(value)

  if (Number.isNaN(timestamp)) {
    return null
  }

  return foundationDateTimeFormatter.format(new Date(timestamp))
}

const formatDurationLabel = (valueMs: number): string => {
  const totalSeconds = Math.max(0, Math.floor(valueMs / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60

  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

const roundScore = (value: number): number => Math.round(value * 10) / 10

const buildFullInterviewSummary = (
  entries: FullInterviewEntry[],
): FullInterviewSummary | null => {
  const evaluatedEntries = entries.filter(
    (entry): entry is FullInterviewEntry & { evaluation: EvaluateInterviewAnswerResponse } =>
      entry.evaluation !== null,
  )

  if (evaluatedEntries.length === 0) {
    return null
  }

  const averageKnowledgeBaseScore =
    evaluatedEntries.reduce(
      (sum, entry) => sum + entry.evaluation.evaluation.knowledgeBase.score,
      0,
    ) / evaluatedEntries.length
  const averageGeneralKnowledgeScore =
    evaluatedEntries.reduce(
      (sum, entry) => sum + entry.evaluation.evaluation.generalKnowledge.score,
      0,
    ) / evaluatedEntries.length
  const averageCombinedScore =
    (averageKnowledgeBaseScore + averageGeneralKnowledgeScore) / 2

  const verdict =
    averageCombinedScore >= 8
      ? 'Сильная сессия'
      : averageCombinedScore >= 6
        ? 'Нормальная сессия'
        : 'Сессию стоит повторить'

  const commentary =
    averageCombinedScore >= 8
      ? 'Ответы в этой сессии в целом звучали уверенно. Следующий шаг — делать их плотнее и чуть короче.'
      : averageCombinedScore >= 6
        ? 'База есть, но часть формулировок еще можно сделать точнее. Полезно добить спорные места и прогнать сессию еще раз.'
        : 'В сессии накопилось много пробелов. Лучше пройтись по подсказкам ниже и потом повторить этот же набор тем.'

  const focusTips = uniqueNonEmpty(
    evaluatedEntries.flatMap((entry) => [
      entry.evaluation.evaluation.knowledgeBase.improvementTip,
      entry.evaluation.evaluation.generalKnowledge.improvementTip,
    ]),
  ).slice(0, 4)

  return {
    questionCount: entries.length,
    answeredCount: evaluatedEntries.length,
    averageKnowledgeBaseScore: roundScore(averageKnowledgeBaseScore),
    averageGeneralKnowledgeScore: roundScore(averageGeneralKnowledgeScore),
    verdict,
    commentary,
    focusTips,
  }
}

const joinTranscriptParts = (...parts: Array<string | null | undefined>): string =>
  parts
    .map((part) => part?.trim() ?? '')
    .filter(Boolean)
    .join(' ')
    .replace(/\s+([,.;!?])/g, '$1')
    .trim()

const getSpeechRecognitionConstructor = ():
  | BrowserSpeechRecognitionConstructor
  | null => {
  if (typeof window === 'undefined') {
    return null
  }

  const speechWindow = window as SpeechRecognitionWindow
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition ?? null
}

const getVoiceInputErrorMessage = (error: string): string => {
  switch (error) {
    case 'audio-capture':
      return 'Не удалось получить звук с микрофона.'
    case 'not-allowed':
    case 'service-not-allowed':
      return 'Браузер не дал доступ к микрофону.'
    case 'network':
      return 'Голосовой ввод не смог связаться со встроенным сервисом браузера.'
    case 'no-speech':
      return 'Речь не распознана. Попробуй сказать ответ ещё раз.'
    case 'aborted':
      return ''
    default:
      return 'Не удалось преобразовать речь в текст.'
  }
}

export const useInterviewPractice = () => {
  const knowledgeBaseStore = useKnowledgeBaseStore()
  const notesStore = useNotesStore()
  const historyStore = useInterviewHistoryStore()

  const {
    categories,
    isLoading: isCategoriesLoading,
    loadError: categoriesLoadError,
  } = storeToRefs(knowledgeBaseStore)
  const { notesByCategory, categoryLoadingState, categoryErrors } =
    storeToRefs(notesStore)
  const {
    records,
    isLoading: isHistoryLoading,
    loadError: historyLoadError,
  } = storeToRefs(historyStore)

  const interviewSection = ref<InterviewPracticeSection | null>(null)
  const interviewMode = ref<InterviewPracticeMode>('category')
  const selectedCategoryId = ref('')
  const selectedNoteId = ref('')
  const answerText = ref('')
  const isGenerating = ref(false)
  const isEvaluating = ref(false)
  const generationError = ref<string | null>(null)
  const evaluationError = ref<string | null>(null)
  const questionResponse = ref<GenerateInterviewQuestionResponse | null>(null)
  const evaluationResponse = ref<EvaluateInterviewAnswerResponse | null>(null)
  const isQuestionFoundationVisible = ref(false)
  const selectionQuestionHistory = ref<Record<string, string[]>>({})
  const fullInterviewSession = ref<FullInterviewSessionState | null>(null)
  const nowTimestamp = ref(Date.now())
  const isQuestionSpeechSupported = ref(false)
  const isAnswerVoiceSupported = ref(false)
  const isQuestionSpeaking = ref(false)
  const isListeningToAnswer = ref(false)
  const voiceFeatureError = ref<string | null>(null)
  let timerHandle: ReturnType<typeof setInterval> | null = null
  let answerRecognition: BrowserSpeechRecognition | null = null
  let answerVoiceBaseText = ''
  let activeQuestionUtterance: SpeechSynthesisUtterance | null = null

  const weakSpots = computed(() => buildInterviewWeakSpots(records.value))
  const hasCategories = computed(() => categories.value.length > 0)
  const selectedCategory = computed(
    () =>
      categories.value.find((category) => category.id === selectedCategoryId.value) ??
      null,
  )
  const availableNotes = computed(
    () => notesByCategory.value[selectedCategoryId.value] ?? [],
  )
  const selectedNote = computed(
    () => availableNotes.value.find((note) => note.id === selectedNoteId.value) ?? null,
  )
  const isNotesLoading = computed(
    () => categoryLoadingState.value[selectedCategoryId.value] ?? false,
  )
  const notesLoadError = computed(
    () => categoryErrors.value[selectedCategoryId.value] ?? null,
  )

  const canGenerateQuestion = computed(() => {
    if (isGenerating.value || isEvaluating.value) {
      return false
    }

    if (interviewMode.value === 'category') {
      return Boolean(selectedCategoryId.value)
    }

    return Boolean(selectedCategoryId.value && selectedNoteId.value)
  })

  const canEvaluateAnswer = computed(
    () =>
      Boolean(
        questionResponse.value &&
          answerText.value.trim() &&
          !isGenerating.value &&
          !isEvaluating.value,
      ),
  )

  const sourceSummary = computed(() => {
    if (interviewMode.value === 'category') {
      return selectedCategory.value
        ? `Вопрос будет построен по теме ${selectedCategory.value.name}.`
        : 'Выбери категорию, чтобы сгенерировать вопрос.'
    }

    if (selectedNote.value) {
      return `Для вопроса будет использована заметка «${selectedNote.value.title}».`
    }

    if (!selectedCategoryId.value) {
      return 'Сначала выбери категорию, затем заметку.'
    }

    if (isNotesLoading.value) {
      return 'Загружаем заметки для выбранной категории.'
    }

    return 'Выбери заметку, чтобы получить более точный вопрос.'
  })

  const questionSources = computed(
    () => questionResponse.value?.context.sources ?? [],
  )
  const questionFoundationItems = computed(() =>
    buildFoundationItems(questionSources.value),
  )
  const questionProvider = computed(() =>
    toProviderInfo(
      questionResponse.value?.ai.model ?? questionResponse.value?.question.model,
    ),
  )
  const evaluationProvider = computed(() =>
    toProviderInfo(
      evaluationResponse.value?.ai.model ??
        evaluationResponse.value?.evaluation.model,
    ),
  )
  const answerHelperText = computed(() => {
    const trimmedLength = answerText.value.trim().length
    return trimmedLength ? `${trimmedLength} символов` : ''
  })
  const canUseQuestionSpeech = computed(
    () => Boolean(questionResponse.value && isQuestionSpeechSupported.value),
  )
  const canUseAnswerVoiceInput = computed(
    () =>
      Boolean(
        questionResponse.value &&
          isAnswerVoiceSupported.value &&
          !isGenerating.value &&
          !isEvaluating.value,
      ),
  )
  const fullInterviewEntries = computed(
    () => fullInterviewSession.value?.entries ?? [],
  )
  const fullInterviewQuestionTarget = computed(
    () => FULL_INTERVIEW_QUESTION_TARGET,
  )
  const fullInterviewRemainingQuestions = computed(() =>
    Math.max(
      0,
      fullInterviewQuestionTarget.value - fullInterviewEntries.value.length,
    ),
  )
  const isFullInterviewActive = computed(
    () =>
      Boolean(
        fullInterviewSession.value && fullInterviewSession.value.completedAt === null,
      ),
  )
  const canStartFullInterview = computed(
    () => canGenerateQuestion.value && !isFullInterviewActive.value,
  )
  const canGenerateNextFullInterviewQuestion = computed(() => {
    if (!isFullInterviewActive.value || isGenerating.value || isEvaluating.value) {
      return false
    }

    if (fullInterviewRemainingQuestions.value <= 0) {
      return false
    }

    const latestEntry = fullInterviewEntries.value.at(-1) ?? null
    return Boolean(latestEntry?.evaluation)
  })
  const canFinishFullInterview = computed(
    () =>
      Boolean(
        fullInterviewSession.value &&
          !isGenerating.value &&
          !isEvaluating.value &&
          fullInterviewEntries.value.length > 0,
      ),
  )
  const fullInterviewElapsedLabel = computed(() => {
    const session = fullInterviewSession.value

    if (!session) {
      return '00:00'
    }

    const endTimestamp = session.completedAt ?? nowTimestamp.value
    return formatDurationLabel(endTimestamp - session.startedAt)
  })
  const fullInterviewSummary = computed(() =>
    fullInterviewSession.value?.completedAt
      ? buildFullInterviewSummary(fullInterviewEntries.value)
      : null,
  )

  const stopQuestionSpeech = (): void => {
    if (typeof window === 'undefined' || !isQuestionSpeechSupported.value) {
      return
    }

    window.speechSynthesis.cancel()
    activeQuestionUtterance = null
    isQuestionSpeaking.value = false
  }

  const stopAnswerListening = (): void => {
    if (!answerRecognition) {
      isListeningToAnswer.value = false
      return
    }

    answerRecognition.stop()
    answerRecognition = null
    isListeningToAnswer.value = false
  }

  const stopVoiceFeatures = (): void => {
    stopQuestionSpeech()
    stopAnswerListening()
  }

  const speakQuestion = (): void => {
    if (
      typeof window === 'undefined' ||
      !questionResponse.value ||
      !isQuestionSpeechSupported.value
    ) {
      return
    }

    voiceFeatureError.value = null

    if (isQuestionSpeaking.value) {
      stopQuestionSpeech()
      return
    }

    stopAnswerListening()
    stopQuestionSpeech()

    const utterance = new SpeechSynthesisUtterance(questionResponse.value.question.prompt)
    const availableVoices = window.speechSynthesis.getVoices()
    const preferredVoice =
      availableVoices.find((voice) => voice.lang.toLowerCase().startsWith('ru')) ??
      availableVoices.find((voice) => voice.default) ??
      null

    utterance.lang = preferredVoice?.lang ?? 'ru-RU'
    utterance.voice = preferredVoice
    utterance.rate = 1
    utterance.pitch = 1
    utterance.onend = () => {
      if (activeQuestionUtterance === utterance) {
        activeQuestionUtterance = null
      }
      isQuestionSpeaking.value = false
    }
    utterance.onerror = () => {
      if (activeQuestionUtterance === utterance) {
        activeQuestionUtterance = null
      }
      isQuestionSpeaking.value = false
      voiceFeatureError.value = 'Не удалось озвучить вопрос в этом браузере.'
    }

    activeQuestionUtterance = utterance
    isQuestionSpeaking.value = true

    try {
      window.speechSynthesis.speak(utterance)
    } catch {
      activeQuestionUtterance = null
      isQuestionSpeaking.value = false
      voiceFeatureError.value = 'Не удалось запустить озвучку вопроса.'
    }
  }

  const startAnswerListening = (): void => {
    if (!questionResponse.value || !isAnswerVoiceSupported.value) {
      return
    }

    const Recognition = getSpeechRecognitionConstructor()

    if (!Recognition) {
      isAnswerVoiceSupported.value = false
      voiceFeatureError.value = 'Голосовой ввод не поддерживается в этом браузере.'
      return
    }

    voiceFeatureError.value = null
    stopQuestionSpeech()
    stopAnswerListening()

    const recognition = new Recognition()
    answerVoiceBaseText = answerText.value
    recognition.lang = 'ru-RU'
    recognition.continuous = true
    recognition.interimResults = true
    recognition.maxAlternatives = 1
    recognition.onstart = () => {
      isListeningToAnswer.value = true
    }
    recognition.onresult = (event) => {
      const transcriptParts: string[] = []

      for (let index = 0; index < event.results.length; index += 1) {
        const transcript = event.results[index]?.[0]?.transcript?.trim()

        if (transcript) {
          transcriptParts.push(transcript)
        }
      }

      answerText.value = joinTranscriptParts(
        answerVoiceBaseText,
        transcriptParts.join(' '),
      )
    }
    recognition.onerror = (event) => {
      const message = getVoiceInputErrorMessage(event.error)

      if (message) {
        voiceFeatureError.value = message
      }
    }
    recognition.onend = () => {
      answerRecognition = null
      isListeningToAnswer.value = false
    }

    answerRecognition = recognition

    try {
      recognition.start()
    } catch {
      answerRecognition = null
      isListeningToAnswer.value = false
      voiceFeatureError.value = 'Не удалось запустить голосовой ввод.'
    }
  }

  const toggleAnswerListening = (): void => {
    voiceFeatureError.value = null

    if (isListeningToAnswer.value) {
      stopAnswerListening()
      return
    }

    startAnswerListening()
  }

  const ensureValidCategorySelection = (): void => {
    if (!categories.value.length) {
      selectedCategoryId.value = ''
      return
    }

    const hasSelectedCategory = categories.value.some(
      (category) => category.id === selectedCategoryId.value,
    )

    if (!hasSelectedCategory) {
      selectedCategoryId.value = categories.value[0].id
    }
  }

  const resetInterviewFlow = (): void => {
    stopVoiceFeatures()
    questionResponse.value = null
    evaluationResponse.value = null
    answerText.value = ''
    generationError.value = null
    evaluationError.value = null
    isQuestionFoundationVisible.value = false
    voiceFeatureError.value = null
  }

  const resetFullInterviewSession = (): void => {
    fullInterviewSession.value = null
  }

  const loadNotesForSelectedCategory = async (): Promise<void> => {
    if (!selectedCategoryId.value) {
      return
    }

    try {
      await notesStore.loadNotesByCategory(selectedCategoryId.value)
    } catch {
      // The page uses the store error state if loading fails.
    }
  }

  const reloadCategories = async (): Promise<void> => {
    await knowledgeBaseStore.loadCategories()
  }

  const applyQuestionInputSelection = async (
    input: GenerateInterviewQuestionInput,
  ): Promise<void> => {
    if (input.sourceType === 'category') {
      interviewMode.value = 'category'

      if (input.categoryId) {
        selectedCategoryId.value = input.categoryId
      }

      selectedNoteId.value = ''
      return
    }

    if (input.sourceType === 'note') {
      interviewMode.value = 'note'

      if (input.categoryId) {
        selectedCategoryId.value = input.categoryId
        await loadNotesForSelectedCategory()
      }

      selectedNoteId.value = input.noteIds?.[0] ?? ''
      return
    }

    if (input.categoryId) {
      selectedCategoryId.value = input.categoryId
    }
  }

  const rememberGeneratedQuestion = (
    input: GenerateInterviewQuestionInput,
    prompt: string,
  ): void => {
    const key = buildQuestionHistoryKey(input)
    const previousQuestions = selectionQuestionHistory.value[key] ?? []

    selectionQuestionHistory.value[key] = uniqueNonEmpty([
      ...previousQuestions,
      prompt,
    ]).slice(-12)
  }

  const getPreviousQuestionsForInput = (
    input: GenerateInterviewQuestionInput,
  ): string[] => selectionQuestionHistory.value[buildQuestionHistoryKey(input)] ?? []

  const requestQuestion = async (
    input: GenerateInterviewQuestionInput,
  ): Promise<GenerateInterviewQuestionResponse | null> => {
    stopVoiceFeatures()
    isGenerating.value = true
    generationError.value = null
    evaluationError.value = null
    evaluationResponse.value = null
    answerText.value = ''
    isQuestionFoundationVisible.value = false
    voiceFeatureError.value = null

    try {
      const response = await knowledgeBaseApi.generateInterviewQuestion(input)
      questionResponse.value = response
      return response
    } catch (error) {
      generationError.value =
        error instanceof Error
          ? error.message
          : 'Не удалось сгенерировать вопрос.'
      return null
    } finally {
      isGenerating.value = false
    }
  }

  const buildSelectedQuestionInput = (): GenerateInterviewQuestionInput | null => {
    if (interviewMode.value === 'category') {
      if (!selectedCategoryId.value) {
        return null
      }

      return {
        sourceType: 'category',
        categoryId: selectedCategoryId.value,
        title: selectedCategory.value
          ? `Практика: ${selectedCategory.value.name}`
          : null,
      }
    }

    if (!selectedCategoryId.value || !selectedNoteId.value) {
      return null
    }

    return {
      sourceType: 'note',
      categoryId: selectedCategoryId.value,
      noteIds: [selectedNoteId.value],
      title: selectedNote.value?.title ?? null,
    }
  }

  const generateQuestion = async (): Promise<void> => {
    const baseInput = buildSelectedQuestionInput()

    if (!baseInput) {
      generationError.value = buildGenerationErrorMessage(interviewMode.value)
      return
    }

    const input: GenerateInterviewQuestionInput = {
      ...baseInput,
      previousQuestions: getPreviousQuestionsForInput(baseInput),
    }
    const response = await requestQuestion(input)

    if (!response) {
      return
    }

    rememberGeneratedQuestion(baseInput, response.question.prompt)
  }

  const startFullInterview = async (): Promise<void> => {
    const baseInput = buildSelectedQuestionInput()

    if (!baseInput) {
      generationError.value = buildGenerationErrorMessage(interviewMode.value)
      return
    }

    resetInterviewFlow()
    interviewSection.value = 'full'
    fullInterviewSession.value = {
      startedAt: Date.now(),
      completedAt: null,
      input: baseInput,
      entries: [],
    }

    const response = await requestQuestion({
      ...baseInput,
      previousQuestions: [],
    })

    if (!response) {
      resetFullInterviewSession()
      return
    }

    fullInterviewSession.value.entries.push({
      question: response,
      evaluation: null,
    })
  }

  const generateNextFullInterviewQuestion = async (): Promise<void> => {
    const session = fullInterviewSession.value

    if (!session || session.completedAt !== null) {
      return
    }

    const previousQuestions = session.entries.map(
      (entry) => entry.question.question.prompt,
    )
    const response = await requestQuestion({
      ...session.input,
      previousQuestions,
    })

    if (!response) {
      return
    }

    session.entries.push({
      question: response,
      evaluation: null,
    })
  }

  const finishFullInterview = (): void => {
    if (!fullInterviewSession.value || fullInterviewSession.value.completedAt !== null) {
      return
    }

    fullInterviewSession.value = {
      ...fullInterviewSession.value,
      completedAt: Date.now(),
    }
  }

  const repeatWeakSpot = async (weakSpot: InterviewWeakSpot): Promise<void> => {
    const input = {
      ...toWeakSpotQuestionInput(weakSpot),
      previousQuestions: [],
    }

    interviewSection.value = 'quick'
    await applyQuestionInputSelection(input)
    const response = await requestQuestion(input)

    if (!response) {
      return
    }

    rememberGeneratedQuestion(input, response.question.prompt)
  }

  const evaluateAnswer = async (): Promise<void> => {
    stopAnswerListening()

    if (!questionResponse.value) {
      evaluationError.value = 'Сначала сгенерируй вопрос.'
      return
    }

    if (!answerText.value.trim()) {
      evaluationError.value = 'Напиши ответ перед проверкой.'
      return
    }

    isEvaluating.value = true
    evaluationError.value = null

    try {
      const response = await knowledgeBaseApi.evaluateInterviewAnswer({
        sessionId: questionResponse.value.session.id,
        questionId: questionResponse.value.question.id,
        answerText: answerText.value.trim(),
      })

      evaluationResponse.value = response
      questionResponse.value = {
        ...questionResponse.value,
        session: response.session,
        question: response.question,
      }

      const activeFullInterviewEntry = fullInterviewSession.value?.entries.at(-1) ?? null

      if (
        activeFullInterviewEntry &&
        activeFullInterviewEntry.question.question.id === response.question.id &&
        activeFullInterviewEntry.evaluation === null
      ) {
        activeFullInterviewEntry.evaluation = response
      }

      void historyStore.loadHistory({ force: true }).catch(() => {
        // The current result stays visible even if history refresh fails.
      })
    } catch (error) {
      evaluationError.value =
        error instanceof Error ? error.message : 'Не удалось проверить ответ.'
    } finally {
      isEvaluating.value = false
    }
  }

  const toggleQuestionFoundation = (): void => {
    isQuestionFoundationVisible.value = !isQuestionFoundationVisible.value
  }

  const openInterviewSection = (section: InterviewPracticeSection): void => {
    if (section !== 'weak_spots') {
      interviewMode.value = 'category'
      selectedNoteId.value = ''
    }

    interviewSection.value = section
  }

  const closeInterviewSection = (): void => {
    stopVoiceFeatures()
    voiceFeatureError.value = null
    interviewSection.value = null
  }

  watch(
    categories,
    () => {
      ensureValidCategorySelection()
    },
    { immediate: true },
  )

  watch(interviewMode, async (nextMode, previousMode) => {
    if (nextMode === previousMode) {
      return
    }

    resetInterviewFlow()
    resetFullInterviewSession()

    if (nextMode === 'note' && selectedCategoryId.value) {
      await loadNotesForSelectedCategory()
    }
  })

  watch(selectedCategoryId, async (nextCategoryId, previousCategoryId) => {
    if (nextCategoryId === previousCategoryId) {
      return
    }

    selectedNoteId.value = ''
    resetInterviewFlow()
    resetFullInterviewSession()

    if (interviewMode.value === 'note' && nextCategoryId) {
      await loadNotesForSelectedCategory()
    }
  })

  watch(selectedNoteId, (nextNoteId, previousNoteId) => {
    if (nextNoteId !== previousNoteId) {
      resetInterviewFlow()
      resetFullInterviewSession()
    }
  })

  watch(answerText, (nextValue, previousValue) => {
    if (evaluationError.value && nextValue.trim() !== previousValue.trim()) {
      evaluationError.value = null
    }

    if (evaluationResponse.value && nextValue.trim() !== previousValue.trim()) {
      evaluationResponse.value = null
    }
  })

  onMounted(async () => {
    timerHandle = setInterval(() => {
      nowTimestamp.value = Date.now()
    }, 1000)

    isQuestionSpeechSupported.value =
      typeof window !== 'undefined' && 'speechSynthesis' in window
    isAnswerVoiceSupported.value = getSpeechRecognitionConstructor() !== null

    try {
      if (!knowledgeBaseStore.hasLoaded) {
        await knowledgeBaseStore.loadCategories()
      }
    } catch {
      // The page uses the store error state if loading fails.
    }

    try {
      await historyStore.loadHistory()
    } catch {
      // Weak spots are optional for the page to work.
    }

    ensureValidCategorySelection()
  })

  onBeforeUnmount(() => {
    stopVoiceFeatures()

    if (timerHandle) {
      clearInterval(timerHandle)
      timerHandle = null
    }
  })

  return {
    answerHelperText,
    answerText,
    availableNotes,
    canEvaluateAnswer,
    canFinishFullInterview,
    canGenerateNextFullInterviewQuestion,
    canGenerateQuestion,
    canStartFullInterview,
    canUseAnswerVoiceInput,
    canUseQuestionSpeech,
    categories,
    categoriesLoadError,
    evaluationError,
    evaluationProvider,
    evaluationResponse,
    finishFullInterview,
    fullInterviewElapsedLabel,
    fullInterviewEntries,
    fullInterviewQuestionTarget,
    fullInterviewRemainingQuestions,
    fullInterviewSummary,
    generateNextFullInterviewQuestion,
    generateQuestion,
    generationError,
    hasCategories,
    historyLoadError,
    interviewMode,
    interviewSection,
    openInterviewSection,
    closeInterviewSection,
    isCategoriesLoading,
    isEvaluating,
    isFullInterviewActive,
    isGenerating,
    isHistoryLoading,
    isListeningToAnswer,
    isNotesLoading,
    isQuestionFoundationVisible,
    isQuestionSpeaking,
    modeOptions: MODE_OPTIONS,
    notesLoadError,
    questionFoundationItems,
    questionProvider,
    questionResponse,
    questionSources,
    reloadCategories,
    repeatWeakSpot,
    sectionOptions: SECTION_OPTIONS,
    selectedCategory,
    selectedCategoryId,
    selectedNote,
    selectedNoteId,
    sourceSummary,
    startFullInterview,
    speakQuestion,
    toggleAnswerListening,
    toggleQuestionFoundation,
    voiceFeatureError,
    weakSpots,
    evaluateAnswer,
  }
}
