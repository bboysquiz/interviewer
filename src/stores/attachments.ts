import { ref } from 'vue'
import { defineStore } from 'pinia'

import {
  knowledgeBaseApi,
  type AnalyzeAttachmentResponse,
} from '@/services/client/knowledgeBaseApi'
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

const delay = async (milliseconds: number): Promise<void> => {
  if (milliseconds <= 0) {
    return
  }

  await new Promise((resolve) => {
    window.setTimeout(resolve, milliseconds)
  })
}

const extractRetryDelayMs = (message: string): number | null => {
  const retryDelayMatch = message.match(/retry in (\d+(?:\.\d+)?)s/i)

  if (!retryDelayMatch) {
    return null
  }

  const seconds = Number.parseFloat(retryDelayMatch[1])

  if (!Number.isFinite(seconds) || seconds <= 0) {
    return null
  }

  return Math.ceil(seconds * 1000)
}

const isRetryableAnalyzeError = (error: unknown): boolean => {
  if (!(error instanceof Error)) {
    return false
  }

  const normalizedMessage = error.message.toLowerCase()

  return [
    'retry in ',
    'quota',
    'rate limit',
    'too many requests',
    'resource exhausted',
    'service unavailable',
    'temporarily unavailable',
    'high demand',
    'bad gateway',
    'timed out',
    'timeout',
  ].some((pattern) => normalizedMessage.includes(pattern))
}

const resolveRetryDelayMs = (error: unknown, attempt: number): number => {
  if (!(error instanceof Error)) {
    return 10_000
  }

  const explicitDelay = extractRetryDelayMs(error.message)

  if (explicitDelay !== null) {
    return explicitDelay
  }

  const normalizedMessage = error.message.toLowerCase()

  if (
    ['quota', 'rate limit', 'too many requests', 'resource exhausted'].some((pattern) =>
      normalizedMessage.includes(pattern),
    )
  ) {
    return Math.min(60_000, 15_000 * attempt)
  }

  if (
    ['service unavailable', 'temporarily unavailable', 'high demand', 'bad gateway'].some(
      (pattern) => normalizedMessage.includes(pattern),
    )
  ) {
    return Math.min(30_000, 8_000 * attempt)
  }

  return Math.min(20_000, 5_000 * attempt)
}

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
  ): Promise<AnalyzeAttachmentResponse> => {
    if (!attachmentId) {
      throw new Error('Не указан идентификатор вложения.')
    }

    analysisLoadingState.value[attachmentId] = true
    analysisErrors.value[attachmentId] = null
    const currentAttachment = attachmentsById.value[attachmentId] ?? null

    try {
      const response = await knowledgeBaseApi.analyzeAttachment(
        attachmentId,
        options,
      )

      if (response.attachment) {
        upsertAttachment(response.attachment)
      }

      return response
    } catch (error) {
      analysisErrors.value[attachmentId] =
        error instanceof Error
          ? error.message
          : 'Не удалось запустить AI-анализ изображения.'
      if (currentAttachment?.noteId) {
        try {
          await loadAttachmentsByNote(currentAttachment.noteId, { force: true })
        } catch {
          // Ignore refresh errors and keep the original analysis error for the caller.
        }
      }

      throw error
    } finally {
      analysisLoadingState.value[attachmentId] = false
    }
  }

  const analyzeAttachments = async (
    attachmentIds: string[],
    options: {
      force?: boolean
      concurrency?: number
      delayMs?: number
      maxAttempts?: number
    } = {},
  ): Promise<AnalyzeAttachmentResponse[]> => {
    const uniqueAttachmentIds = [...new Set(attachmentIds.filter(Boolean))]

    if (uniqueAttachmentIds.length === 0) {
      return []
    }

    const concurrency = Math.max(1, options.concurrency ?? 3)
    const delayMs = Math.max(0, options.delayMs ?? 0)
    const maxAttempts = Math.max(1, options.maxAttempts ?? 3)
    const queue = uniqueAttachmentIds.map((attachmentId) => ({
      attachmentId,
      attempt: 1,
    }))
    const results: AnalyzeAttachmentResponse[] = []

    const runWorker = async (): Promise<void> => {
      while (queue.length > 0) {
        const currentItem = queue.shift()

        if (!currentItem) {
          return
        }

        const { attachmentId, attempt } = currentItem

        try {
          const response = await analyzeAttachment(attachmentId, {
            force: options.force,
          })
          results.push(response)
        } catch (error) {
          if (isRetryableAnalyzeError(error) && attempt < maxAttempts) {
            await delay(resolveRetryDelayMs(error, attempt))
            queue.push({
              attachmentId,
              attempt: attempt + 1,
            })
            continue
          }
        }

        await delay(delayMs)
      }
    }

    await Promise.all(
      Array.from(
        { length: Math.min(concurrency, uniqueAttachmentIds.length) },
        () => runWorker(),
      ),
    )

    return results
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
