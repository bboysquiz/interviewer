<script setup lang="ts">
import { computed, onBeforeUnmount, watchEffect } from 'vue'

import { openImageViewer } from '@/features/images/imageViewer'
import {
  clearContextualFooter,
  setContextualFooter,
} from '@/features/navigation/contextualFooter'
import InterviewAnswerComposer from '@/features/interview/InterviewAnswerComposer.vue'
import InterviewResultPanel from '@/features/interview/InterviewResultPanel.vue'
import InterviewWeakSpotsPanel from '@/features/interview/InterviewWeakSpotsPanel.vue'
import { useInterviewPractice } from '@/features/interview/useInterviewPractice'
import AppNotice from '@/shared/ui/AppNotice.vue'
import SurfaceCard from '@/shared/ui/SurfaceCard.vue'

const {
  answerHelperText,
  answerText,
  canEvaluateAnswer,
  canFinishFullInterview,
  canGenerateNextFullInterviewQuestion,
  canGenerateQuestion,
  canStartFullInterview,
  canUseAnswerVoiceInput,
  canUseQuestionSpeech,
  categories,
  categoriesLoadError,
  closeInterviewSection,
  evaluationError,
  evaluationProvider,
  evaluationResponse,
  finishFullInterview,
  fullInterviewCoveredFoundationCount,
  fullInterviewElapsedLabel,
  fullInterviewEntries,
  fullInterviewProgressPercent,
  fullInterviewRemainingFoundations,
  fullInterviewSummary,
  fullInterviewTotalFoundationCount,
  generateNextFullInterviewQuestion,
  generateQuestion,
  generationError,
  hasCategories,
  historyLoadError,
  interviewSection,
  isCategoriesLoading,
  isEvaluating,
  isFullInterviewActive,
  isGenerating,
  isHistoryLoading,
  isListeningToAnswer,
  isQuestionFoundationVisible,
  isQuestionSpeaking,
  openInterviewSection,
  questionFoundationItems,
  questionProvider,
  questionResponse,
  reloadCategories,
  repeatWeakSpot,
  sectionOptions,
  selectedCategoryId,
  speakQuestion,
  startFullInterview,
  toggleAnswerListening,
  toggleQuestionFoundation,
  voiceFeatureError,
  weakSpots,
  evaluateAnswer,
} = useInterviewPractice()

const currentSectionTitle = computed(
  () =>
    sectionOptions.find((item) => item.id === interviewSection.value)?.title ??
    'Собес',
)

const openFoundationImage = (
  item: (typeof questionFoundationItems.value)[number],
): void => {
  if (!item.imageUrl) {
    return
  }

  openImageViewer({
    src: item.imageUrl,
    alt: 'Основа вопроса',
    title: item.lastQuestionedLabel
      ? `Основа вопроса · ${item.lastQuestionedLabel}`
      : 'Основа вопроса',
  })
}

watchEffect(() => {
  if (!interviewSection.value) {
    clearContextualFooter()
    return
  }

  setContextualFooter({
    title: currentSectionTitle.value,
    onBack: closeInterviewSection,
  })
})

onBeforeUnmount(() => {
  clearContextualFooter()
})
</script>

