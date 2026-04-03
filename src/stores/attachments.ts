import { ref } from 'vue'
import { defineStore } from 'pinia'

import { knowledgeBaseApi } from '@/services/client/knowledgeBaseApi'
import type { Attachment } from '@/types'

import { useKnowledgeBaseStore } from './knowledgeBase'
import { useNotesStore } from './notes'

const sortAttachments = (value: Attachment[]): Attachment[] =>
  [...value].sort((left, right) => {
    if (left.createdAt !== right.createdAt) {
      return right.createdAt.localeCompare(left.createdAt)
    }

    return right.updatedAt.localeCompare(left.updatedAt)
  })

export const useAttachmentsStore = defineStore('attachments', () => {
  const attachmentsByNote = ref<Record<string, Attachment[]>>({})
  const attachmentsById = ref<Record<string, Attachment>>({})
  const noteLoadingState = ref<Record<string, boolean>>({})
  const noteErrors = ref<Record<string, string | null>>({})
  const analysisLoadingState = ref<Record<string, boolean>>({})
  const analysisErrors = ref<Record<string, string | null>>({})

  const upsertAttachment = (attachment: Attachment): void => {
    attachmentsById.value[attachment.id] = attachment

    const currentAttachments = attachmentsByNote.value[attachment.noteId] ?? []
    const hasExistingAttachment = currentAttachments.some(
      (currentAttachment) => currentAttachment.id === attachment.id,
    )

    attachmentsByNote.value[attachment.noteId] = sortAttachments(
      hasExistingAttachment
        ? currentAttachments.map((currentAttachment) =>
            currentAttachment.id === attachment.id
              ? attachment
              : currentAttachment,
          )
        : [...currentAttachments, attachment],
    )
  }

  const loadAttachmentsByNote = async (
    noteId: string,
    options: { force?: boolean } = {},
  ): Promise<Attachment[]> => {
    if (!noteId) {
      return []
    }

    if (!options.force && attachmentsByNote.value[noteId]) {
      return attachmentsByNote.value[noteId]
    }

    if (noteLoadingState.value[noteId]) {
      return attachmentsByNote.value[noteId] ?? []
    }

    noteLoadingState.value[noteId] = true

    try {
      const attachments = sortAttachments(
        await knowledgeBaseApi.listAttachments({ noteId }),
      )
      attachmentsByNote.value[noteId] = attachments
      noteErrors.value[noteId] = null

      for (const attachment of attachments) {
        attachmentsById.value[attachment.id] = attachment
        analysisErrors.value[attachment.id] = null
      }

      return attachments
    } catch (error) {
      noteErrors.value[noteId] =
        error instanceof Error
          ? error.message
          : 'Не удалось загрузить изображения.'
      throw error
    } finally {
      noteLoadingState.value[noteId] = false
    }
  }

  const analyzeAttachment = async (
    attachmentId: string,
    options: { force?: boolean } = {},
  ): Promise<Attachment | null> => {
    if (!attachmentId) {
      throw new Error('Не указан идентификатор вложения.')
    }

    analysisLoadingState.value[attachmentId] = true
    analysisErrors.value[attachmentId] = null

    try {
      const response = await knowledgeBaseApi.analyzeAttachment(
        attachmentId,
        options,
      )

      if (response.attachment) {
        upsertAttachment(response.attachment)
      }

      return response.attachment
    } catch (error) {
      analysisErrors.value[attachmentId] =
        error instanceof Error
          ? error.message
          : 'Не удалось запустить AI-анализ изображения.'
      throw error
    } finally {
      analysisLoadingState.value[attachmentId] = false
    }
  }

  const analyzeAttachments = async (
    attachmentIds: string[],
    options: { force?: boolean; concurrency?: number } = {},
  ): Promise<void> => {
    const uniqueAttachmentIds = [...new Set(attachmentIds.filter(Boolean))]

    if (uniqueAttachmentIds.length === 0) {
      return
    }

    const concurrency = Math.max(1, options.concurrency ?? 3)
    let nextIndex = 0

    const runWorker = async (): Promise<void> => {
      while (nextIndex < uniqueAttachmentIds.length) {
        const currentIndex = nextIndex
        nextIndex += 1
        const attachmentId = uniqueAttachmentIds[currentIndex]

        try {
          await analyzeAttachment(attachmentId, { force: options.force })
        } catch {
          // Per-attachment errors are already stored in the analysis state.
        }
      }
    }

    await Promise.all(
      Array.from(
        { length: Math.min(concurrency, uniqueAttachmentIds.length) },
        () => runWorker(),
      ),
    )
  }

  const uploadAttachments = async (
    noteId: string,
    files: File[],
  ): Promise<Attachment[]> => {
    const uploadedAttachments: Attachment[] = []

    for (const file of files) {
      const formData = new FormData()
      formData.set('noteId', noteId)
      formData.set('file', file)

      const attachment = await knowledgeBaseApi.uploadAttachment(formData)
      upsertAttachment(attachment)
      uploadedAttachments.push(attachment)
    }

    if (uploadedAttachments.length > 0) {
      await Promise.all([
        useNotesStore().loadNote(noteId, { force: true }),
        useKnowledgeBaseStore().loadCategories(),
      ])
    }

    return uploadedAttachments
  }

  return {
    attachmentsByNote,
    attachmentsById,
    noteLoadingState,
    noteErrors,
    analysisLoadingState,
    analysisErrors,
    loadAttachmentsByNote,
    analyzeAttachment,
    analyzeAttachments,
    uploadAttachments,
  }
})
