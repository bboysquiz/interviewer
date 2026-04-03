<script setup lang="ts">
import { computed } from 'vue'

import type { InterviewWeakSpot } from '@/entities/interview'
import AppNotice from '@/shared/ui/AppNotice.vue'
import SurfaceCard from '@/shared/ui/SurfaceCard.vue'

const props = defineProps<{
  weakSpots: InterviewWeakSpot[]
  isLoading: boolean
  isBusy: boolean
  isGenerating: boolean
  loadError?: string | null
}>()

const emit = defineEmits<{
  repeat: [weakSpot: InterviewWeakSpot]
}>()

const featuredWeakSpots = computed(() => props.weakSpots.slice(0, 3))
const primaryWeakSpot = computed(() => featuredWeakSpots.value[0] ?? null)

const primaryActionLabel = computed(() =>
  props.isGenerating ? 'Генерируем...' : 'Спросить снова по слабым местам',
)
</script>

<template>
  <SurfaceCard eyebrow="Повторение" title="Спроси меня снова по слабым местам">
    <AppNotice
      v-if="isLoading && !featuredWeakSpots.length"
      tone="loading"
      title="Анализируем прошлые попытки"
      message="Собираем слабые места из истории, чтобы предложить быстрый повтор."
    />

    <AppNotice
      v-if="loadError && !featuredWeakSpots.length"
      tone="warning"
      title="Слабые места пока недоступны"
      :message="loadError"
    />

    <template v-else-if="featuredWeakSpots.length">
      <p class="lead">
        Самое проблемное место можно запустить сразу, без ручного выбора категории и заметки.
      </p>

      <div class="interview-weak-spots__actions">
        <button
          v-if="primaryWeakSpot"
          class="app-button app-button--primary interview-weak-spots__primary-action"
          type="button"
          :disabled="isBusy"
          @click="emit('repeat', primaryWeakSpot)"
        >
          {{ primaryActionLabel }}
        </button>
      </div>

      <div class="interview-weak-spots__list">
        <article
          v-for="weakSpot in featuredWeakSpots"
          :key="weakSpot.id"
          class="interview-weak-spots__card"
        >
          <div class="tag-row interview-weak-spots__tags">
            <span class="tag">{{ weakSpot.sourceLabel }}</span>
            <span class="tag">{{ weakSpot.priorityLabel }}</span>
            <span v-if="weakSpot.attempts > 1" class="tag">
              {{ weakSpot.attempts }} слабых попытки
            </span>
          </div>

          <h3 class="interview-weak-spots__title">
            {{ weakSpot.title }}
          </h3>

          <p
            v-if="weakSpot.latestQuestionPrompt"
            class="interview-weak-spots__copy"
          >
            {{ weakSpot.latestQuestionPrompt }}
          </p>

          <div class="interview-weak-spots__scores">
            <span
              v-if="weakSpot.latestKnowledgeBaseScore !== null"
              class="interview-weak-spots__score-pill"
            >
              База знаний: {{ weakSpot.latestKnowledgeBaseScore }}/10
            </span>
            <span
              v-if="weakSpot.latestGeneralKnowledgeScore !== null"
              class="interview-weak-spots__score-pill"
            >
              Общие знания: {{ weakSpot.latestGeneralKnowledgeScore }}/10
            </span>
          </div>

          <p class="interview-weak-spots__recommendation">
            {{ weakSpot.recommendation }}
          </p>

          <button
            class="app-button app-button--secondary"
            type="button"
            :disabled="isBusy"
            @click="emit('repeat', weakSpot)"
          >
            Повторить это место
          </button>
        </article>
      </div>
    </template>

    <p v-else class="muted">
      После нескольких проверенных ответов здесь появятся темы и заметки, к которым полезно вернуться.
    </p>
  </SurfaceCard>
</template>

<style scoped>
.interview-weak-spots__list {
  display: grid;
  grid-template-columns: 1fr;
  gap: 0.72rem;
}

.interview-weak-spots__card {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.95rem;
  border: 1px solid rgba(180, 154, 123, 0.24);
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.42);
}

.interview-weak-spots__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.72rem;
}

.interview-weak-spots__primary-action {
  flex: 1 1 100%;
}

.interview-weak-spots__title,
.interview-weak-spots__copy,
.interview-weak-spots__recommendation,
.interview-weak-spots__empty {
  margin: 0;
}

.interview-weak-spots__title {
  color: var(--text);
  font-size: 0.98rem;
  line-height: 1.3;
}

.interview-weak-spots__copy,
.interview-weak-spots__recommendation,
.interview-weak-spots__empty {
  color: var(--text-muted);
  font-size: 0.92rem;
  line-height: 1.42;
}

.interview-weak-spots__recommendation {
  color: var(--text);
  font-weight: 600;
}

.interview-weak-spots__scores,
.interview-weak-spots__tags {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.interview-weak-spots__score-pill {
  display: inline-flex;
  align-items: center;
  padding: 0.36rem 0.66rem;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.8);
  color: var(--text-muted);
  font-size: 0.8rem;
  font-weight: 700;
}

@media (min-width: 720px) {
  .interview-weak-spots__list {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