<template>
  <div class="page-stack interview-page">
    <SurfaceCard v-if="!interviewSection">
      <div class="interview-page__section-grid">
        <button
          v-for="option in sectionOptions"
          :key="option.id"
          class="interview-page__section-card"
          type="button"
          @click="openInterviewSection(option.id)"
        >
          <span class="interview-page__section-title">{{ option.title }}</span>
          <span class="interview-page__section-copy">{{ option.description }}</span>
        </button>
      </div>
    </SurfaceCard>

    <InterviewWeakSpotsPanel
      v-if="interviewSection === 'weak_spots'"
      :weak-spots="weakSpots"
      :is-loading="isHistoryLoading"
      :is-busy="isGenerating || isEvaluating"
      :is-generating="isGenerating"
      :load-error="historyLoadError"
      @repeat="void repeatWeakSpot($event)"
    />

    <template v-else-if="interviewSection">
      <SurfaceCard>
        <AppNotice
          v-if="isCategoriesLoading && !hasCategories"
          tone="loading"
          title="Загружаем категории"
          message="Подтягиваем темы и заметки, чтобы собрать вопрос по твоей базе знаний."
        />

        <AppNotice
          v-if="categoriesLoadError"
          tone="error"
          title="Не удалось загрузить категории"
          :message="categoriesLoadError"
        >
          <template #actions>
            <button
              class="app-button app-button--secondary"
              type="button"
              :disabled="isCategoriesLoading"
              @click="void reloadCategories()"
            >
              {{ isCategoriesLoading ? 'Пробуем снова...' : 'Повторить' }}
            </button>
          </template>
        </AppNotice>

        <div v-if="!hasCategories" class="interview-page__empty">
          Сначала создай хотя бы одну категорию и заметку, чтобы собеседование
          получило материал для вопросов.
        </div>

        <template v-else>
          <label class="interview-page__inline-field">
            <span class="interview-page__inline-label">Категория</span>
            <select v-model="selectedCategoryId" class="interview-page__select">
              <option
                v-for="category in categories"
                :key="category.id"
                :value="category.id"
              >
                {{ category.name }}
              </option>
            </select>
          </label>

          <div
            v-if="interviewSection === 'full'"
            class="interview-page__session-toolbar"
          >
            <div class="tag-row interview-page__session-tags">
              <span class="tag">Время: {{ fullInterviewElapsedLabel }}</span>
              <span class="tag">
                Прогресс: {{ fullInterviewProgressPercent }}%
              </span>
              <span
                v-if="fullInterviewTotalFoundationCount > 0"
                class="tag"
              >
                Охвачено: {{ fullInterviewCoveredFoundationCount }}/{{ fullInterviewTotalFoundationCount }}
              </span>
              <span
                v-if="fullInterviewTotalFoundationCount > 0"
                class="tag"
              >
                Осталось оснований: {{ fullInterviewRemainingFoundations }}
              </span>
              <span v-if="isFullInterviewActive" class="tag">Сессия активна</span>
              <span v-else-if="fullInterviewEntries.length" class="tag">
                Сессия завершена
              </span>
              <span
                v-if="isFullInterviewActive && fullInterviewTotalFoundationCount > 0 && fullInterviewRemainingFoundations === 0"
                class="tag"
              >
                Заметка пройдена
              </span>
            </div>

            <div class="interview-page__actions">
              <button
                v-if="!isFullInterviewActive"
                class="app-button app-button--primary interview-page__primary-action"
                type="button"
                :disabled="!canStartFullInterview"
                @click="void startFullInterview()"
              >
                {{
                  isGenerating
                    ? 'Запускаем...'
                    : fullInterviewEntries.length
                      ? 'Новая сессия'
                      : 'Начать сессию'
                }}
              </button>

              <button
                v-if="fullInterviewEntries.length && isFullInterviewActive"
                class="app-button app-button--primary interview-page__primary-action"
                type="button"
                :disabled="!canGenerateNextFullInterviewQuestion"
                @click="void generateNextFullInterviewQuestion()"
              >
                {{ isGenerating ? 'Генерируем...' : 'Следующий вопрос' }}
              </button>

              <button
                v-if="fullInterviewEntries.length"
                class="app-button app-button--secondary"
                type="button"
                :disabled="!canFinishFullInterview"
                @click="finishFullInterview()"
              >
                Завершить сессию
              </button>
            </div>
          </div>

          <div v-else class="interview-page__actions">
            <button
              class="app-button app-button--primary interview-page__primary-action"
              type="button"
              :disabled="!canGenerateQuestion"
              @click="void generateQuestion()"
            >
              {{ isGenerating ? 'Генерируем...' : 'Сгенерировать вопрос' }}
            </button>
          </div>

          <AppNotice
            v-if="isGenerating"
            tone="loading"
            title="Генерируем вопрос"
            message="Сервер собирает релевантные фрагменты базы знаний и отправляет их в AI-модель."
          />

          <AppNotice
            v-if="generationError"
            tone="error"
            title="Вопрос не сгенерирован"
            :message="generationError"
            compact
          />
        </template>
      </SurfaceCard>

      <SurfaceCard
        v-if="interviewSection === 'full' && fullInterviewSummary"
        eyebrow="Итог"
      >
        <div class="interview-page__session-summary-grid">
          <article class="summary-card">
            <span class="summary-card__label">Вердикт</span>
            <span class="summary-card__value">{{ fullInterviewSummary.verdict }}</span>
            <span class="summary-card__detail">{{ fullInterviewSummary.commentary }}</span>
          </article>
          <article class="summary-card">
            <span class="summary-card__label">База знаний</span>
            <span class="summary-card__value">
              {{ fullInterviewSummary.averageKnowledgeBaseScore }}/10
            </span>
            <span class="summary-card__detail">
              {{ fullInterviewSummary.answeredCount }} ответов из
              {{ fullInterviewSummary.questionCount }}
            </span>
          </article>
          <article class="summary-card">
            <span class="summary-card__label">Общие знания</span>
            <span class="summary-card__value">
              {{ fullInterviewSummary.averageGeneralKnowledgeScore }}/10
            </span>
            <span class="summary-card__detail">
              Средняя оценка по всей сессии
            </span>
          </article>
        </div>
      </SurfaceCard>

      <SurfaceCard v-if="questionResponse" eyebrow="Вопрос">
        <div class="tag-row interview-page__question-meta">
          <span
            v-if="questionProvider"
            class="interview-page__provider-badge"
            :class="`interview-page__provider-badge--${questionProvider.id}`"
            :title="questionProvider.modelName ?? questionProvider.label"
          >
            {{ questionProvider.label }}
          </span>
        </div>

        <p class="interview-page__question">{{ questionResponse.question.prompt }}</p>

        <p
          v-if="questionProvider?.modelName"
          class="interview-page__provider-caption"
        >
          {{ questionProvider.modelName }}
        </p>

        <div v-if="canUseQuestionSpeech" class="interview-page__voice-actions">
          <button
            class="app-button app-button--secondary interview-page__voice-button"
            type="button"
            @click="speakQuestion()"
          >
            {{ isQuestionSpeaking ? 'Остановить озвучку' : 'Озвучить вопрос' }}
          </button>
        </div>

        <div
          v-if="questionFoundationItems.length"
          class="interview-page__foundation"
        >
          <button
            class="app-button app-button--secondary"
            type="button"
            @click="toggleQuestionFoundation()"
          >
            {{
              isQuestionFoundationVisible
                ? 'Скрыть основу вопроса'
                : 'Показать основу вопроса'
            }}
          </button>

          <div
            v-if="isQuestionFoundationVisible"
            class="interview-page__foundation-list"
          >
            <article
              v-for="item in questionFoundationItems"
              :key="item.id"
              class="interview-page__foundation-card"
            >
              <img
                v-if="item.imageUrl"
                :src="item.imageUrl"
                alt="Основа вопроса"
                class="interview-page__foundation-image"
                @click="openFoundationImage(item)"
              />
              <p v-if="item.text" class="interview-page__foundation-text">
                {{ item.text }}
              </p>
              <p
                v-if="item.lastQuestionedLabel"
                class="interview-page__foundation-date"
              >
                Использовано: {{ item.lastQuestionedLabel }}
              </p>
            </article>
          </div>
        </div>

        <label class="interview-page__field">
          <span class="interview-page__label">Ответ</span>
          <InterviewAnswerComposer
            v-model="answerText"
            :disabled="isEvaluating"
            placeholder="Напиши ответ так, как сказал бы его на интервью."
          />
        </label>

        <div v-if="canUseAnswerVoiceInput" class="interview-page__voice-actions">
          <button
            class="app-button app-button--secondary interview-page__voice-button"
            type="button"
            @click="toggleAnswerListening()"
          >
            {{ isListeningToAnswer ? 'Остановить запись' : 'Голосовой ввод' }}
          </button>
        </div>

        <p v-if="answerHelperText" class="interview-page__answer-meta">
          {{ answerHelperText }}
        </p>

        <p v-if="voiceFeatureError" class="interview-page__voice-error">
          {{ voiceFeatureError }}
        </p>

        <div class="interview-page__actions">
          <button
            class="app-button app-button--primary interview-page__primary-action"
            type="button"
            :disabled="!canEvaluateAnswer"
            @click="void evaluateAnswer()"
          >
            {{ isEvaluating ? 'Проверяем...' : 'Проверить ответ' }}
          </button>
        </div>

        <AppNotice
          v-if="isEvaluating"
          tone="loading"
          title="Проверяем ответ"
          message="Сверяем ответ с твоей базой знаний и с общей технической картиной модели."
        />

        <AppNotice
          v-if="evaluationError"
          tone="error"
          title="Ответ не проверен"
          :message="evaluationError"
          compact
        />
      </SurfaceCard>

      <InterviewResultPanel
        v-if="evaluationResponse"
        :response="evaluationResponse"
        :provider="evaluationProvider"
      />
    </template>
  </div>
