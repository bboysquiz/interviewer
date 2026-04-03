<script setup lang="ts">
import { computed, ref } from 'vue'

import {
  getInterviewCriterionTone,
} from '@/entities/interview'
import type { InterviewCriterionEvaluation } from '@/types'

const props = defineProps<{
  title: string
  evaluation: InterviewCriterionEvaluation
}>()

const isExpanded = ref(false)

const scoreLabel = computed(
  () => `${props.evaluation.score}/${props.evaluation.maxScore}`,
)

const scoreTone = computed(() => getInterviewCriterionTone(props.evaluation))

const scoreToneClass = computed(() => {
  if (scoreTone.value === 'strong') {
    return 'interview-evaluation-card__tone--strong'
  }

  if (scoreTone.value === 'medium') {
    return 'interview-evaluation-card__tone--medium'
  }

  return 'interview-evaluation-card__tone--weak'
})

const progressWidth = computed(() => {
  const ratio =
    props.evaluation.maxScore > 0
      ? props.evaluation.score / props.evaluation.maxScore
      : 0

  return `${Math.max(0, Math.min(100, Math.round(ratio * 100)))}%`
})

const improvementText = computed(() => {
  if (props.evaluation.improvementTip) {
    return props.evaluation.improvementTip
  }

  return props.evaluation.isStrongAnswer
    ? 'Ответ уже хороший, дополнительных правок по этому критерию не требуется.'
    : 'Усиль формулировку и добавь ключевые детали, которые сейчас упущены.'
})
</script>

<template>
  <article class="interview-evaluation-card">
    <button
      class="interview-evaluation-card__toggle"
      type="button"
      @click="isExpanded = !isExpanded"
    >
      <div class="interview-evaluation-card__top">
        <div class="interview-evaluation-card__heading">
          <h3 class="interview-evaluation-card__title">{{ title }}</h3>
          <span class="interview-evaluation-card__hint">
            {{ isExpanded ? 'Скрыть комментарий' : 'Показать комментарий' }}
          </span>
        </div>

        <span class="interview-evaluation-card__score" :class="scoreToneClass">
          {{ scoreLabel }}
        </span>
      </div>

      <div class="interview-evaluation-card__progress">
        <span
          class="interview-evaluation-card__progress-fill"
          :class="scoreToneClass"
          :style="{ width: progressWidth }"
        />
      </div>
    </button>

    <div v-if="isExpanded" class="interview-evaluation-card__details">
      <div class="interview-evaluation-card__section">
        <span class="interview-evaluation-card__label">Комментарий</span>
        <p class="interview-evaluation-card__text">
          {{ evaluation.comment }}
        </p>
      </div>

      <div class="interview-evaluation-card__section">
        <span class="interview-evaluation-card__label">Совет по улучшению</span>
        <p class="interview-evaluation-card__text">
          {{ improvementText }}
        </p>
      </div>

      <div
        v-if="evaluation.correctedAnswer"
        class="interview-evaluation-card__section"
      >
        <span class="interview-evaluation-card__label">Уточненный вариант</span>
        <p class="interview-evaluation-card__text">
          {{ evaluation.correctedAnswer }}
        </p>
      </div>
    </div>
  </article>
</template>

<style scoped>
.interview-evaluation-card {
  display: flex;
  flex-direction: column;
  gap: 0.78rem;
  padding: 1rem;
  border: 1px solid rgba(180, 154, 123, 0.22);
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.46);
}

.interview-evaluation-card__toggle {
  display: flex;
  flex-direction: column;
  gap: 0.72rem;
  width: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  text-align: left;
}

.interview-evaluation-card__top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.72rem;
}

.interview-evaluation-card__heading {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.32rem;
}

.interview-evaluation-card__title {
  margin: 0;
  font-size: 1rem;
  line-height: 1.24;
}

.interview-evaluation-card__hint {
  color: var(--text-muted);
  font-size: 0.78rem;
  font-weight: 700;
}

.interview-evaluation-card__score {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: fit-content;
  padding: 0.4rem 0.64rem;
  border-radius: 999px;
  font-size: 0.82rem;
  font-weight: 800;
  flex-shrink: 0;
  min-width: 4rem;
}

.interview-evaluation-card__tone--strong {
  background: rgba(31, 109, 90, 0.12);
  color: var(--accent-strong);
}

.interview-evaluation-card__tone--medium {
  background: rgba(207, 116, 64, 0.12);
  color: var(--highlight);
}

.interview-evaluation-card__tone--weak {
  background: rgba(181, 65, 59, 0.12);
  color: #9f3b35;
}

.interview-evaluation-card__progress {
  position: relative;
  width: 100%;
  height: 0.52rem;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(35, 28, 21, 0.08);
}

.interview-evaluation-card__progress-fill {
  display: block;
  height: 100%;
  border-radius: inherit;
}

.interview-evaluation-card__progress-fill.interview-evaluation-card__tone--strong {
  background: linear-gradient(90deg, rgba(31, 109, 90, 0.7), var(--accent));
}

.interview-evaluation-card__progress-fill.interview-evaluation-card__tone--medium {
  background: linear-gradient(90deg, rgba(207, 116, 64, 0.72), var(--highlight));
}

.interview-evaluation-card__progress-fill.interview-evaluation-card__tone--weak {
  background: linear-gradient(90deg, rgba(181, 65, 59, 0.74), #b5413b);
}

.interview-evaluation-card__details,
.interview-evaluation-card__section {
  display: flex;
  flex-direction: column;
  gap: 0.28rem;
}

.interview-evaluation-card__label {
  color: var(--text-muted);
  font-size: 0.74rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.interview-evaluation-card__text {
  margin: 0;
  color: var(--text-muted);
  font-size: 0.92rem;
  line-height: 1.45;
}
</style>
