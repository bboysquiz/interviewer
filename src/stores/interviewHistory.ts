import { computed, ref } from 'vue'
import { defineStore } from 'pinia'

import { sortInterviewHistoryRecords } from '@/entities/interview'
import { knowledgeBaseApi } from '@/services/client/knowledgeBaseApi'
import type { InterviewHistoryRecord } from '@/types'

export const useInterviewHistoryStore = defineStore('interview-history', () => {
  const records = ref<InterviewHistoryRecord[]>([])
  const recordsBySessionId = ref<Record<string, InterviewHistoryRecord>>({})
  const isLoading = ref(false)
  const hasLoaded = ref(false)
  const loadError = ref<string | null>(null)
  const detailLoadingState = ref<Record<string, boolean>>({})
  const detailErrors = ref<Record<string, string | null>>({})

  const totalSessions = computed(() => records.value.length)

  const upsertRecord = (record: InterviewHistoryRecord): InterviewHistoryRecord => {
    recordsBySessionId.value[record.session.id] = record

    const nextRecords = records.value.some(
      (currentRecord) => currentRecord.session.id === record.session.id,
    )
      ? records.value.map((currentRecord) =>
          currentRecord.session.id === record.session.id ? record : currentRecord,
        )
      : [...records.value, record]

    records.value = sortInterviewHistoryRecords(nextRecords)
    return record
  }

  const loadHistory = async (
    options: { force?: boolean } = {},
  ): Promise<InterviewHistoryRecord[]> => {
    if (!options.force && hasLoaded.value) {
      return records.value
    }

    if (isLoading.value) {
      return records.value
    }

    isLoading.value = true

    try {
      const loadedRecords = sortInterviewHistoryRecords(
        await knowledgeBaseApi.listInterviewHistory(),
      )

      records.value = loadedRecords
      recordsBySessionId.value = Object.fromEntries(
        loadedRecords.map((record) => [record.session.id, record]),
      )
      loadError.value = null
      hasLoaded.value = true
      return loadedRecords
    } catch (error) {
      loadError.value =
        error instanceof Error
          ? error.message
          : 'Не удалось загрузить историю собеседований.'
      throw error
    } finally {
      isLoading.value = false
    }
  }

  const loadHistoryRecord = async (
    sessionId: string,
    options: { force?: boolean } = {},
  ): Promise<InterviewHistoryRecord> => {
    if (!sessionId) {
      throw new Error('Не указан идентификатор интервью-сессии.')
    }

    if (!options.force && recordsBySessionId.value[sessionId]) {
      return recordsBySessionId.value[sessionId]
    }

    if (detailLoadingState.value[sessionId] && recordsBySessionId.value[sessionId]) {
      return recordsBySessionId.value[sessionId]
    }

    detailLoadingState.value[sessionId] = true

    try {
      const record = await knowledgeBaseApi.getInterviewHistoryRecord(sessionId)
      detailErrors.value[sessionId] = null
      return upsertRecord(record)
    } catch (error) {
      detailErrors.value[sessionId] =
        error instanceof Error
          ? error.message
          : 'Не удалось загрузить детали попытки.'
      throw error
    } finally {
      detailLoadingState.value[sessionId] = false
    }
  }

  return {
    records,
    recordsBySessionId,
    isLoading,
    hasLoaded,
    loadError,
    detailLoadingState,
    detailErrors,
    totalSessions,
    loadHistory,
    loadHistoryRecord,
  }
})
