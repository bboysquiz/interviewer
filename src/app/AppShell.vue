<script setup lang="ts">
import { onMounted } from 'vue'
import { storeToRefs } from 'pinia'
import { RouterView } from 'vue-router'

import AppBottomNav from '@/components/AppBottomNav.vue'
import AppTopBar from '@/components/AppTopBar.vue'
import AppNotice from '@/shared/ui/AppNotice.vue'
import ImageViewerModal from '@/shared/ui/ImageViewerModal.vue'
import { useKnowledgeBaseStore } from '@/stores/knowledgeBase'

const knowledgeBaseStore = useKnowledgeBaseStore()
const { hasLoaded, isLoading, loadError } = storeToRefs(knowledgeBaseStore)

onMounted(() => {
  void knowledgeBaseStore.loadCategories()
})
</script>

<template>
  <div class="app-shell">
    <div class="app-shell__backdrop" />
    <div class="app-shell__surface">
      <AppTopBar />
      <main class="app-shell__content">
        <AppNotice
          v-if="loadError && !hasLoaded && !isLoading"
          tone="warning"
          title="Backend пока не ответил"
          :message="loadError"
          compact
        />
        <RouterView />
      </main>
      <AppBottomNav />
    </div>
    <ImageViewerModal />
  </div>
</template>
