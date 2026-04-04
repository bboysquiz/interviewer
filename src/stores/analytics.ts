import { ref } from 'vue'
import { defineStore } from 'pinia'

import { knowledgeBaseApi } from '@/services/client/knowledgeBaseApi'
import type { AiAnalyticsSnapshot } from '@/types'

export const useAnalyticsStore = defineStore('analytics', () => {
  const aiSnapshot = ref<AiAnalyticsSnapshot | null>(null)
  const isLoading = ref(false)
  const hasLoaded = ref(false)
  const loadError = ref<string | null>(null)

  const loadAiAnalytics = async (
    options: { force?: boolean } = {},
  ): Promise<AiAnalyticsSnapshot | null> => {
    if (!options.force && hasLoaded.value && aiSnapshot.value) {
      return aiSnapshot.value
    }

    if (isLoading.value) {
      return aiSnapshot.value
    }

    isLoading.value = true

    try {
      aiSnapshot.value = await knowledgeBaseApi.getAiAnalytics()
      loadError.value = null
      hasLoaded.value = true
      return aiSnapshot.value
    } catch (error) {
      loadError.value =
        error instanceof Error
          ? error.message
          : 'Не удалось загрузить аналитику AI.'
      throw error
    } finally {
      isLoading.value = false
    }
  }

  return {
    aiSnapshot,
    isLoading,
    hasLoaded,
    loadError,
    loadAiAnalytics,
  }
})
