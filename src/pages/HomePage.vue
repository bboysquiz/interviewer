<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'

import AppNotice from '@/shared/ui/AppNotice.vue'
import SurfaceCard from '@/shared/ui/SurfaceCard.vue'
import { useKnowledgeBaseStore } from '@/stores/knowledgeBase'

const knowledgeBaseStore = useKnowledgeBaseStore()
const {
  categories,
  hasLoaded,
  isLoading,
  loadError,
  totalAttachments,
  totalCategories,
  totalNotes,
} =
  storeToRefs(knowledgeBaseStore)

const summaryCards = computed(() => [
  {
    label: 'Категории',
    value: String(totalCategories.value),
    detail: 'тем в личной базе',
  },
  {
    label: 'Заметки',
    value: String(totalNotes.value),
    detail: 'текст для повторения',
  },
  {
    label: 'Вложения',
    value: String(totalAttachments.value),
    detail: 'скриншоты и изображения',
  },
  {
    label: 'Поиск',
    value: 'OCR',
    detail: 'текст внутри картинок',
  },
])

const quickScenarios = [
  {
    title: 'Быстрый обзор темы',
    meta: 'Частый сценарий',
    copy: 'Открыл категорию, пробежался по заметкам и сразу вернулся в навигацию.',
  },
  {
    title: 'Поиск по фрагменту из скриншота',
    meta: 'Для повторения',
    copy: 'Одна строка запроса должна находить и обычный текст заметок, и OCR по картинкам.',
  },
  {
    title: 'Мини-сессия перед интервью',
    meta: 'AI flow',
    copy: 'Переход в режим собеседования без лишних экранов и с сохранением истории ответов.',
  },
]

const featuredCategories = computed(() => categories.value.slice(0, 4))
</script>

<template>
  <div class="page-stack">
    <SurfaceCard eyebrow="Обзор" title="Личный knowledge base всегда под рукой">
      <p class="lead">
        Экран собран mobile-first: сверху быстрый контекст, в центре рабочая
        зона, снизу постоянная навигация для частых переходов одной рукой.
      </p>

      <AppNotice
        v-if="isLoading && !hasLoaded"
        tone="loading"
        title="Подключаем базу знаний"
        message="Загружаем категории и счетчики, чтобы стартовый экран показал актуальные данные."
      />

      <AppNotice
        v-if="loadError"
        tone="warning"
        title="Не удалось обновить данные"
        :message="loadError"
      />

      <div class="summary-grid">
        <article
          v-for="card in summaryCards"
          :key="card.label"
          class="summary-card"
        >
          <span class="summary-card__label">{{ card.label }}</span>
          <strong class="summary-card__value">{{ card.value }}</strong>
          <span class="summary-card__detail">{{ card.detail }}</span>
        </article>
      </div>
    </SurfaceCard>

    <SurfaceCard eyebrow="Сценарии" title="Частое использование без лишних тапов">
      <div class="quick-list">
        <article
          v-for="scenario in quickScenarios"
          :key="scenario.title"
          class="quick-item"
        >
          <span class="quick-item__meta">{{ scenario.meta }}</span>
          <h3 class="quick-item__title">{{ scenario.title }}</h3>
          <p class="quick-item__copy">{{ scenario.copy }}</p>
        </article>
      </div>
    </SurfaceCard>

    <SurfaceCard eyebrow="Темы" title="Категории, с которых удобно начать">
      <div class="section-preview-list">
        <article
          v-for="category in featuredCategories"
          :key="category.id"
          class="section-preview"
        >
          <div class="section-preview__content">
            <h3 class="section-preview__title">{{ category.name }}</h3>
            <p class="section-preview__description">
              {{ category.description }}
            </p>
          </div>

          <span class="section-preview__meta">
            {{ category.noteCount }} заметок
          </span>
        </article>
      </div>
    </SurfaceCard>
  </div>
</template>
