<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { storeToRefs } from 'pinia'
import { useRoute } from 'vue-router'

import {
  formatInterviewHistoryDate,
  getInterviewHistoryEvaluation,
  getInterviewHistoryOccurredAt,
  getInterviewHistoryQuestion,
  getInterviewHistorySourceLabel,
  getInterviewResultStatus,
} from '@/entities/interview'
import InterviewEvaluationCard from '@/features/interview/InterviewEvaluationCard.vue'
import SurfaceCard from '@/shared/ui/SurfaceCard.vue'
import { useInterviewHistoryStore } from '@/stores/interviewHistory'
import { useKnowledgeBaseStore } from '@/stores/knowledgeBase'

const route = useRoute()
const historyStore = useInterviewHistoryStore()
const knowledgeBaseStore = useKnowledgeBaseStore()

const { recordsBySessionId, detailErrors, detailLoadingState } =
  storeToRefs(historyStore)
const { categories } = storeToRefs(knowledgeBaseStore)

const sessionId = computed(() => String(route.params.sessionId ?? ''))

const record = computed(() => recordsBySessionId.value[sessionId.value] ?? null)
const question = computed(() =>
  record.value ? getInterviewHistoryQuestion(record.value) : null,
)
const evaluation = computed(() =>
  record.value ? getInterviewHistoryEvaluation(record.value) : null,
)
const status = computed(() =>
  evaluation.value ? getInterviewResultStatus(evaluation.value) : null,
)
const categoryName = computed(() => {
  if (!record.value?.session.categoryId) {
    return null
  }

  return (
    categories.value.find(
      (category) => category.id === record.value?.session.categoryId,
    )?.name ?? null
  )
})
const occurredAtLabel = computed(() =>
  record.value
    ? formatInterviewHistoryDate(getInterviewHistoryOccurredAt(record.value))
    : null,
)
const detailError = computed(
  () => detailErrors.value[sessionId.value] ?? null,
)
const isLoading = computed(
  () => detailLoadingState.value[sessionId.value] ?? false,
)

const loadRecord = async (): Promise<void> => {
  if (!sessionId.value) {
    return
  }

  try {
    if (!knowledgeBaseStore.hasLoaded) {
      await knowledgeBaseStore.loadCategories()
    }

    await historyStore.loadHistoryRecord(sessionId.value, { force: true })
  } catch {
    // The page renders the store error state.
  }
}

onMounted(async () => {
  await loadRecord()
})
</script>

<template>
  <div class="page-stack history-detail-page">
    <SurfaceCard
      v-if="isLoading && !record"
      eyebrow="Загрузка"
      title="Открываем попытку"
    >
      <div class="history-detail-page__state">
        Загружаем вопрос, ответ и результаты прошлой сессии.
      </div>
    </SurfaceCard>

    <SurfaceCard
      v-else-if="detailError && !record"
      eyebrow="Ошибка"
      title="Не удалось открыть попытку"
    >
      <div class="history-detail-page__state history-detail-page__state--error">
        <p class="history-detail-page__state-copy">{{ detailError }}</p>
        <button
          class="app-button app-button--primary"
          type="button"
          @click="void loadRecord()"
        >
          Повторить
        </button>
      </div>
    </SurfaceCard>

    <template v-else-if="record">
      <SurfaceCard eyebrow="Сессия" title="Детали попытки">
        <div class="tag-row history-detail-page__tag-row">
          <span class="tag">
            {{ getInterviewHistorySourceLabel(record.session) }}
          </span>
          <span v-if="categoryName" class="tag">
            {{ categoryName }}
          </span>
          <span v-if="occurredAtLabel" class="tag">
            {{ occurredAtLabel }}
          </span>
        </div>

        <h2 class="history-detail-page__title">
          {{ record.session.title }}
        </h2>

        <section
          v-if="status"
          class="history-detail-page__verdict"
          :class="`history-detail-page__verdict--${status.key}`"
        >
          <div class="history-detail-page__verdict-top">
            <span class="history-detail-page__verdict-label">
              {{ status.label }}
            </span>
            <span class="history-detail-page__verdict-caption">
              Статус ответа
            </span>
          </div>
          <p class="history-detail-page__verdict-copy">
            {{ evaluation?.overallSummary ?? status.description }}
          </p>
        </section>
      </SurfaceCard>

      <SurfaceCard eyebrow="Вопрос" title="Что спросили">
        <p class="history-detail-page__question">
          {{ question?.prompt ?? 'Вопрос для этой попытки не найден.' }}
        </p>
      </SurfaceCard>

      <SurfaceCard eyebrow="Ответ" title="Что ты ответил">
        <p v-if="evaluation" class="history-detail-page__answer">
          {{ evaluation.answerText }}
        </p>
        <p v-else class="history-detail-page__answer history-detail-page__answer--muted">
          Ответ к этой сессии пока не сохранен.
        </p>
      </SurfaceCard>

      <SurfaceCard
        v-if="evaluation"
        eyebrow="Разбор"
        title="Оценки и комментарии"
      >
        <div class="history-detail-page__summary-grid">
          <article class="summary-card history-detail-page__summary-card">
            <span class="summary-card__label">По базе знаний</span>
            <span class="summary-card__value">
              {{ evaluation.knowledgeBase.score }}/{{ evaluation.knowledgeBase.maxScore }}
            </span>
            <span class="summary-card__detail">
              Комментарий и советы основаны на твоих заметках и материалах.
            </span>
          </article>

          <article class="summary-card history-detail-page__summary-card">
            <span class="summary-card__label">По общим знаниям</span>
            <span class="summary-card__value">
              {{ evaluation.generalKnowledge.score }}/{{ evaluation.generalKnowledge.maxScore }}
            </span>
            <span class="summary-card__detail">
              Эта оценка показывает, насколько ответ точен шире собственной базы знаний.
            </span>
          </article>
        </div>

        <div class="history-detail-page__results-grid">
          <InterviewEvaluationCard
            title="Точность по базе знаний"
            :evaluation="evaluation.knowledgeBase"
          />
          <InterviewEvaluationCard
            title="Точность по общим знаниям"
            :evaluation="evaluation.generalKnowledge"
          />
        </div>
      </SurfaceCard>

      <SurfaceCard
        v-if="evaluation"
        eyebrow="Исправление"
        title="Улучшенный вариант ответа"
      >
        <p
          v-if="evaluation.improvedAnswer"
          class="history-detail-page__improved-answer"
        >
          {{ evaluation.improvedAnswer }}
        </p>
        <p
          v-else
          class="history-detail-page__improved-answer history-detail-page__improved-answer--muted"
        >
          Явный исправленный вариант не потребовался: ответ был достаточно сильным.
        </p>
      </SurfaceCard>
    </template>
  </div>