</template>

<style scoped>
.interview-page__section-grid,
.interview-page__foundation-list,
.interview-page__session-summary-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 0.72rem;
}

.interview-page__section-card {
  display: flex;
  flex-direction: column;
  gap: 0.38rem;
  padding: 1rem;
  border: 1px solid rgba(180, 154, 123, 0.24);
  border-radius: 22px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.76), rgba(255, 250, 243, 0.58));
  color: var(--text);
  text-align: left;
  box-shadow: 0 12px 24px rgba(71, 50, 24, 0.06);
  transition:
    transform 0.18s ease,
    border-color 0.18s ease,
    box-shadow 0.18s ease,
    background-color 0.18s ease;
}

.interview-page__section-title,
.interview-page__question {
  margin: 0;
  color: var(--text);
}

.interview-page__section-title {
  font-size: 1rem;
  font-weight: 700;
}

.interview-page__section-copy,
.interview-page__answer-meta,
.interview-page__voice-error,
.interview-page__foundation-date,
.interview-page__foundation-text,
.interview-page__empty {
  margin: 0;
  color: var(--text-muted);
  font-size: 0.92rem;
  line-height: 1.45;
}

.interview-page__inline-field,
.interview-page__field,
.interview-page__voice-actions,
.interview-page__foundation {
  display: flex;
  flex-direction: column;
  gap: 0.72rem;
}

