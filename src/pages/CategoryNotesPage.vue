<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
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
import type { Note } from '@/types'

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
const organizeError = ref<string | null>(null)
const organizeSummary = ref<string | null>(null)
const organizeModelLabel = ref<string | null>(null)
const isSaving = ref(false)
const isImporting = ref(false)
const isAnalyzingNote = ref(false)
const isOrganizing = ref(false)
const importFolderInput = ref<HTMLInputElement | null>(null)
const undoStack = ref<NoteFormValues[]>([])
const previousSnapshot = ref(cloneNoteFormValues(notebookForm.value))
const lastSavedFingerprint = ref(createNoteFormFingerprint(notebookForm.value))
const lastSavedAt = ref<string | null>(null)
const isApplyingSnapshot = ref(false)
let analysisPollHandle: ReturnType<typeof setInterval> | null = null
let autosaveHandle: ReturnType<typeof setTimeout> | null = null

const showCategoryNotFound = computed(
  () => hasLoaded.value && !category.value && !isLoading.value,
)

const attachmentsInAnalysis = computed(() =>
  notebookAttachments.value.filter(
    (attachment) => attachment.processingStatus === 'processing',
  ),
)

const pendingAttachments = computed(() =>
  notebookAttachments.value.filter(
    (attachment) => attachment.processingStatus === 'pending',
  ),
)

const failedAttachments = computed(() =>
  notebookAttachments.value.filter(
    (attachment) => attachment.processingStatus === 'failed',
  ),
)

const noteAttachmentsNeedingAnalysis = computed(() =>
  notebookAttachments.value.filter(
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

const hydrateFormFromNotebook = (note: Note | null): void => {
  const nextValue = note ? createNoteFormFromNote(note) : buildEmptyNotebookForm()
  nextValue.title = buildNotebookTitle()

  applyFormSnapshot(nextValue, {
    markAsSaved: true,
    savedAt: note?.updatedAt ?? null,
    resetUndo: true,
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

const loadNotebook = async (force = false): Promise<void> => {
  if (!categoryId.value) {
    return
  }

  try {
    const loadedNotes = await notesStore.loadNotesByCategory(categoryId.value, { force })
    const primaryNote = loadedNotes[0] ?? null

    if (primaryNote) {
      await attachmentsStore.loadAttachmentsByNote(primaryNote.id, { force })
    }
  } catch {
    // The page shows the stored error state.
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
  if (isSaving.value || isDirty.value) {
    return
  }

  hydrateFormFromNotebook(note)
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
        hydrateFormFromNotebook(savedNote)
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
      hydrateFormFromNotebook(updatedNote)
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

  if (!isDirty.value || showCategoryNotFound.value) {
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
      notebookAttachments.value.map((attachment) => attachment.analysisModel),
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
    const failedCount = Math.max(attachmentIds.length - responses.length, 0)

    noteAnalysisModelLabel.value = formatAiModelLabels(
      attachmentIds.map(
        (attachmentId) => attachmentsById.value[attachmentId]?.analysisModel,
      ),
    )

    if (completedCount === 0 && skippedCount === 0) {
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
      hydrateFormFromNotebook(persistedNote)
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

  organizeError.value = null
  organizeSummary.value = null
  organizeModelLabel.value = null

  if (!hasMeaningfulNotebookContent.value) {
    organizeError.value =
      'Сначала добавь в тему текст или хотя бы один скриншот, чтобы AI было что группировать.'
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

  isOrganizing.value = true

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
    isOrganizing.value = false
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

const undoLastChange = (): void => {
  const snapshot = undoStack.value.pop()

  if (!snapshot) {
    return
  }

  applyFormSnapshot(snapshot)

  if (isDirty.value) {
    triggerAutosave()
  }
}

watch(
  categoryId,
  () => {
    saveError.value = null
    importError.value = null
    importSummary.value = null
    pendingImportSummary.value = null
    noteAnalysisError.value = null
    noteAnalysisSummary.value = null
    noteAnalysisModelLabel.value = null
    organizeError.value = null
    organizeSummary.value = null
    organizeModelLabel.value = null
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
    organizeError.value = null
    organizeSummary.value = null
    organizeModelLabel.value = null
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

onBeforeUnmount(() => {
  stopAutosave()
  stopAnalysisPolling()
  clearContextualFooter()
  revokeFormPreviewUrls(notebookForm.value)
})

const nowAsIso = (): string => new Date().toISOString()
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
      <NoteForm
        v-model="notebookForm"
        :attachments-by-id="attachmentsById"
        hide-title
        immersive
        :show-submit="false"
        :content-label="null"
        :content-hint="null"
        :status-label="saveStatusLabel"
        :status-tone="saveStatusTone"
        show-undo
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

      <button
        class="app-button app-button--secondary category-notes-page__organize-button"
        type="button"
        :disabled="
          isImporting ||
          isSaving ||
          isOrganizing ||
          isAnalyzingNote ||
          !hasMeaningfulNotebookContent
        "
        @click="void organizeNotebook()"
      >
        {{
          isOrganizing ? 'Упорядочиваем...' : 'Упорядочить конспект через AI'
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
.category-notes-page__analysis-button,
.category-notes-page__organize-button,
.category-notes-page__import-button {
  align-self: flex-start;
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
