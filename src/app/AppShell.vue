<script setup lang="ts">
import { onMounted, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { RouterView } from 'vue-router'

import AppBottomNav from '@/components/AppBottomNav.vue'
import AppTopBar from '@/components/AppTopBar.vue'
import AuthPanel from '@/features/auth/AuthPanel.vue'
import AppNotice from '@/shared/ui/AppNotice.vue'
import ImageViewerModal from '@/shared/ui/ImageViewerModal.vue'
import { useAuthStore } from '@/stores/auth'
import { useKnowledgeBaseStore } from '@/stores/knowledgeBase'

const authStore = useAuthStore()
const knowledgeBaseStore = useKnowledgeBaseStore()

const { authError, hasRestored, isAuthenticated, isRestoring } =
  storeToRefs(authStore)
const { hasLoaded, isLoading, loadError } = storeToRefs(knowledgeBaseStore)

onMounted(() => {
  void authStore.restoreSession()
})

watch(
  isAuthenticated,
  (authenticated) => {
    if (authenticated) {
      void knowledgeBaseStore.loadCategories()
    }
  },
  { immediate: true },
)
</script>

<template>
  <div class="app-shell">
    <div class="app-shell__backdrop" />
    <div class="app-shell__surface">
      <AppTopBar />
      <main class="app-shell__content">
        <template v-if="isRestoring || !hasRestored">
          <section class="surface-card page-stack">
            <p class="surface-card__eyebrow">Сессия</p>
            <h2 class="surface-card__title">Проверяем сессию</h2>
            <p class="muted">
              Подключаем аккаунт и поднимаем твою базу знаний.
            </p>
          </section>
        </template>

        <template v-else-if="!isAuthenticated">
          <AppNotice
            v-if="authError"
            tone="warning"
            title="Не удалось восстановить сессию"
            :message="authError"
            compact
          />
          <AuthPanel />
        </template>

        <template v-else>
          <AppNotice
            v-if="loadError && !hasLoaded && !isLoading"
            tone="warning"
            title="Backend пока не ответил"
            :message="loadError"
            compact
          />
          <RouterView />
        </template>
      </main>
      <AppBottomNav v-if="isAuthenticated" />
    </div>
    <ImageViewerModal v-if="isAuthenticated" />
  </div>
</template>
