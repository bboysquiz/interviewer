<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { storeToRefs } from 'pinia'

import {
  formatInterviewHistoryDate,
  getInterviewHistoryEvaluation,
  getInterviewHistoryOccurredAt,
  getInterviewHistoryQuestion,
  getInterviewHistorySourceLabel,
  getInterviewResultStatus,
  buildInterviewWeakSpots,
  isWeakInterviewEvaluation,
} from '@/entities/interview'
import AppNotice from '@/shared/ui/AppNotice.vue'
import SurfaceCard from '@/shared/ui/SurfaceCard.vue'
import { useInterviewHistoryStore } from '@/stores/interviewHistory'
import { useKnowledgeBaseStore } from '@/stores/knowledgeBase'

const historyStore = useInterviewHistoryStore()
const knowledgeBaseStore = useKnowledgeBaseStore()

const { records, isLoading, loadError } = storeToRefs(historyStore)
const { categories } = storeToRefs(knowledgeBaseStore)

const categoryNameById = computed<Record<string, string>>(() =>
  Object.fromEntries(
    categories.value.map((category) => [category.id, category.name]),
  ),
)

const completedRecords = computed(() =>
  records.value.filter((record) => record.evaluations.length > 0),
)
const weakSpots = computed(() => buildInterviewWeakSpots(completedRecords.value))

const sessionCards = computed(() =>
  completedRecords.value.map((record) => {
    const question = getInterviewHistoryQuestion(record)
    const evaluation = getInterviewHistoryEvaluation(record)
    const status = evaluation ? getInterviewResultStatus(evaluation) : null
    const categoryName = record.session.categoryId
      ? categoryNameById.value[record.session.categoryId] ?? null
      : null

    return {
      id: record.session.id,
      title: record.session.title,
      sourceLabel: getInterviewHistorySourceLabel(record.session),
      categoryName,
      dateLabel: formatInterviewHistoryDate(getInterviewHistoryOccurredAt(record)),
      questionPrompt: question?.prompt ?? 'Вопрос не найден.',
      summary:
        evaluation?.overallSummary ??
        evaluation?.knowledgeBase.comment ??
        'Результат проверки сохранен в истории.',
      kbScore: evaluation
        ? `${evaluation.knowledgeBase.score}/${evaluation.knowledgeBase.maxScore}`
        : null,
      generalScore: evaluation
        ? `${evaluation.generalKnowledge.score}/${evaluation.generalKnowledge.maxScore}`
        : null,
      status,
      needsReview: evaluation ? isWeakInterviewEvaluation(evaluation) : false,
    }
  }),
)

const loadHistory = async (): Promise<void> => {
  try {
    if (!knowledgeBaseStore.hasLoaded) {
      await knowledgeBaseStore.loadCategories()
    }

    await historyStore.loadHistory({ force: true })
  } catch {
    // The page renders the store error state.
  }
}

onMounted(async () => {
  await loadHistory()
})
</script>

