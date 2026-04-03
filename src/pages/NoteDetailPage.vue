<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useRoute, useRouter } from 'vue-router'

import NoteContentRenderer from '@/features/notes/NoteContentRenderer.vue'
import NoteForm from '@/features/notes/NoteForm.vue'
import {
  applyUploadedAttachmentsToBlocks,
  createEmptyNoteForm,
  createNoteFormFromNote,
  revokeFormPreviewUrls,
  toUpdateNoteInput,
  type NoteFormImageBlock,
} from '@/features/notes/noteForm'
import { formatDateTime } from '@/shared/lib/format'
import AppNotice from '@/shared/ui/AppNotice.vue'
import ConfirmSheet from '@/shared/ui/ConfirmSheet.vue'
import SurfaceCard from '@/shared/ui/SurfaceCard.vue'
import { useAttachmentsStore } from '@/stores/attachments'
import { useKnowledgeBaseStore } from '@/stores/knowledgeBase'
import { useNotesStore } from '@/stores/notes'

const route = useRoute()
const router = useRouter()
const knowledgeBaseStore = useKnowledgeBaseStore()
const notesStore = useNotesStore()
const attachmentsStore = useAttachmentsStore()

const { categories } = storeToRefs(knowledgeBaseStore)
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
const noteId = computed(() =>
  typeof route.params.noteId === 'string' ? route.params.noteId : '',
)
const selectedAttachmentId = computed(() =>
  typeof route.query.attachmentId === 'string'
    ? route.query.attachmentId
    : null,
)
const noteHighlightQuery = computed(() =>
  typeof route.query.q === 'string' ? route.query.q.trim() : '',
)

const note = computed(() => notesStore.notesById[noteId.value] ?? null)
const isLoading = computed(
  () => notesStore.noteLoadingState[noteId.value] ?? false,
)
const loadError = computed(() => notesStore.noteErrors[noteId.value] ?? null)
const attachments = computed(() => attachmentsByNote.value[noteId.value] ?? [])
const areAttachmentsLoading = computed(
  () => attachmentLoadingState.value[noteId.value] ?? false,
)
const attachmentsLoadError = computed(
  () => attachmentNoteErrors.value[noteId.value] ?? null,
)

const currentCategoryId = computed(
  () => note.value?.categoryId ?? categoryId.value,
)
const category = computed(
  () =>
    categories.value.find(
      (currentCategory) => currentCategory.id === currentCategoryId.value,
    ) ?? null,
)

const editForm = ref(createEmptyNoteForm())
const editError = ref<string | null>(null)
const deleteError = ref<string | null>(null)
const isEditing = ref(false)
const isSaving = ref(false)
const isDeleting = ref(false)
const confirmingDelete = ref(false)
let analysisPollHandle: ReturnType<typeof setInterval> | null = null

const attachmentsInAnalysis = computed(() =>
  attachments.value.filter(
    (attachment) =>
      attachment.processingStatus === 'pending' ||
      attachment.processingStatus === 'processing',
  ),
)

const failedAttachments = computed(() =>
  attachments.value.filter(
    (attachment) => attachment.processingStatus === 'failed',
  ),
)

const isAnalysisPollingActive = computed(
  () => attachmentsInAnalysis.value.length > 0,
)

const analysisStatusTitle = computed(() => {
  const count = attachmentsInAnalysis.value.length

  if (count <= 1) {
    return 'AI анализирует скриншот'
  }

  return `AI анализирует ${count} скриншота`
})

const analysisStatusMessage = computed(() =>
  attachmentsInAnalysis.value.some(
    (attachment) => attachment.processingStatus === 'processing',
  )
    ? 'Извлекаем видимый текст и краткое описание. Порядок блоков в заметке сохраняется.'
    : 'Скриншоты уже прикреплены к заметке и ждут своей очереди на анализ.',
)

const failedAnalysisMessage = computed(() => {
  const count = failedAttachments.value.length

  if (!count) {
    return null
  }

  if (count === 1) {
    return 'Один из скриншотов не прошёл AI-анализ. Можно перезапустить обработку.'
  }

  return `Не удалось обработать ${count} скриншота. Можно перезапустить анализ для всех неудачных файлов.`
})

