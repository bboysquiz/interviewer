<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useRoute, useRouter } from 'vue-router'

import {
  clearContextualFooter,
  setContextualFooter,
} from '@/features/navigation/contextualFooter'
import NoteForm from '@/features/notes/NoteForm.vue'
import type { ImportedAppleNoteDraft } from '@/features/notes/appleNotesImport'
import { parseAppleNotesImportFiles } from '@/features/notes/appleNotesImport'
import {
  applyUploadedAttachmentsToBlocks,
  cloneNoteFormValues,
  createEmptyNoteForm,
  createNoteFormFingerprint,
  createNoteFormFromNote,
  createTextBlock,
  revokeFormPreviewUrls,
  toCreateNoteInput,
  toUpdateNoteInput,
  type NoteFormBlock,
  type NoteFormImageBlock,
  type NoteFormValues,
} from '@/features/notes/noteForm'
import { formatDateTime } from '@/shared/lib/format'
import AppNotice from '@/shared/ui/AppNotice.vue'
import SurfaceCard from '@/shared/ui/SurfaceCard.vue'
import { useAttachmentsStore } from '@/stores/attachments'
import { useKnowledgeBaseStore } from '@/stores/knowledgeBase'
import { useNotesStore } from '@/stores/notes'
import type { Attachment, Note } from '@/types'

type ImportableFile = File & {
  importRelativePath?: string
}

type WindowWithDirectoryPicker = Window & {
  showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle>
}

type FileSystemDirectoryHandleWithEntries = FileSystemDirectoryHandle & {
  entries: () => AsyncIterableIterator<[string, FileSystemHandle]>
}

interface FailedAttachmentReasonSummary {
  key: string
  label: string
  count: number
}

interface NoteSearchMatch {
  id: string
  blockId: string
  blockType: 'text' | 'image'
  label: string
  preview: string
  selectionStart: number | null
  selectionEnd: number | null
}

interface NoteFormSearchHandle {
  focusSearchTarget: (target: {
    blockId: string
    selectionStart?: number | null
    selectionEnd?: number | null
    focus?: boolean
  }) => Promise<void>
}

interface LocalSectionDraft {
  id: string
  title: string
  isEditing: boolean
}

const AUTOSAVE_DELAY_MS = 2000
const MAX_UNDO_STEPS = 40

const normalizeProcessingError = (
  value: string | null,
): Omit<FailedAttachmentReasonSummary, 'count'> => {
  const normalized = value?.trim() ?? ''
  const lowerCased = normalized.toLowerCase()

  if (!normalized) {
    return {
      key: 'unknown',
      label: 'Причина не записалась в статусе вложения',
    }
  }

  if (
    ['request too large', 'context length', 'tokens per minute', 'tpm'].some(
      (pattern) => lowerCased.includes(pattern),
    )
  ) {
    return {
      key: 'context_too_large',
      label: 'Контекст или пакет данных слишком большой для текущей модели',
    }
  }

  if (
    [
      'quota',
      'rate limit',
      'resource exhausted',
      'too many requests',
      'exceeded your current quota',
    ].some((pattern) => lowerCased.includes(pattern))
  ) {
    return {
      key: 'quota',
      label: 'AI-провайдер упёрся в лимит или квоту',
    }
  }

  if (
    ['timeout', 'timed out', 'aborterror'].some((pattern) =>
      lowerCased.includes(pattern),
    )
  ) {
    return {
      key: 'timeout',
      label: 'AI-провайдер не ответил вовремя',
    }
  }

  if (
    ['user location is not supported', 'unsupported region'].some((pattern) =>
      lowerCased.includes(pattern),
    )
  ) {
    return {
      key: 'region',
      label: 'Провайдер отклонил запрос из-за региона',
    }
  }

  if (
    ['enoent', 'no such file', 'not found'].some((pattern) =>
      lowerCased.includes(pattern),
    )
  ) {
    return {
      key: 'file_missing',
      label: 'Файл скриншота не найден на диске',
    }
  }

  if (
    ['dns', 'econnrefused', 'enotfound', 'fetch failed'].some((pattern) =>
      lowerCased.includes(pattern),
    )
  ) {
    return {
      key: 'network',
      label: 'Сбой сети или DNS при обращении к AI-провайдеру',
    }
  }

  return {
    key: normalized,
    label: normalized,
  }
}

const pluralizeScreenshots = (count: number): string => {
  const remainderTen = count % 10
  const remainderHundred = count % 100

  if (remainderTen === 1 && remainderHundred !== 11) {
    return 'скриншот'
  }

  if (
    remainderTen >= 2 &&
    remainderTen <= 4 &&
    (remainderHundred < 12 || remainderHundred > 14)
  ) {
    return 'скриншота'
  }

  return 'скриншотов'
}

const formatAiModelLabel = (value: string | null | undefined): string | null => {
  const normalized = value?.trim() ?? ''

  if (!normalized) {
    return null
  }

  const separatorIndex = normalized.indexOf(':')

  if (separatorIndex <= 0) {
    return normalized
  }

  const provider = normalized.slice(0, separatorIndex)
  const model = normalized.slice(separatorIndex + 1)
  const providerLabel =
    provider === 'gemini'
      ? 'Gemini'
      : provider === 'groq'
        ? 'Groq'
        : provider === 'openai'
          ? 'OpenAI'
          : provider

  return `${providerLabel} · ${model}`
}

const formatAiModelLabels = (
  values: Array<string | null | undefined>,
): string | null => {
  const labels = [
    ...new Set(
      values
        .map((value) => formatAiModelLabel(value))
        .filter((value): value is string => Boolean(value)),
    ),
  ]

  if (labels.length === 0) {
    return null
  }

  return labels.join(', ')
}

const normalizeSearchValue = (value: string): string =>
  value.toLocaleLowerCase('ru').trim()

const buildSearchPreview = (
  source: string,
  matchStart: number,
  matchLength: number,
): string => {
  const previewStart = Math.max(0, matchStart - 42)
  const previewEnd = Math.min(source.length, matchStart + matchLength + 72)
  const prefix = previewStart > 0 ? '…' : ''
  const suffix = previewEnd < source.length ? '…' : ''

  return `${prefix}${source.slice(previewStart, previewEnd).trim()}${suffix}`
}

const collectTextMatchOffsets = (source: string, query: string): number[] => {
  if (!query) {
    return []
  }

  const offsets: number[] = []
  let fromIndex = 0

  while (fromIndex < source.length) {
    const matchIndex = source.indexOf(query, fromIndex)

    if (matchIndex < 0) {
      break
    }

    offsets.push(matchIndex)
    fromIndex = matchIndex + Math.max(query.length, 1)
  }

  return offsets
}

const findAttachmentSearchHit = (
  attachment: Attachment | null,
  query: string,
): { label: string; preview: string } | null => {
  if (!attachment || !query) {
    return null
  }

  const candidates = [
    {
      label: 'Скриншот: текст',
      value: attachment.extractedText ?? '',
    },
    {
      label: 'Скриншот: описание',
      value: attachment.imageDescription ?? '',
    },
    {
      label: 'Скриншот: ключевые слова',
      value: attachment.keyTerms.join(', '),
    },
  ]

  for (const candidate of candidates) {
    const normalizedValue = normalizeSearchValue(candidate.value)

    if (!normalizedValue) {
      continue
    }

    const matchIndex = normalizedValue.indexOf(query)

    if (matchIndex < 0) {
      continue
    }

    return {
      label: candidate.label,
      preview: buildSearchPreview(candidate.value, matchIndex, query.length),
    }
  }

  return null
}