</template>

<style scoped>
.history-detail-page__state,
.history-detail-page__state--error {
  display: flex;
  flex-direction: column;
  gap: 0.8rem;
  padding: 1rem;
  border-radius: 18px;
  border: 1px dashed rgba(180, 154, 123, 0.36);
  color: var(--text-muted);
  text-align: center;
}

.history-detail-page__state--error {
  border-style: solid;
  border-color: rgba(181, 65, 59, 0.22);
  background: rgba(181, 65, 59, 0.08);
  color: #9f3b35;
}

.history-detail-page__state-copy,
.history-detail-page__question,
.history-detail-page__answer,
.history-detail-page__improved-answer,
.history-detail-page__verdict-copy {
  margin: 0;
  line-height: 1.48;
}

.history-detail-page__tag-row {
  margin-top: 0;
}

.history-detail-page__title {
  margin: 0;
  font-size: 1.06rem;
  line-height: 1.35;
}

.history-detail-page__verdict {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.96rem 1rem;
  border-radius: 22px;
  border: 1px solid transparent;
}

.history-detail-page__verdict--excellent {
  background: linear-gradient(180deg, rgba(31, 109, 90, 0.12), rgba(31, 109, 90, 0.06));
  border-color: rgba(31, 109, 90, 0.18);
}

.history-detail-page__verdict--good {
  background: linear-gradient(180deg, rgba(207, 116, 64, 0.12), rgba(207, 116, 64, 0.06));
  border-color: rgba(207, 116, 64, 0.18);
}

.history-detail-page__verdict--needs_work {
  background: linear-gradient(180deg, rgba(181, 65, 59, 0.12), rgba(181, 65, 59, 0.06));
  border-color: rgba(181, 65, 59, 0.18);
}

.history-detail-page__verdict-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.72rem;
}

.history-detail-page__verdict-label {
  display: inline-flex;
  align-items: center;
  padding: 0.4rem 0.64rem;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.66);
  color: var(--text);
  font-size: 0.84rem;
  font-weight: 800;
}

.history-detail-page__verdict-caption {
  color: var(--text-muted);
  font-size: 0.76rem;
  font-weight: 700;
}

.history-detail-page__question {
  color: var(--text);
  font-size: 1rem;
  font-weight: 700;
}

.history-detail-page__answer,
.history-detail-page__improved-answer {
  color: var(--text);
  font-size: 0.94rem;
}

.history-detail-page__answer--muted,
.history-detail-page__improved-answer--muted {
  color: var(--text-muted);
}

.history-detail-page__summary-grid,
.history-detail-page__results-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 0.72rem;
}

.history-detail-page__summary-card {
  min-height: 100%;
}

@media (min-width: 420px) {
  .history-detail-page__summary-grid,
  .history-detail-page__results-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
