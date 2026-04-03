<script setup lang="ts">
import { computed } from 'vue'

import { getInterviewResultStatus } from '@/entities/interview'
import SurfaceCard from '@/shared/ui/SurfaceCard.vue'
import type { EvaluateInterviewAnswerResponse } from '@/types'

import InterviewEvaluationCard from './InterviewEvaluationCard.vue'

interface EvaluationScoreSummaryItem {
  id: 'knowledge-base' | 'general-knowledge'
  label: string
  value: string
  detail: string
}

const props = defineProps<{
  response: EvaluateInterviewAnswerResponse
  provider?: {
    id: 'gemini' | 'groq' | 'other'
    label: string
    modelName: string | null
  } | null
}>()

const evaluation = computed(() => props.response.evaluation)
const status = computed(() => getInterviewResultStatus(evaluation.value))
const summaryText = computed(
  () => evaluation.value.overallSummary ?? status.value.description,
)

const scoreSummary = computed<EvaluationScoreSummaryItem[]>(() => {
  const { knowledgeBase, generalKnowledge } = evaluation.value

  return [
    {
      id: 'knowledge-base',
      label: 'По базе знаний',
      value: `${knowledgeBase.score}/${knowledgeBase.maxScore}`,
      detail: knowledgeBase.isStrongAnswer
        ? 'Ответ хорошо совпадает с твоими заметками и материалами.'
        : 'Есть расхождения или недостающие детали относительно базы знаний.',
    },
    {
      id: 'general-knowledge',
      label: 'По общим знаниям',
      value: `${generalKnowledge.score}/${generalKnowledge.maxScore}`,
      detail: generalKnowledge.isStrongAnswer
        ? 'Ответ технически выглядит уверенно и с точки зрения модели.'
        : 'Есть неточности или пробелы с точки зрения общей технической картины.',
    },
  ]
})
</script>

<template>
  <SurfaceCard eyebrow="Результат" title="Разбор ответа">
    <section
      class="interview-result-panel__verdict"
      :class="`interview-result-panel__verdict--${status.key}`"
    >
      <div class="interview-result-panel__verdict-top">
        <div class="interview-result-panel__verdict-meta">
          <span class="interview-result-panel__verdict-label">
            {{ status.label }}
          </span>
          <span
            v-if="provider"
            class="interview-result-panel__provider-badge"
            :class="`interview-result-panel__provider-badge--${provider.id}`"
            :title="provider.modelName ?? provider.label"
          >
            {{ provider.label }}
          </span>
        </div>
        <span class="interview-result-panel__verdict-caption">
          Статус ответа
        </span>
      </div>

      <p class="interview-result-panel__verdict-copy">
        {{ summaryText }}
      </p>

      <p
        v-if="provider?.modelName"
        class="interview-result-panel__provider-caption"
      >
        {{ provider.modelName }}
      </p>
    </section>

    <div class="interview-result-panel__score-summary">
      <article
        v-for="item in scoreSummary"
        :key="item.id"
        class="summary-card interview-result-panel__summary-card"
      >
        <span class="summary-card__label">{{ item.label }}</span>
        <span class="summary-card__value">{{ item.value }}</span>
        <span class="summary-card__detail">{{ item.detail }}</span>
      </article>
    </div>

    <div class="interview-result-panel__results-stack">
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
</template>

<style scoped>
.interview-result-panel__score-summary {
  display: grid;
  grid-template-columns: 1fr;
  gap: 0.72rem;
}

.interview-result-panel__results-stack {
  display: flex;
  flex-direction: column;
  gap: 0.72rem;
}

.interview-result-panel__verdict {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.96rem 1rem;
  border-radius: 22px;
  border: 1px solid transparent;
}

.interview-result-panel__verdict--excellent {
  background: linear-gradient(180deg, rgba(31, 109, 90, 0.12), rgba(31, 109, 90, 0.06));
  border-color: rgba(31, 109, 90, 0.18);
}

.interview-result-panel__verdict--good {
  background: linear-gradient(180deg, rgba(207, 116, 64, 0.12), rgba(207, 116, 64, 0.06));
  border-color: rgba(207, 116, 64, 0.18);
}

.interview-result-panel__verdict--needs_work {
  background: linear-gradient(180deg, rgba(181, 65, 59, 0.12), rgba(181, 65, 59, 0.06));
  border-color: rgba(181, 65, 59, 0.18);
}

.interview-result-panel__verdict-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.72rem;
}

.interview-result-panel__verdict-meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.interview-result-panel__verdict-label {
  display: inline-flex;
  align-items: center;
  padding: 0.4rem 0.64rem;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.66);
  color: var(--text);
  font-size: 0.84rem;
  font-weight: 800;
}

.interview-result-panel__provider-badge {
  display: inline-flex;
  align-items: center;
  padding: 0.4rem 0.64rem;
  border-radius: 999px;
  font-size: 0.8rem;
  font-weight: 800;
  background: rgba(255, 255, 255, 0.66);
  color: var(--text);
}

.interview-result-panel__provider-badge--gemini {
  background: rgba(196, 98, 44, 0.14);
  color: #8b461d;
}

.interview-result-panel__provider-badge--groq {
  background: rgba(31, 109, 90, 0.14);
  color: #165a49;
}

.interview-result-panel__provider-badge--other {
  background: rgba(88, 94, 112, 0.12);
  color: #4d5565;
}

.interview-result-panel__verdict-caption {
  color: var(--text-muted);
  font-size: 0.76rem;
  font-weight: 700;
}

.interview-result-panel__verdict-copy,
.interview-result-panel__provider-caption {
  margin: 0;
  line-height: 1.48;
}

.interview-result-panel__provider-caption {
  color: var(--text-muted);
  font-size: 0.86rem;
}

@media (min-width: 420px) {
  .interview-result-panel__score-summary {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