const createLocalSectionDraftId = (): string => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }

  return `local-section-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

const route = useRoute()
const router = useRouter()
const knowledgeBaseStore = useKnowledgeBaseStore()
const notesStore = useNotesStore()
const attachmentsStore = useAttachmentsStore()

const { categories, hasLoaded } = storeToRefs(knowledgeBaseStore)
const {
  attachmentsById,
  attachmentsByNote,
  noteLoadingState: attachmentLoadingState,
  noteErrors: attachmentNoteErrors,
  analysisLoadingState,
} = storeToRefs(attachmentsStore)

const categoryId = computed(() =>
  typeof route.params.categoryId === 'string' ? route.params.categoryId : '',
)

const category = computed(
  () =>
    categories.value.find((currentCategory) => currentCategory.id === categoryId.value) ??
    null,
)

const notes = computed(() => notesStore.notesByCategory[categoryId.value] ?? [])
const notebookNote = computed<Note | null>(() => notes.value[0] ?? null)
const isLoading = computed(
  () => notesStore.categoryLoadingState[categoryId.value] ?? false,
)
const loadError = computed(
  () => notesStore.categoryErrors[categoryId.value] ?? null,
)
const notebookAttachments = computed(() =>
  notebookNote.value ? attachmentsByNote.value[notebookNote.value.id] ?? [] : [],
)
const notebookReferencedAttachmentIds = computed(() =>
  notebookForm.value.blocks
    .filter((block): block is NoteFormImageBlock => block.type === 'image')
    .map((block) => block.attachmentId)
    .filter((attachmentId): attachmentId is string => Boolean(attachmentId)),
)
const referencedNotebookAttachments = computed(() => {
  const referencedIds = new Set(notebookReferencedAttachmentIds.value)

  return notebookAttachments.value.filter((attachment) =>
    referencedIds.has(attachment.id),
  )
})
const areAttachmentsLoading = computed(() =>
  notebookNote.value
    ? attachmentLoadingState.value[notebookNote.value.id] ?? false
    : false,
)
const attachmentsLoadError = computed(() =>
  notebookNote.value ? attachmentNoteErrors.value[notebookNote.value.id] ?? null : null,
)

const notebookForm = ref(createEmptyNoteForm())
const saveError = ref<string | null>(null)
const importError = ref<string | null>(null)
const importSummary = ref<string | null>(null)
const pendingImportSummary = ref<string | null>(null)
const noteAnalysisError = ref<string | null>(null)
const noteAnalysisSummary = ref<string | null>(null)
const noteAnalysisModelLabel = ref<string | null>(null)
const aiOrganizeError = ref<string | null>(null)
const aiOrganizeSummary = ref<string | null>(null)
const aiOrganizeModelLabel = ref<string | null>(null)
const localOrganizeError = ref<string | null>(null)
const localOrganizeSummary = ref<string | null>(null)
const localSectionDrafts = ref<LocalSectionDraft[]>([])
const isLocalSectionsModalOpen = ref(false)
const organizeError = aiOrganizeError
const organizeSummary = aiOrganizeSummary
const organizeModelLabel = aiOrganizeModelLabel
const noteFormRef = ref<NoteFormSearchHandle | null>(null)
const noteSearchInput = ref<HTMLInputElement | null>(null)
const noteSearchQuery = ref('')
const activeNoteSearchMatchIndex = ref(0)
const isSaving = ref(false)
const isImporting = ref(false)
const isAnalyzingNote = ref(false)
const organizationModeInFlight = ref<'ai' | 'local' | null>(null)
const importFolderInput = ref<HTMLInputElement | null>(null)
const undoStack = ref<NoteFormValues[]>([])
const previousSnapshot = ref(cloneNoteFormValues(notebookForm.value))
const lastSavedFingerprint = ref(createNoteFormFingerprint(notebookForm.value))
const lastSavedAt = ref<string | null>(null)
const isApplyingSnapshot = ref(false)
const isNotebookBootstrapPending = ref(false)
let analysisPollHandle: ReturnType<typeof setInterval> | null = null
let autosaveHandle: ReturnType<typeof setTimeout> | null = null

const showCategoryNotFound = computed(
  () => hasLoaded.value && !category.value && !isLoading.value,
)

const attachmentsInAnalysis = computed(() =>
  referencedNotebookAttachments.value.filter(
    (attachment) => attachment.processingStatus === 'processing',
  ),
)

const pendingAttachments = computed(() =>
  referencedNotebookAttachments.value.filter(
    (attachment) => attachment.processingStatus === 'pending',
  ),
)

const failedAttachments = computed(() =>
  referencedNotebookAttachments.value.filter(
    (attachment) => attachment.processingStatus === 'failed',
  ),
)

const noteAttachmentsNeedingAnalysis = computed(() =>
  referencedNotebookAttachments.value.filter(
    (attachment) =>
      attachment.processingStatus === 'pending' ||
      attachment.processingStatus === 'failed',
  ),
)

const failedAttachmentReasons = computed<FailedAttachmentReasonSummary[]>(() => {
  const groupedReasons = new Map<string, FailedAttachmentReasonSummary>()

  for (const attachment of failedAttachments.value) {
    const normalized = normalizeProcessingError(attachment.processingError)
    const existing = groupedReasons.get(normalized.key)

    if (existing) {
      existing.count += 1
      continue
    }

    groupedReasons.set(normalized.key, {
      ...normalized,
      count: 1,
    })
  }

  return [...groupedReasons.values()].sort((left, right) => {
    if (left.count !== right.count) {
      return right.count - left.count
    }

    return left.label.localeCompare(right.label, 'ru')
  })
})

const isAnyAttachmentRetryRunning = computed(() =>
  failedAttachments.value.some(
    (attachment) => analysisLoadingState.value[attachment.id] ?? false,
  ),
)

const hasScreenshotBlocks = computed(() =>
  notebookForm.value.blocks.some((block) => block.type === 'image'),
)

const screenshotBlocksWithoutAnalysis = computed(() =>
  notebookForm.value.blocks.filter((block): block is NoteFormImageBlock => {
    if (block.type !== 'image') {
      return false
    }

    if (!block.attachmentId) {
      return true
    }

    const attachment = attachmentsById.value[block.attachmentId]
    return !attachment || attachment.processingStatus !== 'ready'
  }),
)

const hasScreenshotBlocksWithoutAnalysis = computed(
  () => screenshotBlocksWithoutAnalysis.value.length > 0,
)

const isOrganizing = computed(() => organizationModeInFlight.value !== null)
const isLocalOrganizing = computed(() => organizationModeInFlight.value === 'local')
const savedLocalSectionTitles = computed(() =>
  localSectionDrafts.value
    .filter((draft) => !draft.isEditing)
    .map((draft) => draft.title.trim())
    .filter(Boolean),
)

const organizeBlockedReason = computed(() => {
  if (!hasScreenshotBlocksWithoutAnalysis.value) {
    return null
  }

  const count = screenshotBlocksWithoutAnalysis.value.length

  if (count === 1) {
    return 'Сначала проанализируй 1 скриншот темы. Пока он не готов, AI-сортировка заблокирована.'
  }

  return `Сначала проанализируй все скриншоты темы. Сейчас без AI-анализа ещё ${count} ${pluralizeScreenshots(count)}.`
})

const normalizedNoteSearchQuery = computed(() =>
  normalizeSearchValue(noteSearchQuery.value),
)

const noteSearchMatches = computed<NoteSearchMatch[]>(() => {
  const query = normalizedNoteSearchQuery.value

  if (!query) {
    return []
  }

  const matches: NoteSearchMatch[] = []

  for (const block of notebookForm.value.blocks) {
    if (block.type === 'text') {
      const normalizedText = normalizeSearchValue(block.text)

      if (!normalizedText) {
        continue
      }

      const offsets = collectTextMatchOffsets(normalizedText, query)

      offsets.forEach((offset, occurrenceIndex) => {
        matches.push({
          id: `${block.id}:text:${occurrenceIndex}`,
          blockId: block.id,
          blockType: 'text',
          label: 'Текст заметки',
          preview: buildSearchPreview(block.text, offset, query.length),
          selectionStart: offset,
          selectionEnd: offset + query.length,
        })
      })

      continue
    }

    const attachment = block.attachmentId
      ? attachmentsById.value[block.attachmentId] ?? null
      : null
    const hit = findAttachmentSearchHit(attachment, query)

    if (!hit) {
      continue
    }

    matches.push({
      id: `${block.id}:image`,
      blockId: block.id,
      blockType: 'image',
      label: hit.label,
      preview: hit.preview,
      selectionStart: null,
      selectionEnd: null,
    })
  }

  return matches
})

const searchMatchedBlockIds = computed(() => [
  ...new Set(noteSearchMatches.value.map((match) => match.blockId)),
])

const hasActiveNoteSearch = computed(
  () => normalizedNoteSearchQuery.value.length > 0,
)

const activeNoteSearchMatch = computed<NoteSearchMatch | null>(() => {
  if (!noteSearchMatches.value.length) {
    return null
  }

  const safeIndex =
    ((activeNoteSearchMatchIndex.value % noteSearchMatches.value.length) +
      noteSearchMatches.value.length) %
    noteSearchMatches.value.length

  return noteSearchMatches.value[safeIndex] ?? null
})

const noteSearchStatusLabel = computed(() => {
  if (!hasActiveNoteSearch.value) {
    return 'Поиск по заметке и распознанным скриншотам'
  }

  if (!noteSearchMatches.value.length) {
    return 'Ничего не найдено'
  }

  return `${activeNoteSearchMatchIndex.value + 1} из ${noteSearchMatches.value.length}`
})

const formFingerprint = computed(() => createNoteFormFingerprint(notebookForm.value))
const isDirty = computed(() => formFingerprint.value !== lastSavedFingerprint.value)
const canUndo = computed(() => undoStack.value.length > 0 && !isSaving.value)
const hasMeaningfulNotebookContent = computed(() =>
  notebookForm.value.blocks.some((block) =>
    block.type === 'image' ? true : block.text.trim().length > 0,
  ),
)

const saveStatusTone = computed<'saved' | 'unsaved' | 'saving' | 'error'>(() => {
  if (isSaving.value) {
    return 'saving'
  }

  if (saveError.value) {
    return 'error'
  }

  return isDirty.value ? 'unsaved' : 'saved'
})

const saveStatusLabel = computed(() => {
  if (isSaving.value) {
    return 'Сохраняем...'
  }

  if (saveError.value || isDirty.value) {
    return 'Не сохранено'
  }

  if (lastSavedAt.value) {
    return `Сохранено ${formatDateTime(lastSavedAt.value)}`
  }

  return 'Сохранено'
})

const analysisStatusTitle = computed(() => {
  const count = attachmentsInAnalysis.value.length

  if (count <= 1) {
    return 'AI анализирует скриншот темы'
  }

  return `AI анализирует ${count} скриншотов темы`
})

const legacyAnalysisStatusMessage = computed(() =>
  attachmentsInAnalysis.value.some(
    (attachment) => attachment.processingStatus === 'processing',
  )
    ? 'Извлекаем текст и краткое описание из скриншотов. Когда анализ завершится, вопросы начнут учитывать и их содержимое.'
    : 'Скриншоты уже прикреплены к теме и ждут своей очереди на анализ.',
)

void legacyAnalysisStatusMessage

const analysisStatusMessage = computed(
  () =>
    'Извлекаем текст и краткое описание из скриншотов. Когда анализ завершится, вопросы и AI-сортировка начнут лучше учитывать их содержимое.',
)

const pendingAnalysisMessage = computed(() => {
  const count = pendingAttachments.value.length

  if (!count) {
    return null
  }

  if (count === 1) {
    return 'Есть 1 скриншот без AI-анализа. Пока он не обработан, вопросы и упорядочивание конспекта будут опираться в основном на текст.'
  }

  return `Есть ${count} ${pluralizeScreenshots(count)} без AI-анализа. Пока они не обработаны, вопросы и упорядочивание конспекта будут опираться в основном на текст.`
})

const failedAnalysisMessage = computed(() => {
  const count = failedAttachments.value.length

  if (!count) {
    return null
  }

  if (count === 1) {
    return 'Один скриншот темы не прошёл анализ. Его можно переобработать.'
  }

  return `Не удалось обработать ${count} скриншотов темы. Пока они не будут переанализированы, вопросы будут строиться в основном по тексту.`
})

const buildNotebookTitle = (): string => category.value?.name.trim() || 'Тема'

const buildEmptyNotebookForm = (): NoteFormValues => ({
  ...createEmptyNoteForm(),
  title: buildNotebookTitle(),
})

const buildNotebookSyncKey = (note: Note | null): string | null =>
  note ? `${note.id}:${note.updatedAt}` : null

const nowAsIso = (): string => new Date().toISOString()

const stopAutosave = (): void => {
  if (autosaveHandle) {
    clearTimeout(autosaveHandle)
    autosaveHandle = null
  }
}

const stopAnalysisPolling = (): void => {
  if (analysisPollHandle) {
    clearInterval(analysisPollHandle)
    analysisPollHandle = null
  }
}

const startAnalysisPolling = (): void => {
  stopAnalysisPolling()

  if (!notebookNote.value || attachmentsInAnalysis.value.length === 0) {
    return
  }

  analysisPollHandle = setInterval(() => {
    void attachmentsStore.loadAttachmentsByNote(notebookNote.value?.id ?? '', {
      force: true,
    })
  }, 4000)
}

const applyFormSnapshot = (
  nextValue: NoteFormValues,
  options: {
    markAsSaved?: boolean
    savedAt?: string | null
    resetUndo?: boolean
    revokeCurrentPreviewUrls?: boolean
  } = {},
): void => {
  stopAutosave()

  isApplyingSnapshot.value = true

  if (options.revokeCurrentPreviewUrls) {
    revokeFormPreviewUrls(notebookForm.value)
  }

  notebookForm.value = cloneNoteFormValues(nextValue)
  previousSnapshot.value = cloneNoteFormValues(notebookForm.value)

  if (options.markAsSaved) {
    lastSavedFingerprint.value = createNoteFormFingerprint(notebookForm.value)
    lastSavedAt.value = options.savedAt ?? nowAsIso()
    saveError.value = null
  }

  if (options.resetUndo) {
    undoStack.value = []
  }

  isApplyingSnapshot.value = false
}

const hydrateFormFromNotebook = (
  note: Note | null,
  options: {
    resetUndo?: boolean
  } = {},
): void => {
  const nextValue = note ? createNoteFormFromNote(note) : buildEmptyNotebookForm()
  nextValue.title = buildNotebookTitle()

  applyFormSnapshot(nextValue, {
    markAsSaved: true,
    savedAt: note?.updatedAt ?? null,
    resetUndo: options.resetUndo ?? true,
    revokeCurrentPreviewUrls: true,
  })
}

const syncHeaderContext = (): void => {
  if (!category.value) {
    clearContextualFooter()
    return
  }

  setContextualFooter({
    title: category.value.name,
    onBack: () => {
      void router.push({
        name: 'categories',
      })
    },
  })
}

const focusNoteSearchInput = async (): Promise<void> => {
  await nextTick()
  noteSearchInput.value?.focus()
  noteSearchInput.value?.select()
}

const focusActiveNoteSearchMatch = async (
  options: { focusEditor?: boolean } = {},
): Promise<void> => {
  const activeMatch = activeNoteSearchMatch.value

  if (!activeMatch) {
    return
  }

  await noteFormRef.value?.focusSearchTarget({
    blockId: activeMatch.blockId,
    selectionStart: activeMatch.selectionStart,
    selectionEnd: activeMatch.selectionEnd,
    focus: options.focusEditor ?? false,
  })
}

const moveActiveNoteSearchMatch = (direction: 1 | -1): void => {
  if (!noteSearchMatches.value.length) {
    return
  }

  activeNoteSearchMatchIndex.value =
    ((activeNoteSearchMatchIndex.value + direction) % noteSearchMatches.value.length +
      noteSearchMatches.value.length) %
    noteSearchMatches.value.length
}

const clearNoteSearch = (): void => {
  noteSearchQuery.value = ''
  activeNoteSearchMatchIndex.value = 0
}

const openLocalSectionsModal = (): void => {
  isLocalSectionsModalOpen.value = true

  if (localSectionDrafts.value.length === 0) {
    localSectionDrafts.value = [
      {
        id: createLocalSectionDraftId(),
        title: '',
        isEditing: true,
      },
    ]
  }
}

const closeLocalSectionsModal = (): void => {
  isLocalSectionsModalOpen.value = false
}

const addLocalSectionDraft = (): void => {
  localSectionDrafts.value.push({
    id: createLocalSectionDraftId(),
    title: '',
    isEditing: true,
  })
}

const updateLocalSectionDraftTitle = (draftId: string, value: string): void => {
  localSectionDrafts.value = localSectionDrafts.value.map((draft) =>
    draft.id === draftId
      ? {
          ...draft,
          title: value,
        }
      : draft,
  )
}

const saveLocalSectionDraft = (draftId: string): void => {
  localSectionDrafts.value = localSectionDrafts.value
    .map((draft) => {
      if (draft.id !== draftId) {
        return draft
      }

      return {
        ...draft,
        title: draft.title.trim().replace(/\s+/gu, ' ').slice(0, 80),
        isEditing: false,
      }
    })
    .filter((draft) => draft.title.length > 0)
}

const editLocalSectionDraft = (draftId: string): void => {
  localSectionDrafts.value = localSectionDrafts.value.map((draft) =>
    draft.id === draftId
      ? {
          ...draft,
          isEditing: true,
        }
      : draft,
  )
}

const removeLocalSectionDraft = (draftId: string): void => {
  localSectionDrafts.value = localSectionDrafts.value.filter(
    (draft) => draft.id !== draftId,
  )
}

const localSectionDraftCanSave = (draft: LocalSectionDraft): boolean =>
  draft.title.trim().length > 0

const handleCategoryPageKeydown = (event: KeyboardEvent): void => {
  if (event.key === 'Escape' && isLocalSectionsModalOpen.value) {
    event.preventDefault()
    closeLocalSectionsModal()
    return
  }

  if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'f') {
    event.preventDefault()
    void focusNoteSearchInput()
  }
}

const loadNotebook = async (force = false): Promise<void> => {
  if (!categoryId.value) {
    isNotebookBootstrapPending.value = false
    return
  }

  const requestedCategoryId = categoryId.value

  try {
    const loadedNotes = await notesStore.loadNotesByCategory(requestedCategoryId, { force })
    const primaryNoteSummary = loadedNotes[0] ?? null
    const primaryNote = primaryNoteSummary
      ? await notesStore.loadNote(primaryNoteSummary.id, { force })
      : null

    if (primaryNote) {
      await attachmentsStore.loadAttachmentsByNote(primaryNote.id, { force })
    }
  } catch {
    // The page shows the stored error state.
  } finally {
    if (categoryId.value === requestedCategoryId) {
      isNotebookBootstrapPending.value = false
    }
  }
}

const ensureUploadedBlocksPersisted = async (
  noteId: string,
  values: NoteFormValues,
): Promise<NoteFormValues> => {
  const pendingImageBlocks = values.blocks.filter(
    (block): block is NoteFormImageBlock =>
      block.type === 'image' && block.uploadFile !== null,
  )

  if (pendingImageBlocks.length === 0) {
    return values
  }

  const uploadedAttachments = await attachmentsStore.uploadAttachments(
    noteId,
    pendingImageBlocks.map((block) => block.uploadFile as File),
  )
  const uploadedByBlockId = new Map<
    string,
    { attachmentId: string; fileName: string }
  >()

  pendingImageBlocks.forEach((block, index) => {
    const attachment = uploadedAttachments[index]

    if (!attachment) {
      throw new Error('Не удалось сопоставить загруженный скриншот с блоком темы.')
    }

    uploadedByBlockId.set(block.id, {
      attachmentId: attachment.id,
      fileName: attachment.originalFileName,
    })
  })

  return {
    ...values,
    blocks: applyUploadedAttachmentsToBlocks(values.blocks, uploadedByBlockId),
  }
}

const maybeCommitImportSummary = (): void => {
  if (!pendingImportSummary.value) {
    return
  }

  importSummary.value = pendingImportSummary.value
  pendingImportSummary.value = null
}

const syncFormFromNotebook = (note: Note | null): void => {
  if (isSaving.value) {
    return
  }

  if (isNotebookBootstrapPending.value) {
    hydrateFormFromNotebook(note, {
      resetUndo: true,
    })
    return
  }

  if (isDirty.value) {
    return
  }

  hydrateFormFromNotebook(note, {
    resetUndo: false,
  })
}

const saveNotebook = async (): Promise<void> => {
  if (!categoryId.value || showCategoryNotFound.value) {
    return
  }

  saveError.value = null
  isSaving.value = true
  const saveSnapshot = cloneNoteFormValues(notebookForm.value)
  const currentNoteId = notebookNote.value?.id ?? null

  saveSnapshot.title = buildNotebookTitle()
  const saveSnapshotFingerprint = createNoteFormFingerprint(saveSnapshot)

  try {
    if (!currentNoteId) {
      const createdNote = await notesStore.createNote(
        toCreateNoteInput(categoryId.value, saveSnapshot),
      )
      const resolvedForm = await ensureUploadedBlocksPersisted(
        createdNote.id,
        saveSnapshot,
      )

      const savedNote =
        resolvedForm !== saveSnapshot
          ? await notesStore.updateNote(
              createdNote.id,
              toUpdateNoteInput(resolvedForm),
            )
          : createdNote

      if (resolvedForm !== saveSnapshot) {
        await attachmentsStore.loadAttachmentsByNote(createdNote.id, {
          force: true,
        })
      }

      if (formFingerprint.value === saveSnapshotFingerprint) {
        hydrateFormFromNotebook(savedNote, {
          resetUndo: false,
        })
      } else {
        lastSavedAt.value = savedNote.updatedAt
        triggerAutosave()
      }

      maybeCommitImportSummary()
      return
    }

    const resolvedForm = await ensureUploadedBlocksPersisted(
      currentNoteId,
      saveSnapshot,
    )
    const updatedNote = await notesStore.updateNote(
      currentNoteId,
      toUpdateNoteInput(resolvedForm),
    )
    await attachmentsStore.loadAttachmentsByNote(currentNoteId, { force: true })

    if (formFingerprint.value === saveSnapshotFingerprint) {
      hydrateFormFromNotebook(updatedNote, {
        resetUndo: false,
      })
    } else {
      lastSavedAt.value = updatedNote.updatedAt
      triggerAutosave()
    }

    maybeCommitImportSummary()
  } catch (error) {
    saveError.value =
      error instanceof Error ? error.message : 'Не удалось сохранить тему.'
  } finally {
    isSaving.value = false
  }
}

const triggerAutosave = (): void => {
  stopAutosave()

  if (!isDirty.value || showCategoryNotFound.value || isNotebookBootstrapPending.value) {
    return
  }

  autosaveHandle = setTimeout(() => {
    if (isSaving.value) {
      triggerAutosave()
      return
    }

    void saveNotebook()
  }, AUTOSAVE_DELAY_MS)
}

const refreshAttachmentStatuses = async (): Promise<void> => {
  if (!notebookNote.value) {
    return
  }

  await attachmentsStore.loadAttachmentsByNote(notebookNote.value.id, {
    force: true,
  })
}

const analyzeAttachmentSet = async (
  attachmentIds: string[],
  options: {
    emptyMessage: string
    allFailedMessage: string
  },
): Promise<void> => {
  noteAnalysisError.value = null
  noteAnalysisSummary.value = null
  noteAnalysisModelLabel.value = null

  if (attachmentIds.length === 0) {
    noteAnalysisSummary.value = options.emptyMessage
    noteAnalysisModelLabel.value = formatAiModelLabels(
      referencedNotebookAttachments.value.map((attachment) => attachment.analysisModel),
    )
    return
  }

  isAnalyzingNote.value = true

  try {
    const responses = await attachmentsStore.analyzeAttachments(attachmentIds, {
      force: true,
      concurrency: 1,
      delayMs: 1500,
    })

    await refreshAttachmentStatuses()

    const completedCount = responses.filter(
      (response) => response.analysis.status === 'completed',
    ).length
    const skippedCount = responses.filter(
      (response) => response.analysis.status === 'skipped',
    ).length
    const refreshedAttachments = attachmentIds
      .map((attachmentId) => attachmentsById.value[attachmentId] ?? null)
      .filter((attachment): attachment is NonNullable<typeof attachment> => attachment !== null)
    const processingCount = refreshedAttachments.filter(
      (attachment) => attachment.processingStatus === 'processing',
    ).length
    const failedCount = refreshedAttachments.filter(
      (attachment) => attachment.processingStatus === 'failed',
    ).length

    noteAnalysisModelLabel.value = formatAiModelLabels(
      attachmentIds.map(
        (attachmentId) => attachmentsById.value[attachmentId]?.analysisModel,
      ),
    )

    if (completedCount === 0 && skippedCount === 0 && processingCount === 0) {
      noteAnalysisError.value = options.allFailedMessage
      return
    }

    const summaryParts: string[] = []

    if (completedCount > 0) {
      summaryParts.push(
        `Проанализировано ${completedCount} ${pluralizeScreenshots(completedCount)}`,
      )
    }

    if (skippedCount > 0) {
      summaryParts.push(
        `без изменений оставлено ${skippedCount} ${pluralizeScreenshots(skippedCount)}`,
      )
    }

    if (failedCount > 0) {
      summaryParts.push(
        `ещё ${failedCount} ${pluralizeScreenshots(failedCount)} требуют повторной попытки`,
      )
    }

    if (processingCount > 0) {
      summaryParts.push(
        `Ещё ${processingCount} ${pluralizeScreenshots(processingCount)} всё ещё анализируются`,
      )
    }

    noteAnalysisSummary.value = `${summaryParts.join('. ')}.`
  } catch (error) {
    noteAnalysisError.value =
      error instanceof Error
        ? error.message
        : 'Не удалось запустить AI-анализ конспекта.'
  } finally {
    isAnalyzingNote.value = false
  }
}

const analyzeNotebook = async (): Promise<void> => {
  if (
    showCategoryNotFound.value ||
    isSaving.value ||
    isImporting.value ||
    isOrganizing.value ||
    isAnalyzingNote.value
  ) {
    return
  }

  noteAnalysisError.value = null
  noteAnalysisSummary.value = null
  noteAnalysisModelLabel.value = null

  if (!hasScreenshotBlocks.value) {
    noteAnalysisError.value = 'В теме пока нет скриншотов для AI-анализа.'
    return
  }


  if (isDirty.value || !notebookNote.value) {
    await saveNotebook()

    if (saveError.value || !notebookNote.value) {
      return
    }
  }

  await refreshAttachmentStatuses()

  await analyzeAttachmentSet(
    noteAttachmentsNeedingAnalysis.value.map((attachment) => attachment.id),
    {
      emptyMessage: 'Все скриншоты темы уже проанализированы.',
      allFailedMessage:
        'Не удалось обработать ни одного скриншота темы. Причины ниже помогут понять, что именно мешает анализу.',
    },
  )
}

const retryFailedAnalyses = async (): Promise<void> => {
  const attachmentsToRetry = failedAttachments.value.map((attachment) => attachment.id)

  await analyzeAttachmentSet(attachmentsToRetry, {
    emptyMessage: 'Все проблемные скриншоты уже переанализированы.',
    allFailedMessage:
      'Переанализ не дал успешного результата. Проверь причины ниже и попробуй ещё раз позже.',
  })
}

const openImportFolderPicker = async (): Promise<void> => {
  importError.value = null
  importSummary.value = null

  const directoryPicker = (window as WindowWithDirectoryPicker).showDirectoryPicker

  if (!directoryPicker) {
    importFolderInput.value?.click()
    return
  }

  try {
    const directoryHandle = await directoryPicker.call(window)
    const files = await collectDirectoryFiles(directoryHandle)
    await importAppleNotesFiles(files)
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return
    }

    importError.value =
      error instanceof Error
        ? error.message
        : 'Не удалось открыть папку экспорта Apple Notes.'
  }
}

const withImportRelativePath = (file: File, relativePath: string): File => {
  const importableFile = file as ImportableFile
  importableFile.importRelativePath = relativePath.replace(/\\/g, '/')
  return importableFile
}

const collectDirectoryFiles = async (
  directoryHandle: FileSystemDirectoryHandle,
  prefix = '',
): Promise<File[]> => {
  const files: File[] = []

  for await (const [, entry] of (
    directoryHandle as FileSystemDirectoryHandleWithEntries
  ).entries()) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name

    if (entry.kind === 'file') {
      files.push(
        withImportRelativePath(
          await (entry as FileSystemFileHandle).getFile(),
          relativePath,
        ),
      )
      continue
    }

    files.push(
      ...(await collectDirectoryFiles(
        entry as FileSystemDirectoryHandle,
        relativePath,
      )),
    )
  }

  return files
}

const appendImportedDrafts = (
  currentForm: NoteFormValues,
  drafts: ImportedAppleNoteDraft[],
): NoteFormValues => {
  const nextBlocks: NoteFormBlock[] = [...currentForm.blocks]
  const currentTitle = buildNotebookTitle()

  for (const draft of drafts) {
    const hasExistingMeaningfulBlocks = nextBlocks.some((block) =>
      block.type === 'image' ? true : block.text.trim().length > 0,
    )

    if (hasExistingMeaningfulBlocks) {
      nextBlocks.push(createTextBlock(''))
    }

    if (draft.title.trim() && draft.title.trim() !== currentTitle.trim()) {
      nextBlocks.push(createTextBlock(draft.title.trim()))
    }

    nextBlocks.push(...draft.blocks)
  }

  return {
    title: currentTitle,
    blocks: nextBlocks,
  }
}

const importAppleNotesFiles = async (files: File[]): Promise<void> => {
  if (files.length === 0) {
    return
  }

  importError.value = null
  importSummary.value = null

  if (!categoryId.value) {
    importError.value = 'Сначала открой нужную тему.'
    return
  }

  isImporting.value = true

  try {
    const drafts = await parseAppleNotesImportFiles(files)
    notebookForm.value = appendImportedDrafts(notebookForm.value, drafts)
    pendingImportSummary.value =
      drafts.length === 1
        ? 'Импортирована 1 заметка из Apple Notes в общий конспект темы.'
        : `Импортировано ${drafts.length} заметок из Apple Notes в общий конспект темы.`

    await saveNotebook()

    if (!saveError.value && notebookNote.value) {
      const persistedNote = await notesStore.loadNote(notebookNote.value.id, {
        force: true,
      })
      await attachmentsStore.loadAttachmentsByNote(persistedNote.id, {
        force: true,
      })
      hydrateFormFromNotebook(persistedNote, {
        resetUndo: false,
      })
    }
  } catch (error) {
    importError.value =
      error instanceof Error
        ? error.message
        : 'Не удалось импортировать заметки из Apple Notes.'
  } finally {
    isImporting.value = false
  }
}

const organizeNotebook = async (): Promise<void> => {
  if (
    showCategoryNotFound.value ||
    isSaving.value ||
    isImporting.value ||
    isOrganizing.value ||
    isAnalyzingNote.value
  ) {
    return
  }

  clearOrganizationMessages()

  if (!hasMeaningfulNotebookContent.value) {
    organizeError.value =
      '\u0421\u043d\u0430\u0447\u0430\u043b\u0430 \u0434\u043e\u0431\u0430\u0432\u044c \u0432 \u0442\u0435\u043c\u0443 \u0442\u0435\u043a\u0441\u0442 \u0438\u043b\u0438 \u0445\u043e\u0442\u044f \u0431\u044b \u043e\u0434\u0438\u043d \u0441\u043a\u0440\u0438\u043d\u0448\u043e\u0442, \u0447\u0442\u043e\u0431\u044b AI \u0431\u044b\u043b\u043e \u0447\u0442\u043e \u0433\u0440\u0443\u043f\u043f\u0438\u0440\u043e\u0432\u0430\u0442\u044c.'
    return
  }

  if (hasScreenshotBlocksWithoutAnalysis.value) {
    organizeError.value =
      organizeBlockedReason.value ??
      '\u0421\u043d\u0430\u0447\u0430\u043b\u0430 \u043f\u0440\u043e\u0430\u043d\u0430\u043b\u0438\u0437\u0438\u0440\u0443\u0439 \u0432\u0441\u0435 \u0441\u043a\u0440\u0438\u043d\u0448\u043e\u0442\u044b \u0442\u0435\u043c\u044b \u043d\u0435\u0439\u0440\u043e\u0441\u0435\u0442\u044c\u044e.'
    return
  }

  if (isDirty.value || !notebookNote.value) {
    await saveNotebook()

    if (saveError.value || !notebookNote.value) {
      return
    }
  }

  if (!notebookNote.value) {
    organizeError.value = 'Не удалось подготовить тему к AI-сортировке.'
    return
  }

  organizationModeInFlight.value = 'ai'

  try {
    const response = await notesStore.organizeNote(notebookNote.value.id)

    hydrateFormFromNotebook(response.note)
    organizeModelLabel.value = formatAiModelLabel(response.ai.model)
    organizeSummary.value =
      response.organized.sectionCount === 1
        ? 'AI перегруппировал полотно в 1 раздел.'
        : `AI перегруппировал полотно на ${response.organized.sectionCount} разделов.`
  } catch (error) {
    organizeError.value =
      error instanceof Error
        ? error.message
        : 'Не удалось упорядочить конспект через AI.'
  } finally {
    organizationModeInFlight.value = null
  }
}

const clearOrganizationMessages = (): void => {
  aiOrganizeError.value = null
  aiOrganizeSummary.value = null
  aiOrganizeModelLabel.value = null
  localOrganizeError.value = null
  localOrganizeSummary.value = null
}

const prepareNotebookForOrganization = async (): Promise<boolean> => {
  if (isDirty.value || !notebookNote.value) {
    await saveNotebook()

    if (saveError.value || !notebookNote.value) {
      return false
    }
  }

  return Boolean(notebookNote.value)
}

const organizeNotebookLocally = async (): Promise<void> => {
  if (
    showCategoryNotFound.value ||
    isSaving.value ||
    isImporting.value ||
    isOrganizing.value ||
    isAnalyzingNote.value
  ) {
    return
  }

  clearOrganizationMessages()

  if (!hasMeaningfulNotebookContent.value) {
    localOrganizeError.value =
      'Сначала добавь в тему текст или хотя бы один скриншот, чтобы было что раскладывать по разделам.'
    return
  }

  if (savedLocalSectionTitles.value.length === 0) {
    localOrganizeError.value =
      'Добавь хотя бы одно название раздела, по которому нужно разложить заметку.'
    return
  }

  if (!(await prepareNotebookForOrganization()) || !notebookNote.value) {
    localOrganizeError.value = 'Не удалось подготовить тему к локальной сортировке.'
    return
  }

  organizationModeInFlight.value = 'local'

  try {
    const response = await notesStore.organizeNote(notebookNote.value.id, {
      mode: 'local',
      sectionTitles: savedLocalSectionTitles.value,
    })

    hydrateFormFromNotebook(response.note)
    localOrganizeSummary.value =
      response.organized.sectionCount === 1
        ? 'Локальная сортировка разложила конспект в 1 раздел.'
        : `Локальная сортировка разложила конспект на ${response.organized.sectionCount} разделов.`
  } catch (error) {
    localOrganizeError.value =
      error instanceof Error
        ? error.message
        : 'Не удалось разложить конспект по заданным разделам.'
  } finally {
    organizationModeInFlight.value = null
  }
}

const handleImportSelection = async (event: Event): Promise<void> => {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files ?? [])

  if (files.length === 0) {
    input.value = ''
    return
  }

  await importAppleNotesFiles(files)
  input.value = ''
}

const undoLastChange = async (): Promise<void> => {
  const snapshot = undoStack.value.pop()

  if (!snapshot) {
    return
  }

  applyFormSnapshot(snapshot)
  await nextTick()

  if (isDirty.value) {
    triggerAutosave()
  }
}

watch(
  categoryId,
  () => {
    clearNoteSearch()
    localSectionDrafts.value = []
    isLocalSectionsModalOpen.value = false
    isNotebookBootstrapPending.value = true
    saveError.value = null
    importError.value = null
    importSummary.value = null
    pendingImportSummary.value = null
    noteAnalysisError.value = null
    noteAnalysisSummary.value = null
    noteAnalysisModelLabel.value = null
    clearOrganizationMessages()
    hydrateFormFromNotebook(null)
    void loadNotebook()
  },
  { immediate: true },
)

watch(
  () => category.value?.name ?? '',
  () => {
    syncHeaderContext()

    if (!isDirty.value && !isSaving.value) {
      hydrateFormFromNotebook(notebookNote.value)
    }
  },
  { immediate: true },
)

watch(
  () => buildNotebookSyncKey(notebookNote.value),
  () => {
    syncFormFromNotebook(notebookNote.value)
  },
  { immediate: true },
)

watch(
  notebookForm,
  () => {
    const nextFingerprint = createNoteFormFingerprint(notebookForm.value)
    const previousFingerprint = createNoteFormFingerprint(previousSnapshot.value)

    if (isApplyingSnapshot.value || nextFingerprint === previousFingerprint) {
      previousSnapshot.value = cloneNoteFormValues(notebookForm.value)
      return
    }

    noteAnalysisError.value = null
    noteAnalysisSummary.value = null
    noteAnalysisModelLabel.value = null
    clearOrganizationMessages()
    undoStack.value.push(cloneNoteFormValues(previousSnapshot.value))

    if (undoStack.value.length > MAX_UNDO_STEPS) {
      undoStack.value.shift()
    }

    previousSnapshot.value = cloneNoteFormValues(notebookForm.value)
    saveError.value = null
    triggerAutosave()
  },
  { deep: true },
)

watch(
  normalizedNoteSearchQuery,
  () => {
    activeNoteSearchMatchIndex.value = 0

    if (!hasActiveNoteSearch.value) {
      return
    }

    void nextTick(() => {
      void focusActiveNoteSearchMatch()
    })
  },
)

watch(
  () => activeNoteSearchMatch.value?.id ?? null,
  (matchId) => {
    if (!matchId) {
      return
    }

    void focusActiveNoteSearchMatch()
  },
)

watch(
  () => noteSearchMatches.value.length,
  (matchCount) => {
    if (matchCount === 0) {
      activeNoteSearchMatchIndex.value = 0
      return
    }

    if (activeNoteSearchMatchIndex.value >= matchCount) {
      activeNoteSearchMatchIndex.value = matchCount - 1
    }
  },
)

watch(
  isLocalSectionsModalOpen,
  (isOpen) => {
    if (typeof document === 'undefined') {
      return
    }

    document.body.style.overflow = isOpen ? 'hidden' : ''
  },
  { immediate: true },
)

watch(
  () => attachmentsInAnalysis.value.length > 0,
  (isActive) => {
    if (isActive) {
      startAnalysisPolling()
      return
    }

    stopAnalysisPolling()
  },
  { immediate: true },
)

onMounted(() => {
  window.addEventListener('keydown', handleCategoryPageKeydown)
})

onBeforeUnmount(() => {
  stopAutosave()
  stopAnalysisPolling()
  clearContextualFooter()
  revokeFormPreviewUrls(notebookForm.value)
  if (typeof document !== 'undefined') {
    document.body.style.overflow = ''
  }
  window.removeEventListener('keydown', handleCategoryPageKeydown)
})
</script>

<template>
  <div class="page-stack category-notes-page">
    <AppNotice
      v-if="isLoading && !notebookNote && !loadError"
      tone="loading"
      title="Подгружаем тему"
      message="Проверяем, есть ли уже сохранённый конспект для этой темы."
    />

    <AppNotice
      v-if="loadError"
      tone="error"
      title="Не удалось открыть тему"
      :message="loadError"
    />

    <SurfaceCard v-if="!showCategoryNotFound">
      <div
        class="category-notes-page__search"
        :class="{
          'category-notes-page__search--sticky': hasActiveNoteSearch,
        }"
      >
        <div class="category-notes-page__search-bar">
          <input
            ref="noteSearchInput"
            v-model="noteSearchQuery"
            class="category-notes-page__search-input"
            type="search"
            placeholder="Искать в заметке и по тексту скриншотов"
            enterkeyhint="search"
          />

          <button
            v-if="hasActiveNoteSearch"
            class="app-button app-button--secondary category-notes-page__search-clear"
            type="button"
            @click="clearNoteSearch()"
          >
            Сбросить
          </button>
        </div>

        <div class="category-notes-page__search-meta">
          <p class="category-notes-page__search-status">
            {{ noteSearchStatusLabel }}
          </p>

          <div
            v-if="hasActiveNoteSearch"
            class="category-notes-page__search-actions"
          >
            <button
              class="app-button app-button--secondary category-notes-page__search-nav"
              type="button"
              :disabled="noteSearchMatches.length === 0"
              @click="moveActiveNoteSearchMatch(-1)"
            >
              Назад
            </button>

            <button
              class="app-button app-button--secondary category-notes-page__search-nav"
              type="button"
              :disabled="noteSearchMatches.length === 0"
              @click="moveActiveNoteSearchMatch(1)"
            >
              Далее
            </button>
          </div>
        </div>

        <p
          v-if="activeNoteSearchMatch"
          class="category-notes-page__search-preview"
        >
          <strong>{{ activeNoteSearchMatch.label }}:</strong>
          {{ activeNoteSearchMatch.preview }}
        </p>
      </div>

      <NoteForm
        ref="noteFormRef"
        v-model="notebookForm"
        :attachments-by-id="attachmentsById"
        :matched-block-ids="searchMatchedBlockIds"
        :active-search-block-id="activeNoteSearchMatch?.blockId ?? null"
        hide-title
        immersive
        :show-submit="false"
        :content-label="null"
        :content-hint="null"
        :status-label="saveStatusLabel"
        :status-tone="saveStatusTone"
        show-undo
        show-clear
        :can-undo="canUndo"
        @undo="undoLastChange"
      />

      <button
        class="app-button app-button--secondary category-notes-page__analysis-button"
        type="button"
        :disabled="
          isImporting || isSaving || isOrganizing || isAnalyzingNote || !hasScreenshotBlocks
        "
        @click="void analyzeNotebook()"
      >
        {{
          isAnalyzingNote
            ? 'Анализируем заметку...'
            : 'Анализировать заметку нейросетью'
        }}
      </button>

      <p
        v-if="organizeBlockedReason"
        class="category-notes-page__organize-hint"
      >
        {{ organizeBlockedReason }}
      </p>

      <button
        class="app-button app-button--secondary category-notes-page__organize-button"
        type="button"
        :disabled="
          isImporting ||
          isSaving ||
          isOrganizing ||
          isAnalyzingNote ||
          !hasMeaningfulNotebookContent ||
          hasScreenshotBlocksWithoutAnalysis
        "
        @click="void organizeNotebook()"
      >
        {{
          isOrganizing ? 'Упорядочиваем...' : 'Упорядочить конспект через AI'
        }}
      </button>

      <button
        class="app-button app-button--secondary category-notes-page__organize-button"
        type="button"
        :disabled="isImporting || isSaving || isOrganizing || isAnalyzingNote"
        @click="openLocalSectionsModal()"
      >
        Указать разделы для локальной сортировки
      </button>

      <div
        v-if="savedLocalSectionTitles.length"
        class="category-notes-page__local-sections-summary"
      >
        <p class="category-notes-page__local-sections-summary-label">
          Пользовательские разделы
        </p>

        <div class="category-notes-page__local-sections-list">
          <span
            v-for="sectionTitle in savedLocalSectionTitles"
            :key="sectionTitle"
            class="category-notes-page__local-section-chip"
          >
            {{ sectionTitle }}
          </span>
        </div>
      </div>

      <button
        class="app-button app-button--secondary category-notes-page__organize-button"
        type="button"
        :disabled="
          isImporting ||
          isSaving ||
          isOrganizing ||
          isAnalyzingNote ||
          !hasMeaningfulNotebookContent ||
          savedLocalSectionTitles.length === 0
        "
        @click="void organizeNotebookLocally()"
      >
        {{
          isLocalOrganizing
            ? 'Раскладываем по разделам...'
            : 'Отсортировать по пользовательским разделам'
        }}
      </button>

      <button
        class="app-button app-button--secondary category-notes-page__import-button"
        type="button"
        :disabled="isImporting || isSaving || isOrganizing || isAnalyzingNote"
        @click="void openImportFolderPicker()"
      >
        {{ isImporting ? 'Импортируем...' : 'Импорт из Apple Notes' }}
      </button>

      <input
        ref="importFolderInput"
        class="category-notes-page__import-input"
        type="file"
        webkitdirectory
        directory
        multiple
        @change="void handleImportSelection($event)"
      />

      <Teleport to="body">
        <div
          v-if="isLocalSectionsModalOpen"
          class="category-notes-page__sections-modal"
          role="dialog"
          aria-modal="true"
          @click="closeLocalSectionsModal()"
        >
          <div class="category-notes-page__sections-modal-backdrop" />

          <div
            class="category-notes-page__sections-modal-panel"
            @click.stop
          >
            <div class="category-notes-page__sections-modal-header">
              <div class="category-notes-page__sections-modal-copy">
                <h2 class="category-notes-page__sections-modal-title">
                  Разделы для локальной сортировки
                </h2>
                <p class="category-notes-page__sections-modal-description">
                  Добавь собственные разделы, по которым нужно разложить конспект.
                </p>
              </div>

              <button
                class="category-notes-page__sections-modal-close"
                type="button"
                aria-label="Закрыть модальное окно"
                @click="closeLocalSectionsModal()"
              >
                ×
              </button>
            </div>

            <div class="category-notes-page__sections-modal-list">
              <div
                v-for="draft in localSectionDrafts"
                :key="draft.id"
                class="category-notes-page__sections-modal-item"
              >
                <input
                  v-if="draft.isEditing"
                  :value="draft.title"
                  class="category-notes-page__sections-modal-input"
                  type="text"
                  maxlength="80"
                  placeholder="Название раздела"
                  @input="
                    updateLocalSectionDraftTitle(
                      draft.id,
                      ($event.target as HTMLInputElement).value,
                    )
                  "
                />

                <span
                  v-else
                  class="category-notes-page__sections-modal-text"
                >
                  {{ draft.title }}
                </span>

                <div class="category-notes-page__sections-modal-item-actions">
                  <button
                    class="category-notes-page__sections-modal-icon-button"
                    type="button"
                    :disabled="!draft.isEditing || !localSectionDraftCanSave(draft)"
                    aria-label="Сохранить раздел"
                    @click="saveLocalSectionDraft(draft.id)"
                  >
                    ✓
                  </button>

                  <button
                    class="category-notes-page__sections-modal-icon-button"
                    type="button"
                    :disabled="draft.isEditing"
                    aria-label="Редактировать раздел"
                    @click="editLocalSectionDraft(draft.id)"
                  >
                    ✎
                  </button>

                  <button
                    class="category-notes-page__sections-modal-icon-button category-notes-page__sections-modal-icon-button--danger"
                    type="button"
                    aria-label="Удалить раздел"
                    @click="removeLocalSectionDraft(draft.id)"
                  >
                    ×
                  </button>
                </div>
              </div>
            </div>

            <div class="category-notes-page__sections-modal-footer">
              <button
                class="app-button app-button--secondary"
                type="button"
                @click="addLocalSectionDraft()"
              >
                ＋ Добавить раздел
              </button>
            </div>
          </div>
        </div>
      </Teleport>

      <AppNotice
        v-if="noteAnalysisError"
        tone="error"
        title="AI-анализ заметки не завершился"
        :message="noteAnalysisError"
      >
        <p
          v-if="noteAnalysisModelLabel"
          class="category-notes-page__ai-model"
        >
          Нейросеть: {{ noteAnalysisModelLabel }}
        </p>
      </AppNotice>

      <AppNotice
        v-if="noteAnalysisSummary"
        tone="success"
        title="AI-анализ заметки завершён"
        :message="noteAnalysisSummary"
      >
        <p
          v-if="noteAnalysisModelLabel"
          class="category-notes-page__ai-model"
        >
          Нейросеть: {{ noteAnalysisModelLabel }}
        </p>
      </AppNotice>

      <AppNotice
        v-if="organizeError"
        tone="error"
        title="AI-сортировка не завершилась"
        :message="organizeError"
      />

      <AppNotice
        v-if="organizeSummary"
        tone="success"
        title="Конспект упорядочен"
        :message="organizeSummary"
      >
        <p
          v-if="organizeModelLabel"
          class="category-notes-page__ai-model"
        >
          Нейросеть: {{ organizeModelLabel }}
        </p>
      </AppNotice>

      <AppNotice
        v-if="localOrganizeError"
        tone="error"
        title="Локальная сортировка не завершилась"
        :message="localOrganizeError"
      />

      <AppNotice
        v-if="localOrganizeSummary"
        tone="success"
        title="Конспект разложен по разделам"
        :message="localOrganizeSummary"
      />

      <AppNotice
        v-if="attachmentsLoadError"
        tone="warning"
        title="Скриншоты обновились не полностью"
        :message="attachmentsLoadError"
      />

      <AppNotice
        v-if="areAttachmentsLoading"
        tone="loading"
        title="Обновляем скриншоты"
        message="Подтягиваем текущие статусы анализа по вложениям темы."
        compact
      />

      <AppNotice
        v-if="pendingAttachments.length"
        tone="info"
        title="Скриншоты темы ещё не проанализированы"
        :message="pendingAnalysisMessage"
      >
        <template #actions>
          <button
            v-if="false"
            class="app-button app-button--secondary"
            type="button"
            :disabled="isSaving || isImporting || isOrganizing || isAnalyzingNote"
            @click="void analyzeNotebook()"
          >
            {{
              isAnalyzingNote
                ? 'Анализируем заметку...'
                : 'Запустить AI-анализ'
            }}
          </button>
        </template>
      </AppNotice>

      <AppNotice
        v-if="attachmentsInAnalysis.length"
        tone="loading"
        :title="analysisStatusTitle"
        :message="analysisStatusMessage"
      >
        <template #actions>
          <button
            class="app-button app-button--secondary"
            type="button"
            :disabled="areAttachmentsLoading"
            @click="void refreshAttachmentStatuses()"
          >
            {{ areAttachmentsLoading ? 'Обновляем...' : 'Обновить статусы' }}
          </button>
        </template>
      </AppNotice>

      <AppNotice
        v-if="failedAttachments.length"
        tone="warning"
        title="Часть скриншотов темы не проанализирована"
        :message="failedAnalysisMessage"
      >
        <div
          v-if="failedAttachmentReasons.length"
          class="category-notes-page__failure-summary"
        >
          <p class="category-notes-page__failure-summary-title">
            Что именно сломалось:
          </p>

          <ul class="category-notes-page__failure-list">
            <li
              v-for="reason in failedAttachmentReasons.slice(0, 5)"
              :key="reason.key"
              class="category-notes-page__failure-item"
            >
              <strong>{{ reason.count }}:</strong> {{ reason.label }}
            </li>
          </ul>
        </div>

        <template #actions>
          <button
            class="app-button app-button--secondary"
            type="button"
            :disabled="isAnyAttachmentRetryRunning"
            @click="void retryFailedAnalyses()"
          >
            {{
              isAnyAttachmentRetryRunning
                ? 'Переанализируем...'
                : 'Переанализировать скриншоты'
            }}
          </button>
        </template>
      </AppNotice>

      <AppNotice
        v-if="importError"
        tone="error"
        title="Импорт не завершился"
        :message="importError"
      />

      <AppNotice
        v-if="importSummary"
        tone="success"
        title="Импорт завершён"
        :message="importSummary"
      />

      <AppNotice
        v-if="saveError"
        tone="error"
        title="Не удалось сохранить тему"
        :message="saveError"
      />
    </SurfaceCard>

    <SurfaceCard v-else title="Тема не найдена">
      <div class="category-notes-page__empty">
        Тема не найдена. Вернись к списку и открой существующую.
      </div>
    </SurfaceCard>
  </div>
</template>

<style scoped>
.category-notes-page__search {
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
  margin-bottom: 1rem;
}

.category-notes-page__search--sticky {
  position: sticky;
  top: 0.65rem;
  z-index: 8;
  padding: 0.85rem;
  border-radius: 24px;
  background: rgba(255, 251, 246, 0.94);
  backdrop-filter: blur(14px);
  box-shadow: 0 16px 28px rgba(71, 50, 24, 0.08);
}

.category-notes-page__search-bar {
  display: flex;
  align-items: center;
  gap: 0.65rem;
}

.category-notes-page__search-input {
  width: 100%;
  min-height: 3.1rem;
  border-radius: 18px;
  border: 1px solid rgba(180, 154, 123, 0.28);
  background: rgba(255, 255, 255, 0.88);
  padding: 0.84rem 1rem;
  color: var(--text);
}

.category-notes-page__search-input:focus {
  outline: none;
  border-color: rgba(31, 109, 90, 0.34);
  box-shadow: 0 0 0 3px rgba(31, 109, 90, 0.1);
}

.category-notes-page__search-clear {
  flex-shrink: 0;
}

.category-notes-page__search-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.8rem;
}

.category-notes-page__search-status {
  margin: 0;
  color: var(--text-muted);
  font-size: 0.88rem;
}

.category-notes-page__search-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.category-notes-page__search-nav {
  min-height: 2.4rem;
  padding-inline: 0.78rem;
}

.category-notes-page__search-preview {
  margin: 0;
  color: var(--text);
  font-size: 0.9rem;
  line-height: 1.5;
}

.category-notes-page__analysis-button,
.category-notes-page__organize-button,
.category-notes-page__import-button {
  align-self: flex-start;
}

.category-notes-page__local-sections-summary {
  width: min(100%, 38rem);
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
}

.category-notes-page__local-sections-summary-label {
  margin: 0;
  font-size: 0.88rem;
  font-weight: 700;
  color: var(--text);
}

.category-notes-page__local-sections-list {
  display: flex;
  flex-wrap: wrap;
  gap: 0.55rem;
}

.category-notes-page__local-section-chip {
  display: inline-flex;
  align-items: center;
  min-height: 2.1rem;
  padding: 0.42rem 0.82rem;
  border-radius: 999px;
  background: rgba(31, 109, 90, 0.1);
  color: var(--accent-strong);
  font-size: 0.84rem;
  font-weight: 700;
}

.category-notes-page__organize-hint {
  margin: -0.35rem 0 0;
  max-width: 32rem;
  color: var(--text-muted);
  font-size: 0.88rem;
  line-height: 1.45;
}

.category-notes-page__sections-modal {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
}

.category-notes-page__sections-modal-backdrop {
  position: absolute;
  inset: 0;
  background: rgba(35, 28, 21, 0.28);
  backdrop-filter: blur(12px);
}

.category-notes-page__sections-modal-panel {
  position: relative;
  width: min(100%, 36rem);
  max-height: min(80vh, 42rem);
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 1.1rem;
  border: 1px solid rgba(180, 154, 123, 0.28);
  border-radius: 28px;
  background:
    linear-gradient(180deg, rgba(255, 250, 243, 0.98), rgba(255, 246, 236, 0.96));
  box-shadow: 0 28px 48px rgba(35, 28, 21, 0.2);
}

.category-notes-page__sections-modal-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
}

.category-notes-page__sections-modal-copy {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}

.category-notes-page__sections-modal-title {
  margin: 0;
  font-family: 'Iowan Old Style', 'Palatino Linotype', Georgia, serif;
  font-size: 1.36rem;
  line-height: 1.08;
}

.category-notes-page__sections-modal-description {
  margin: 0;
  color: var(--text-muted);
  font-size: 0.92rem;
  line-height: 1.45;
}

.category-notes-page__sections-modal-close {
  width: 2.5rem;
  height: 2.5rem;
  border: 1px solid rgba(180, 154, 123, 0.24);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.72);
  color: var(--text);
  font-size: 1.2rem;
}

.category-notes-page__sections-modal-list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.category-notes-page__sections-modal-item {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  padding: 0.8rem 0.85rem;
  border: 1px solid rgba(180, 154, 123, 0.22);
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.66);
}

.category-notes-page__sections-modal-input,
.category-notes-page__sections-modal-text {
  flex: 1;
}

.category-notes-page__sections-modal-input {
  min-height: 2.9rem;
  border-radius: 16px;
  border: 1px solid rgba(180, 154, 123, 0.28);
  background: rgba(255, 255, 255, 0.9);
  padding: 0.72rem 0.85rem;
  color: var(--text);
}

.category-notes-page__sections-modal-input:focus {
  outline: none;
  border-color: rgba(31, 109, 90, 0.34);
  box-shadow: 0 0 0 3px rgba(31, 109, 90, 0.1);
}

.category-notes-page__sections-modal-text {
  min-height: 2.9rem;
  display: flex;
  align-items: center;
  color: var(--text);
  font-weight: 700;
}

.category-notes-page__sections-modal-item-actions {
  display: flex;
  align-items: center;
  gap: 0.45rem;
}

.category-notes-page__sections-modal-icon-button {
  width: 2.45rem;
  height: 2.45rem;
  border: 1px solid rgba(180, 154, 123, 0.24);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.76);
  color: var(--text);
  font-size: 1rem;
}

.category-notes-page__sections-modal-icon-button:disabled {
  opacity: 0.45;
}

.category-notes-page__sections-modal-icon-button--danger {
  color: #9f3b35;
}

.category-notes-page__sections-modal-footer {
  display: flex;
  justify-content: flex-start;
}

.category-notes-page__import-input {
  display: none;
}

.category-notes-page__empty {
  padding: 1rem;
  border: 1px dashed rgba(180, 154, 123, 0.4);
  border-radius: 18px;
  color: var(--text-muted);
  text-align: center;
}

.category-notes-page__failure-summary {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  margin-top: 0.18rem;
}

.category-notes-page__failure-summary-title {
  margin: 0;
  color: var(--text);
  font-size: 0.82rem;
  font-weight: 700;
}

.category-notes-page__failure-list {
  margin: 0;
  padding-left: 1.1rem;
  color: var(--text-muted);
  display: flex;
  flex-direction: column;
  gap: 0.18rem;
}

.category-notes-page__failure-item {
  line-height: 1.38;
}

.category-notes-page__ai-model {
  margin: 0.15rem 0 0;
  font-size: 0.82rem;
  font-weight: 700;
  color: var(--text);
}
</style>