const loadCurrentNote = async (force = false): Promise<void> => {
  if (!noteId.value) {
    return
  }

  try {
    await Promise.all([
      notesStore.loadNote(noteId.value, { force }),
      attachmentsStore.loadAttachmentsByNote(noteId.value, { force }),
    ])
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

  if (!noteId.value || !isAnalysisPollingActive.value) {
    return
  }

  analysisPollHandle = setInterval(() => {
    void attachmentsStore.loadAttachmentsByNote(noteId.value, { force: true })
  }, 4000)
}

watch(
  noteId,
  () => {
    stopAnalysisPolling()
    revokeFormPreviewUrls(editForm.value)
    isEditing.value = false
    confirmingDelete.value = false
    editError.value = null
    deleteError.value = null
    editForm.value = createEmptyNoteForm()
    void loadCurrentNote()
  },
  { immediate: true },
)

watch(
  note,
  (currentNote) => {
    if (!currentNote || isEditing.value) {
      return
    }

    revokeFormPreviewUrls(editForm.value)
    editForm.value = createNoteFormFromNote(currentNote)
  },
  { immediate: true },
)

const scrollToSelectedAttachment = async (): Promise<void> => {
  if (!selectedAttachmentId.value) {
    return
  }

  await nextTick()

  const element = document.getElementById(
    `attachment-${selectedAttachmentId.value}`,
  )

  element?.scrollIntoView({
    behavior: 'smooth',
    block: 'center',
  })
}

watch([selectedAttachmentId, attachments], () => {
  if (
    selectedAttachmentId.value &&
    attachments.value.some(
      (attachment) => attachment.id === selectedAttachmentId.value,
    )
  ) {
    void scrollToSelectedAttachment()
  }
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

onBeforeUnmount(() => {
  stopAnalysisPolling()
  revokeFormPreviewUrls(editForm.value)
})

const startEditing = (): void => {
  if (!note.value) {
    return
  }

  revokeFormPreviewUrls(editForm.value)
  editForm.value = createNoteFormFromNote(note.value)
  editError.value = null
  deleteError.value = null
  confirmingDelete.value = false
  isEditing.value = true
}

const cancelEditing = (): void => {
  isEditing.value = false
  editError.value = null
  revokeFormPreviewUrls(editForm.value)

  if (note.value) {
    editForm.value = createNoteFormFromNote(note.value)
  }
}

const openDeleteConfirmation = (): void => {
  if (!note.value || isSaving.value) {
    return
  }

  deleteError.value = null
  confirmingDelete.value = true
}

const closeDeleteConfirmation = (): void => {
  if (isDeleting.value) {
    return
  }

  confirmingDelete.value = false
  deleteError.value = null
}

const submitUpdate = async (): Promise<void> => {
  if (!note.value) {
    return
  }

  editError.value = null

  if (!editForm.value.title.trim()) {
    editError.value = 'Заполни заголовок заметки.'
    return
  }

  if (false) {
    editError.value = 'Добавь текст или хотя бы один скриншот.'
    return
  }

  isSaving.value = true

  try {
    let resolvedForm = editForm.value
    const pendingImageBlocks = resolvedForm.blocks.filter(
      (block): block is NoteFormImageBlock =>
        block.type === 'image' && block.uploadFile !== null,
    )

    if (pendingImageBlocks.length > 0) {
      const uploadedAttachments = await attachmentsStore.uploadAttachments(
        note.value.id,
        pendingImageBlocks.map((block) => block.uploadFile as File),
      )
      const uploadedByBlockId = new Map<
        string,
        { attachmentId: string; fileName: string }
      >()

      pendingImageBlocks.forEach((block, index) => {
        const attachment = uploadedAttachments[index]

        if (!attachment) {
          throw new Error(
            'Не удалось сопоставить загруженный скриншот с блоком заметки.',
          )
        }

        uploadedByBlockId.set(block.id, {
          attachmentId: attachment.id,
          fileName: attachment.originalFileName,
        })
      })

      resolvedForm = {
        ...resolvedForm,
        blocks: applyUploadedAttachmentsToBlocks(
          resolvedForm.blocks,
          uploadedByBlockId,
        ),
      }
      editForm.value = resolvedForm
    }

    const updatedNote = await notesStore.updateNote(
      note.value.id,
      toUpdateNoteInput(resolvedForm),
    )
    await attachmentsStore.loadAttachmentsByNote(note.value.id, { force: true })
    revokeFormPreviewUrls(editForm.value)
    editForm.value = createNoteFormFromNote(updatedNote)
    isEditing.value = false
  } catch (error) {
    editError.value =
      error instanceof Error ? error.message : 'Не удалось обновить заметку.'
  } finally {
    isSaving.value = false
  }
}

const deleteNote = async (): Promise<void> => {
  if (!note.value) {
    return
  }

  deleteError.value = null
  isDeleting.value = true

  try {
    const categoryIdToReturn = note.value.categoryId
    await notesStore.deleteNote(note.value.id)
    await router.replace({
      name: 'category-notes',
      params: {
        categoryId: categoryIdToReturn,
      },
    })
  } catch (error) {
    deleteError.value =
      error instanceof Error ? error.message : 'Не удалось удалить заметку.'
  } finally {
    isDeleting.value = false
  }
}

const refreshAttachmentStatuses = async (): Promise<void> => {
  if (!noteId.value) {
    return
  }

  await attachmentsStore.loadAttachmentsByNote(noteId.value, { force: true })
}

const retryFailedAnalyses = async (): Promise<void> => {
  const attachmentsToRetry = failedAttachments.value.map((attachment) => attachment.id)

  await attachmentsStore.analyzeAttachments(attachmentsToRetry, {
    force: true,
    concurrency: 3,
  })

  if (noteId.value) {
    await attachmentsStore.loadAttachmentsByNote(noteId.value, { force: true })
  }
}

const isAnyAttachmentRetryRunning = computed(() =>
  failedAttachments.value.some(
    (attachment) => analysisLoadingState.value[attachment.id] ?? false,
  ),
)
</script>

<template>
  <div class="page-stack note-detail-page">
    <SurfaceCard eyebrow="Навигация" title="Заметка">
      <div class="note-detail-page__header">
        <div class="note-detail-page__copy">
          <RouterLink
            class="note-detail-page__back"
            :to="{
              name: 'category-notes',
              params: {
                categoryId: currentCategoryId,
              },
            }"
          >
            К заметкам категории
          </RouterLink>

          <h2 class="note-detail-page__title">
            {{ note?.title ?? 'Загружаем заметку...' }}
          </h2>

          <p class="lead note-detail-page__lead">
            {{
              category
                ? `Категория: ${category.name}`
                : 'Личный конспект для быстрого повторения.'
            }}
          </p>
        </div>

        <div class="tag-row note-detail-page__meta">
          <span v-if="note" class="tag">
            Создано: {{ formatDateTime(note.createdAt) }}
          </span>
          <span v-if="note" class="tag">
            Обновлено: {{ formatDateTime(note.updatedAt) }}
          </span>
          <span v-if="note" class="tag">
            {{ attachments.length }} скриншотов
          </span>
        </div>
      </div>

      <div class="note-detail-page__actions">
        <button
          class="app-button app-button--secondary"
          type="button"
          :disabled="!note || isSaving || isDeleting"
          @click="void loadCurrentNote(true)"
        >
          {{ isLoading ? 'Обновляем...' : 'Перезагрузить' }}
        </button>

        <button
          v-if="note && !isEditing"
          class="app-button app-button--primary"
          type="button"
          :disabled="isDeleting"
          @click="startEditing"
        >
          Редактировать
        </button>

        <button
          v-if="note"
          class="app-button app-button--danger"
          type="button"
          :disabled="isSaving"
          @click="openDeleteConfirmation"
        >
          Удалить
        </button>
      </div>

      <AppNotice
        v-if="loadError"
        tone="error"
        title="Не удалось загрузить заметку"
        :message="loadError"
      >
        <template #actions>
          <button
            class="app-button app-button--secondary"
            type="button"
            :disabled="isLoading"
            @click="void loadCurrentNote(true)"
          >
            {{ isLoading ? 'Пробуем снова...' : 'Повторить' }}
          </button>
        </template>
      </AppNotice>
    </SurfaceCard>

    <SurfaceCard v-if="!note && isLoading" eyebrow="Содержимое" title="Загрузка">
      <div class="note-detail-page__empty">
        Загружаем содержимое заметки...
      </div>
    </SurfaceCard>

    <SurfaceCard
      v-else-if="!note"
      eyebrow="Содержимое"
      title="Заметка не найдена"
    >
      <div class="note-detail-page__empty">
        Похоже, этой заметки уже нет или ссылка устарела.
      </div>
    </SurfaceCard>

    <SurfaceCard
      v-else-if="isEditing"
      eyebrow="Редактирование"
      title="Текст и скриншоты в одном документе"
    >
      <NoteForm
        v-model="editForm"
        submit-label="Сохранить изменения"
        :is-submitting="isSaving"
        :error-message="editError"
        :attachments-by-id="attachmentsById"
        show-cancel
        @submit="submitUpdate"
        @cancel="cancelEditing"
      />
    </SurfaceCard>

    <SurfaceCard v-else eyebrow="Просмотр" title="Содержимое заметки">
      <AppNotice
        v-if="attachmentsLoadError"
        tone="error"
        title="Не удалось обновить список скриншотов"
        :message="attachmentsLoadError"
      >
        <template #actions>
          <button
            class="app-button app-button--secondary"
            type="button"
            :disabled="areAttachmentsLoading"
            @click="void refreshAttachmentStatuses()"
          >
            {{ areAttachmentsLoading ? 'Пробуем снова...' : 'Повторить' }}
          </button>
        </template>
      </AppNotice>

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
        title="Часть AI-анализа завершилась ошибкой"
        :message="failedAnalysisMessage"
      >
        <template #actions>
          <button
            class="app-button app-button--secondary"
            type="button"
            :disabled="isAnyAttachmentRetryRunning"
            @click="void retryFailedAnalyses()"
          >
            Перезапустить неудачные анализы
          </button>
        </template>
      </AppNotice>

      <NoteContentRenderer
        :blocks="note.contentBlocks"
        :attachments-by-id="attachmentsById"
        :highlight-query="noteHighlightQuery"
        :selected-attachment-id="selectedAttachmentId"
      />
    </SurfaceCard>

    <ConfirmSheet
      v-if="note && confirmingDelete"
      :open="true"
      title="Удалить заметку?"
      :description="`Заметка «${note.title}» будет удалена вместе со связанными скриншотами и поисковыми чанками.`"
      confirm-label="Удалить заметку"
      :is-submitting="isDeleting"
      :error-message="deleteError"
      @cancel="closeDeleteConfirmation"
      @confirm="void deleteNote()"
    />
  </div>
</template>

<style scoped>
.note-detail-page__header {
  display: flex;
  flex-direction: column;
  gap: 0.8rem;
}

.note-detail-page__copy {
  display: flex;
  flex-direction: column;
  gap: 0.36rem;
}

.note-detail-page__back {
  color: var(--accent);
  font-size: 0.84rem;
  font-weight: 700;
}

.note-detail-page__title {
  margin: 0;
  font-size: 1.2rem;
  line-height: 1.16;
}

.note-detail-page__lead {
  margin-top: 0;
}

.note-detail-page__meta {
  margin-top: 0;
}

.note-detail-page__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem;
}

.note-detail-page__actions > * {
  flex: 1 1 calc(50% - 0.3rem);
}

.note-detail-page__empty {
  padding: 1rem;
  border: 1px dashed rgba(180, 154, 123, 0.4);
  border-radius: 18px;
  color: var(--text-muted);
  text-align: center;
}

@media (min-width: 420px) {
  .note-detail-page__actions > * {
    flex: 0 1 auto;
  }
}
</style>
