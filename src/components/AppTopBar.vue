<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'

import { useContextualFooter } from '@/features/navigation/contextualFooter'

const route = useRoute()
const pageTitle = computed(() => route.meta.title)
const { hasBackAction, isVisible, title, triggerBack } = useContextualFooter()
</script>

<template>
  <header class="top-bar">
    <h1 class="top-bar__title">{{ pageTitle }}</h1>

    <div v-if="isVisible" class="top-bar__context">
      <button
        v-if="hasBackAction"
        class="top-bar__context-back"
        type="button"
        aria-label="Назад"
        @click="triggerBack()"
      >
        <svg
          class="top-bar__context-icon"
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          <path
            d="M10.5 5.5 4 12l6.5 6.5M5 12h15"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </button>

      <span class="top-bar__context-title">{{ title }}</span>
    </div>
  </header>
</template>