<template>
  <div class="page-stack history-page">
    <SurfaceCard eyebrow="Журнал" title="История интервью-попыток">
      <p class="lead">
        Здесь сохраняются прошлые вопросы, ответы, оценки и исправленные
        формулировки, чтобы можно было быстро вернуться к неудачным местам.
      </p>

      <div class="history-page__actions">
        <button
          class="app-button app-button--secondary"
          type="button"
          :disabled="isLoading"
          @click="void loadHistory()"
        >
          {{ isLoading ? 'Обновляем историю...' : 'Обновить историю' }}
        </button>
      </div>

      <AppNotice
        v-if="isLoading && completedRecords.length"
        tone="loading"
        title="Обновляем историю"
        message="Подтягиваем последние проверки, не скрывая уже сохранённые попытки."
      />

      <AppNotice
        v-if="loadError && completedRecords.length"
        tone="warning"
        title="История обновилась не полностью"
        :message="loadError"
      >
        <template #actions>
          <button
            class="app-button app-button--secondary"
            type="button"
            :disabled="isLoading"
            @click="void loadHistory()"
          >
            {{ isLoading ? 'Пробуем снова...' : 'Повторить' }}
          </button>
        </template>
      </AppNotice>
    </SurfaceCard>

    <SurfaceCard
      v-if="weakSpots.length"
      eyebrow="Повторение"
      title="Что стоит повторить"
    >
      <p class="muted">
        Ниже темы и заметки, где баллы были низкими. Их удобно быстро прогнать
        еще раз через режим собеседования.
      </p>

      <div class="history-page__weak-list">
        <article
          v-for="weakSpot in weakSpots.slice(0, 5)"
          :key="weakSpot.id"
          class="history-page__weak-card"
        >
          <div class="tag-row history-page__tag-row">
            <span class="tag">{{ weakSpot.sourceLabel }}</span>
            <span class="tag">{{ weakSpot.priorityLabel }}</span>
            <span v-if="weakSpot.attempts > 1" class="tag">
              {{ weakSpot.attempts }} слабых попытки
            </span>
          </div>

          <h3 class="history-page__title">
            {{ weakSpot.title }}
          </h3>

          <p v-if="weakSpot.latestQuestionPrompt" class="history-page__question">
            {{ weakSpot.latestQuestionPrompt }}
          </p>

          <p class="history-page__summary">
            {{ weakSpot.recommendation }}
          </p>

          <div class="history-page__scores">
            <span
              v-if="weakSpot.latestKnowledgeBaseScore !== null"
              class="history-page__score-pill"
            >
              База знаний: {{ weakSpot.latestKnowledgeBaseScore }}/10
            </span>
            <span
              v-if="weakSpot.latestGeneralKnowledgeScore !== null"
              class="history-page__score-pill"
            >
              Общие знания: {{ weakSpot.latestGeneralKnowledgeScore }}/10
            </span>
          </div>
        </article>
      </div>

      <div class="history-page__actions">
        <RouterLink
          class="app-button app-button--primary history-page__primary-action"
          :to="{ name: 'interview' }"
        >
          Открыть режим повтора
        </RouterLink>
      </div>
    </SurfaceCard>

    <SurfaceCard
      v-if="isLoading && !completedRecords.length"
      eyebrow="Загрузка"
      title="Поднимаем историю"
    >
      <div class="history-page__state">
        Загружаем прошлые попытки и разбор ответов.
      </div>
    </SurfaceCard>

    <SurfaceCard
      v-else-if="loadError && !completedRecords.length"
      eyebrow="Ошибка"
      title="Не удалось загрузить историю"
    >
      <div class="history-page__state history-page__state--error">
        <p class="history-page__state-copy">{{ loadError }}</p>
        <button
          class="app-button app-button--primary"
          type="button"
          @click="void loadHistory()"
        >
          Повторить
        </button>
      </div>
    </SurfaceCard>

    <SurfaceCard
      v-else-if="!completedRecords.length"
      eyebrow="Пока пусто"
      title="История появится после первой проверки"
    >
      <div class="history-page__state">
        Сгенерируй вопрос в режиме собеседования, ответь на него и проверь
        ответ. После этого попытка появится здесь.
      </div>
    </SurfaceCard>

    <SurfaceCard
      v-else
      eyebrow="Сессии"
      title="Прошлые попытки"
    >
      <div class="history-page__list">
        <RouterLink
          v-for="session in sessionCards"
          :key="session.id"
          class="history-page__card"
          :to="{
            name: 'history-detail',
            params: {
              sessionId: session.id,
            },
          }"
        >
          <div class="history-page__card-top">
            <div class="tag-row history-page__tag-row">
              <span class="tag">{{ session.sourceLabel }}</span>
              <span v-if="session.categoryName" class="tag">
                {{ session.categoryName }}
              </span>
              <span v-if="session.needsReview" class="tag">
                Повторить
              </span>
            </div>
            <span
              v-if="session.status"
              class="history-page__status"
              :class="`history-page__status--${session.status.key}`"
            >
              {{ session.status.label }}
            </span>
          </div>

          <p class="history-page__date">
            {{ session.dateLabel }}
          </p>

          <h3 class="history-page__title">
            {{ session.title }}
          </h3>

          <p class="history-page__question">
            {{ session.questionPrompt }}
          </p>

          <p class="history-page__summary">
            {{ session.summary }}
          </p>

          <div class="history-page__scores">
            <span v-if="session.kbScore" class="history-page__score-pill">
              База знаний: {{ session.kbScore }}
            </span>
            <span v-if="session.generalScore" class="history-page__score-pill">
              Общие знания: {{ session.generalScore }}
            </span>
          </div>

          <span class="history-page__details-link">Открыть детали</span>
        </RouterLink>
      </div>
    </SurfaceCard>
  </div>
