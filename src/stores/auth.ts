import { computed, ref } from 'vue'
import { defineStore } from 'pinia'

import router from '@/router'
import { authApi, type AuthCredentialsInput } from '@/services/client/authApi'
import { ApiRequestError } from '@/services/client/http'
import type { AuthUser } from '@/types'

import { useAnalyticsStore } from './analytics'
import { useAttachmentsStore } from './attachments'
import { useInterviewHistoryStore } from './interviewHistory'
import { useKnowledgeBaseStore } from './knowledgeBase'
import { useNotesStore } from './notes'

const resetApplicationState = (): void => {
  useAttachmentsStore().resetState()
  useNotesStore().resetState()
  useInterviewHistoryStore().resetState()
  useAnalyticsStore().resetState()
  useKnowledgeBaseStore().resetState()
}

export const useAuthStore = defineStore('auth', () => {
  const user = ref<AuthUser | null>(null)
  const isRestoring = ref(false)
  const isSubmitting = ref(false)
  const authError = ref<string | null>(null)
  const hasRestored = ref(false)

  const isAuthenticated = computed(() => user.value !== null)

  const clearAuthState = (): void => {
    user.value = null
    authError.value = null
    resetApplicationState()
  }

  const restoreSession = async (): Promise<void> => {
    if (isRestoring.value || hasRestored.value) {
      return
    }

    isRestoring.value = true

    try {
      const session = await authApi.me()
      user.value = session.user
      authError.value = null
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 401) {
        clearAuthState()
      } else {
        clearAuthState()
        authError.value =
          error instanceof Error
            ? error.message
            : 'Не удалось восстановить сессию.'
      }
    } finally {
      hasRestored.value = true
      isRestoring.value = false
    }
  }

  const completeAuth = async (
    request: Promise<{ user: AuthUser }>,
  ): Promise<void> => {
    isSubmitting.value = true

    try {
      const session = await request
      resetApplicationState()
      user.value = session.user
      authError.value = null
      await router.replace({ name: 'categories' })
    } catch (error) {
      authError.value =
        error instanceof Error ? error.message : 'Не удалось выполнить вход.'
      throw error
    } finally {
      isSubmitting.value = false
    }
  }

  const login = async (input: AuthCredentialsInput): Promise<void> =>
    completeAuth(authApi.login(input))

  const register = async (input: AuthCredentialsInput): Promise<void> =>
    completeAuth(authApi.register(input))

  const logout = async (): Promise<void> => {
    isSubmitting.value = true

    try {
      await authApi.logout()
    } catch {
      // Cookie already may be gone; local cleanup still matters more.
    } finally {
      clearAuthState()
      isSubmitting.value = false
      await router.replace({ name: 'categories' })
    }
  }

  return {
    user,
    isAuthenticated,
    isRestoring,
    isSubmitting,
    authError,
    hasRestored,
    restoreSession,
    login,
    register,
    logout,
    clearAuthState,
  }
})