.interview-page__inline-field {
  align-items: center;
}

.interview-page__inline-label,
.interview-page__label {
  color: var(--text-muted);
  font-size: 0.76rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.interview-page__actions,
.interview-page__session-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 0.72rem;
}

.interview-page__session-toolbar {
  align-items: center;
  justify-content: space-between;
}

.interview-page__session-tags,
.interview-page__question-meta {
  gap: 0.45rem;
}

.interview-page__primary-action {
  flex: 1 1 100%;
}

.interview-page__select {
  width: 100%;
  border: 1px solid rgba(180, 154, 123, 0.24);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.74);
  color: var(--text);
  font: inherit;
  outline: none;
  transition:
    border-color 0.2s ease,
    box-shadow 0.2s ease;
}

.interview-page__select {
  padding: 0.9rem 1rem;
}

.interview-page__select:focus {
  border-color: rgba(149, 90, 48, 0.48);
  box-shadow: 0 0 0 3px rgba(149, 90, 48, 0.12);
}

.interview-page__question {
  font-size: 1.04rem;
  font-weight: 700;
  line-height: 1.42;
}

.interview-page__provider-badge {
  display: inline-flex;
  align-items: center;
  padding: 0.32rem 0.7rem;
  border-radius: 999px;
  font-size: 0.76rem;
  font-weight: 700;
  letter-spacing: 0.03em;
  background: rgba(124, 87, 39, 0.1);
  color: var(--text);
}

.interview-page__provider-badge--gemini {
  background: rgba(196, 98, 44, 0.14);
  color: #8b461d;
}

.interview-page__provider-badge--groq {
  background: rgba(31, 109, 90, 0.14);
  color: #165a49;
}

.interview-page__provider-badge--other {
  background: rgba(88, 94, 112, 0.12);
  color: #4d5565;
}

.interview-page__provider-caption {
  margin: -0.2rem 0 0;
  color: var(--text-muted);
  font-size: 0.84rem;
}

.interview-page__voice-actions {
  align-items: flex-start;
}

.interview-page__voice-button {
  width: fit-content;
}

.interview-page__foundation-card {
  display: flex;
  flex-direction: column;
  gap: 0.72rem;
  padding: 0.92rem 0.96rem;
  border: 1px solid rgba(180, 154, 123, 0.18);
  border-radius: 20px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.76), rgba(255, 250, 243, 0.56));
}

.interview-page__foundation-image {
  width: 100%;
  border-radius: 16px;
  object-fit: contain;
  background: rgba(255, 255, 255, 0.72);
  cursor: zoom-in;
}

@media (hover: hover) {
  .interview-page__section-card:hover {
    transform: translateY(-1px);
    border-color: rgba(31, 109, 90, 0.16);
    box-shadow: 0 16px 28px rgba(71, 50, 24, 0.09);
  }
}

@media (min-width: 720px) {
  .interview-page__section-grid,
  .interview-page__foundation-list,
  .interview-page__session-summary-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .interview-page__inline-field {
    flex-direction: row;
  }

  .interview-page__inline-label {
    flex: 0 0 7rem;
  }
}

@media (min-width: 1100px) {
  .interview-page__section-grid,
  .interview-page__session-summary-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .interview-page__foundation-list {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .interview-page__section-card {
    min-height: 11.5rem;
    justify-content: space-between;
  }

  .interview-page__inline-field {
    align-items: center;
    gap: 1rem;
  }

  .interview-page__inline-label {
    flex: 0 0 8.5rem;
  }

  .interview-page__select {
    max-width: 26rem;
  }

  .interview-page__actions {
    align-items: center;
  }

  .interview-page__primary-action {
    flex: 0 0 auto;
    min-width: 16rem;
  }

  .interview-page__field {
    gap: 0.9rem;
  }

  .interview-page__question {
    max-width: 64rem;
    font-size: 1.16rem;
  }
}

@media (min-width: 1480px) {
  .interview-page__foundation-list {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}
</style>