</template>

<style scoped>
.history-page__state,
.history-page__state--error {
  display: flex;
  flex-direction: column;
  gap: 0.8rem;
  padding: 1rem;
  border-radius: 18px;
  border: 1px dashed rgba(180, 154, 123, 0.36);
  color: var(--text-muted);
  text-align: center;
}

.history-page__state--error {
  border-style: solid;
  border-color: rgba(181, 65, 59, 0.22);
  background: rgba(181, 65, 59, 0.08);
  color: #9f3b35;
}

.history-page__state-copy {
  margin: 0;
}

.history-page__list {
  display: flex;
  flex-direction: column;
  gap: 0.78rem;
}

.history-page__weak-list {
  display: flex;
  flex-direction: column;
  gap: 0.78rem;
}

.history-page__card,
.history-page__weak-card {
  display: flex;
  flex-direction: column;
  gap: 0.68rem;
  padding: 1.02rem;
  border: 1px solid rgba(180, 154, 123, 0.22);
  border-radius: 22px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.76), rgba(255, 250, 243, 0.58));
  box-shadow: 0 12px 24px rgba(71, 50, 24, 0.06);
  transition:
    border-color 0.18s ease,
    box-shadow 0.18s ease,
    transform 0.18s ease;
}

.history-page__weak-card {
  background:
    linear-gradient(180deg, rgba(255, 248, 241, 0.92), rgba(255, 244, 234, 0.78));
}

.history-page__card:active {
  transform: translateY(1px);
}

.history-page__card:hover {
  border-color: rgba(31, 109, 90, 0.22);
  box-shadow: 0 10px 24px rgba(71, 50, 24, 0.08);
}

.history-page__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem;
}

.history-page__primary-action {
  width: 100%;
}

.history-page__card-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.72rem;
}

.history-page__tag-row {
  margin-top: 0;
}

.history-page__status {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  padding: 0.36rem 0.6rem;
  border-radius: 999px;
  font-size: 0.74rem;
  font-weight: 800;
}

.history-page__status--excellent {
  background: rgba(31, 109, 90, 0.12);
  color: var(--accent-strong);
}

.history-page__status--good {
  background: rgba(207, 116, 64, 0.12);
  color: var(--highlight);
}

.history-page__status--needs_work {
  background: rgba(181, 65, 59, 0.12);
  color: #9f3b35;
}

.history-page__date,
.history-page__summary,
.history-page__question {
  margin: 0;
  color: var(--text-muted);
  font-size: 0.9rem;
  line-height: 1.48;
}

.history-page__date {
  font-size: 0.82rem;
}

.history-page__title {
  margin: 0;
  font-size: 1.03rem;
  line-height: 1.32;
}

.history-page__question {
  color: var(--text);
  font-weight: 700;
}

.history-page__scores {
  display: flex;
  flex-wrap: wrap;
  gap: 0.48rem;
}

.history-page__score-pill,
.history-page__details-link {
  display: inline-flex;
  align-items: center;
  width: fit-content;
  padding: 0.38rem 0.62rem;
  border-radius: 999px;
  font-size: 0.78rem;
  font-weight: 700;
}

.history-page__score-pill {
  background: rgba(35, 28, 21, 0.06);
  color: var(--text-muted);
}

.history-page__details-link {
  background: rgba(31, 109, 90, 0.12);
  color: var(--accent-strong);
}

@media (min-width: 420px) {
  .history-page__primary-action {
    width: auto;
    min-width: 12rem;
  }
}
</style>
