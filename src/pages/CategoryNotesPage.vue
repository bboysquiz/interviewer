<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useRoute } from 'vue-router'

import NoteForm from '@/features/notes/NoteForm.vue'
import type { ImportedAppleNoteDraft } from '@/features/notes/appleNotesImport'
import { parseAppleNotesImportFiles } from '@/features/notes/appleNotesImport'
import {
  applyUploadedAttachmentsToBlocks,
  createEmptyNoteForm,
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

const route = useRoute()
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
const isSaving = ref(false)
const isImporting = ref(false)
const importFolderInput = ref<HTMLInputElement | null>(null)
let analysisPollHandle: ReturnType<typeof setInterval> | null = null

const categorySummary = computed(() => {
  if (!category.value) {
    return 'В теме будет один общий конспект: текст и скриншоты в одном длинном полотне.'
  }

  return (
    category.value.description ||
    'Открой тему и веди один общий конспект, как в обычных заметках.'
  )
})

const showCategoryNotFound = computed(
  () => hasLoaded.value && !category.value && !isLoading.value,
)

const notebookMeta = computed(() => {
  if (!notebookNote.value) {
    return null
  }

  return {
    updatedAt: notebookNote.value.updatedAt,
    createdAt: notebookNote.value.createdAt,
    attachmentCount: notebookAttachments.value.length,
  }
})

const attachmentsInAnalysis = computed(() =>
  notebookAttachments.value.filter(
    (attachment) =>
      attachment.processingStatus === 'pending' ||
      attachment.processingStatus === 'processing',
  ),
)

const failedAttachments = computed(() =>
  notebookAttachments.value.filter(
    (attachment) => attachment.processingStatus === 'failed',
  ),
)

const isAnalysisPollingActive = computed(
  () => attachmentsInAnalysis.value.length > 0,
)

const analysisStatusTitle = computed(() => {
  const count = attachmentsInAnalysis.value.length

  if (count <= 1) {
    return 'AI анализирует скриншот темы'
  }

  return `AI анализирует ${count} скриншотов темы`
})

const analysisStatusMessage = computed(() =>
  attachmentsInAnalysis.value.some(
    (attachment) => attachment.processingStatus === 'processing',
  )
    ? 'Извлекаем текст и краткое описание из скриншотов. Когда анализ завершится, вопросы начнут учитывать и их содержимое.'
    : 'Скриншоты уже прикреплены к теме и ждут своей очереди на анализ.',
)

const failedAnalysisMessage = computed(() => {
  const count = failedAttachments.value.length

  if (!count) {
    return null
  }

  if (count === 1) {
    return 'Один скриншот темы не прошёл OCR/AI-анализ. Его можно переобработать.'
  }

  return `Не удалось обработать ${count} скриншотов темы. Пока они не будут переанализированы, вопросы будут строиться в основном по тексту.`
})

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

const buildNotebookTitle = (): string =>
  category.value?.name.trim() || 'Тема'

const buildEmptyNotebookForm = (): NoteFormValues => ({
  ...createEmptyNoteForm(),
  title: buildNotebookTitle(),
})

const hydrateFormFromNotebook = (note: Note | null): void => {
  revokeFormPreviewUrls(notebookForm.value)
  notebookForm.value = note ? createNoteFormFromNote(note) : buildEmptyNotebookForm()
  notebookForm.value.title = buildNotebookTitle()
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

const stopAnalysisPolling = (): void => {
  if (analysisPollHandle) {
    clearInterval(analysisPollHandle)
    analysisPollHandle = null
  }
}

const startAnalysisPolling = (): void => {
  stopAnalysisPolling()

  if (!notebookNote.value || !isAnalysisPollingActive.value) {
    return
  }

  analysisPollHandle = setInterval(() => {
    void attachmentsStore.loadAttachmentsByNote(notebookNote.value?.id ?? '', {
      force: true,
    })
  }, 4000)
}

watch(
  categoryId,
  () => {
    saveError.value = null
    importError.value = null
    importSummary.value = null
    hydrateFormFromNotebook(null)
    void loadNotebook()
  },
  { immediate: true },
)

watch(
  [() => notebookNote.value?.id ?? null, () => category.value?.name ?? ''],
  () => {
    hydrateFormFromNotebook(notebookNote.value)
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  stopAnalysisPolling()
  revokeFormPreviewUrls(notebookForm.value)
})

watch(
  isAnalysisPollingActive,
  (isActive) => {
    if (isActive) {
      startAnalysisPolling()
      return
    }

    stopAnalysisPolling()
  },
  { immediate: true },
)

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

const saveNotebook = async (): Promise<void> => {
  saveError.value = null
  importSummary.value = null
  notebookForm.value.title = buildNotebookTitle()

  if (!categoryId.value) {
    saveError.value = 'Не удалось определить тему.'
    return
  }

  if (false) {
    saveError.value = 'Добавь текст или хотя бы один скриншот.'
    return
  }

  isSaving.value = true

  try {
    if (!notebookNote.value) {
      const createdNote = await notesStore.createNote(
        toCreateNoteInput(categoryId.value, notebookForm.value),
      )
      const resolvedForm = await ensureUploadedBlocksPersisted(
        createdNote.id,
        notebookForm.value,
      )

      if (resolvedForm !== notebookForm.value) {
        const updatedNote = await notesStore.updateNote(
          createdNote.id,
          toUpdateNoteInput(resolvedForm),
        )
        await attachmentsStore.loadAttachmentsByNote(createdNote.id, { force: true })
        hydrateFormFromNotebook(updatedNote)
      } else {
        hydrateFormFromNotebook(createdNote)
      }

      return
    }

    const resolvedForm = await ensureUploadedBlocksPersisted(
      notebookNote.value.id,
      notebookForm.value,
    )
    const updatedNote = await notesStore.updateNote(
      notebookNote.value.id,
      toUpdateNoteInput(resolvedForm),
    )
    await attachmentsStore.loadAttachmentsByNote(notebookNote.value.id, { force: true })
    hydrateFormFromNotebook(updatedNote)
  } catch (error) {
    saveError.value =
      error instanceof Error ? error.message : 'Не удалось сохранить тему.'
  } finally {
    isSaving.value = false
  }
}

const reloadNotebook = async (): Promise<void> => {
  await loadNotebook(true)
}

const refreshAttachmentStatuses = async (): Promise<void> => {
  if (!notebookNote.value) {
    return
  }

  await attachmentsStore.loadAttachmentsByNote(notebookNote.value.id, {
    force: true,
  })
}

const retryFailedAnalyses = async (): Promise<void> => {
  const attachmentsToRetry = failedAttachments.value.map((attachment) => attachment.id)

  await attachmentsStore.analyzeAttachments(attachmentsToRetry, {
    force: true,
    concurrency: 3,
  })

  await refreshAttachmentStatuses()
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
        ? (error as Error).message
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
    await saveNotebook()
    importSummary.value =
      drafts.length === 1
        ? 'Импортирована 1 заметка из Apple Notes в общий конспект темы.'
        : `Импортировано ${drafts.length} заметок из Apple Notes в общий конспект темы.`
  } catch (error) {
    importError.value =
      error instanceof Error
        ? (error as Error).message
        : 'Не удалось импортировать заметки из Apple Notes.'
  } finally {
    isImporting.value = false
  }
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

const handleImportSelection = async (event: Event): Promise<void> => {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files ?? [])

  if (files.length === 0) {
    input.value = ''
    return
  }

  await importAppleNotesFiles(files)
  input.value = ''
  return
  /*

  importError.value = null
  importSummary.value = null

  if (!categoryId.value) {
    importError.value = 'Сначала открой нужную тему.'
    input.value = ''
    return
  }

  isImporting.value = true

  try {
    const drafts = await parseAppleNotesImportFiles(files)
    notebookForm.value = appendImportedDrafts(notebookForm.value, drafts)
    await saveNotebook()
    importSummary.value =
      drafts.length === 1
        ? 'Импортирован 1 файл из Apple Notes в общий конспект темы.'
        : `Импортировано ${drafts.length} файлов из Apple Notes в общий конспект темы.`
  } catch (error) {
    importError.value =
      error instanceof Error
        ? error.message
        : 'Не удалось импортировать заметки из Apple Notes.'
  } finally {
    isImporting.value = false
    input.value = ''
  }
  */
}
</script>

<template>
  <div class="page-stack category-notes-page">
    <SurfaceCard eyebrow="Тема" title="Единый конспект">
      <div class="category-notes-page__head">
        <div class="category-notes-page__copy">
          <RouterLink
            class="category-notes-page__back"
            :to="{ name: 'categories' }"
          >
            К списку тем
          </RouterLink>

          <h2 class="category-notes-page__title">
            {{ category?.name ?? 'Тема не найдена' }}
          </h2>
          <p class="lead">{{ categorySummary }}</p>
        </div>

        <div v-if="notebookMeta" class="tag-row category-notes-page__meta">
          <span class="tag">
            Обновлено: {{ formatDateTime(notebookMeta.updatedAt) }}
          </span>
          <span class="tag">
            Скриншотов: {{ notebookMeta.attachmentCount }}
          </span>
        </div>
      </div>

      <div class="category-notes-page__toolbar">
        <button
          class="app-button app-button--primary"
          type="button"
          :disabled="showCategoryNotFound || isSaving || isImporting"
          @click="void saveNotebook()"
        >
          {{ isSaving ? 'Сохраняем...' : 'Сохранить тему' }}
        </button>

        <button
          class="app-button app-button--secondary"
          type="button"
          :disabled="isLoading || isSaving"
          @click="void reloadNotebook()"
        >
          {{ isLoading ? 'Обновляем...' : 'Перезагрузить' }}
        </button>

        <button
          class="app-button app-button--ghost"
          type="button"
          :disabled="showCategoryNotFound || isSaving || isImporting"
          @click="openImportFolderPicker"
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
      </div>

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
        message="Подтягиваем текущие статусы OCR и AI-анализа по вложениям темы."
        compact
      />

      <AppNotice
        v-if="isAnalysisPollingActive"
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
            {{ isAnyAttachmentRetryRunning ? 'Переанализируем...' : 'Переанализировать скриншоты' }}
          </button>
        </template>
      </AppNotice>

      <AppNotice
        v-if="isImporting"
        tone="loading"
        title="Импортируем Apple Notes"
        message="Добавляем экспортированный файл прямо в общий конспект темы."
      />

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

    <SurfaceCard
      v-if="!showCategoryNotFound"
      eyebrow="Конспект"
      title="Текст и скриншоты в одном поле"
    >
      <NoteForm
        v-model="notebookForm"
        submit-label="Сохранить тему"
        :is-submitting="isSaving"
        :attachments-by-id="attachmentsById"
        hide-title
        immersive
        content-label="Полотно заметки"
        content-hint="Здесь одно общее полотно заметки. Пиши текст, вставляй скриншоты через Ctrl+V или кнопкой внизу, а картинки удаляй через Backspace."
        @submit="void saveNotebook()"
      />
    </SurfaceCard>

    <SurfaceCard v-else eyebrow="Тема" title="Не найдена">
      <div class="category-notes-page__empty">
        Тема не найдена. Вернись к списку и открой существующую.
      </div>
    </SurfaceCard>
  </div>
</template>

<style scoped>
.category-notes-page__head {
  display: flex;
  flex-direction: column;
  gap: 0.8rem;
}

.category-notes-page__copy {
  display: flex;
  flex-direction: column;
  gap: 0.36rem;
}

.category-notes-page__back {
  color: var(--accent);
  font-size: 0.84rem;
  font-weight: 700;
}

.category-notes-page__title {
  margin: 0;
  font-size: 1.16rem;
  line-height: 1.15;
}

.category-notes-page__meta {
  margin-top: 0;
}

.category-notes-page__toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem;
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
</style>
