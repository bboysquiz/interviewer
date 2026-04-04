<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { storeToRefs } from 'pinia'

import AppNotice from '@/shared/ui/AppNotice.vue'
import SurfaceCard from '@/shared/ui/SurfaceCard.vue'
import { useAnalyticsStore } from '@/stores/analytics'

const analyticsStore = useAnalyticsStore()
const { aiSnapshot, hasLoaded, isLoading, loadError } = storeToRefs(analyticsStore)

const numberFormatter = new Intl.NumberFormat('ru-RU')

const formatNumber = (value: number | null | undefined): string => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return '—'
  }

  return numberFormatter.format(value)
}

const taskLabels = {
  interview_question_generation: 'Генерации вопросов',
  interview_answer_evaluation: 'Проверки ответов',
  image_analysis: 'Анализы скриншотов',
  note_organization: 'AI-сортировки конспекта',
} as const

const budgetMetaById = {
  question_generation: {
    title: 'Осталось генераций вопросов',
    detail: 'Если тратить доступный запас только на новые вопросы.',
  },
  answer_evaluation: {
    title: 'Осталось проверок ответов',
    detail: 'Если тратить доступный запас только на проверку ответа.',
  },
  image_analysis: {
    title: 'Осталось анализов скриншотов',
    detail: 'Сколько ещё скриншотов можно прогнать через OCR и описание.',
  },
  note_organization: {
    title: 'Осталось AI-сортировок конспекта',
    detail: 'Сколько ещё раз можно перегруппировать полотно темы через AI.',
  },
} as const

const providerLabels: Record<string, string> = {
  gemini: 'Gemini',
  groq: 'Groq',
  openai: 'OpenAI',
  unknown: 'Другое',
}

const channelLabels = {
  text: 'Текстовые запросы',
  image: 'Скриншоты',
} as const

const windowLabel = computed(() => {
  const hours = aiSnapshot.value?.windowHours ?? 24
  return `за последние ${hours} ч`
})

const budgetCards = computed(() =>
  (aiSnapshot.value?.friendlyBudgets ?? []).map((budget) => ({
    id: budget.id,
    title: budgetMetaById[budget.id].title,
    detail: budgetMetaById[budget.id].detail,
    remainingLabel:
      budget.remaining24h === null ? 'Лимит не задан' : formatNumber(budget.remaining24h),
    usedLabel: formatNumber(budget.used24h),
    limitLabel:
      budget.limit24h === null ? 'не задан' : formatNumber(budget.limit24h),
  })),
)

const rawMetricCards = computed(() => {
  const overview = aiSnapshot.value?.overview
  const attachments = aiSnapshot.value?.attachments

  return [
    {
      label: `Запросов ${windowLabel.value}`,
      value: formatNumber(overview?.lastWindow.requests ?? 0),
      detail: 'Все успешные AI-операции в окне аналитики.',
    },
    {
      label: `Input tokens ${windowLabel.value}`,
      value: formatNumber(overview?.lastWindow.inputTokens ?? 0),
      detail: 'Текст и контекст, отправленные в модели.',
    },
    {
      label: `Output tokens ${windowLabel.value}`,
      value: formatNumber(overview?.lastWindow.outputTokens ?? 0),
      detail: 'Ответы, которые вернули модели.',
    },
    {
      label: `Всего tokens ${windowLabel.value}`,
      value: formatNumber(overview?.lastWindow.totalTokens ?? 0),
      detail: 'Суммарный токеновый расход по успешным вызовам.',
    },
    {
      label: 'Запросов за всё время',
      value: formatNumber(overview?.allTime.requests ?? 0),
      detail: 'Все зафиксированные AI-операции с момента начала учёта.',
    },
    {
      label: 'Скриншотов готово',
      value: formatNumber(attachments?.ready ?? 0),
      detail: 'Вложения, которые уже можно полноценно использовать в вопросах.',
    },
  ]
})

const taskCards = computed(() =>
  (aiSnapshot.value?.tasks ?? []).map((task) => ({
    key: task.task,
    label: taskLabels[task.task],
    used24h: formatNumber(task.used24h),
    usedAllTime: formatNumber(task.usedAllTime),
  })),
)

const channelCards = computed(() =>
  (aiSnapshot.value?.channels ?? []).map((channel) => ({
    key: `${channel.provider}:${channel.channel}`,
    providerLabel: providerLabels[channel.provider] ?? channel.provider,
    channelLabel: channelLabels[channel.channel],
    used24h: formatNumber(channel.used24h),
    usedAllTime: formatNumber(channel.usedAllTime),
    limit24h: channel.limit24h === null ? 'не задан' : formatNumber(channel.limit24h),
    remaining24h:
      channel.remaining24h === null
        ? 'неизвестно'
        : formatNumber(channel.remaining24h),
    inputTokens: formatNumber(channel.inputTokens),
    outputTokens: formatNumber(channel.outputTokens),
    totalTokens: formatNumber(channel.totalTokens),
    models: channel.models,
  })),
)

const attachmentCards = computed(() => {
  const attachments = aiSnapshot.value?.attachments

  return [
    {
      label: 'Готово',
      value: formatNumber(attachments?.ready ?? 0),
    },
    {
      label: 'В очереди',
      value: formatNumber(attachments?.pending ?? 0),
    },
    {
      label: 'Обрабатываются',
      value: formatNumber(attachments?.processing ?? 0),
    },
    {
      label: 'С ошибкой',
      value: formatNumber(attachments?.failed ?? 0),
    },
  ]
})

const loadAnalytics = async (): Promise<void> => {
  try {
    await analyticsStore.loadAiAnalytics({ force: true })
  } catch {
    // The page renders the store error state.
  }
}

onMounted(async () => {
  await loadAnalytics()
})
</script>

<template>
  <div class="page-stack analytics-page">
    <SurfaceCard eyebrow="AI" title="Лимиты и использование">
      <p class="lead">
        Здесь видно, сколько AI уже использовано, какой запас ещё остался и на
        что он может уйти.
      </p>

      <AppNotice
        v-if="isLoading && !hasLoaded"
        tone="loading"
        title="Поднимаем аналитику"
        message="Собираем usage по вопросам, проверкам ответов и анализу скриншотов."
      />

      <AppNotice
        v-if="loadError && !aiSnapshot"
        tone="warning"
        title="Не удалось загрузить аналитику"
        :message="loadError"
      >
        <template #actions>
          <button
            class="app-button app-button--secondary"
            type="button"
            :disabled="isLoading"
            @click="void loadAnalytics()"
          >
            {{ isLoading ? 'Пробуем снова...' : 'Повторить' }}
          </button>
        </template>
      </AppNotice>

      <AppNotice
        v-else-if="aiSnapshot"
        tone="info"
        title="Как считать эти цифры"
        :message="`Остатки считаются по истории успешных запросов и лимитам, настроенным на сервере, ${windowLabel}.`"
      />
    </SurfaceCard>

    <SurfaceCard
      v-if="aiSnapshot"
      eyebrow="Понятно"
      title="Сколько ещё можно сделать"
    >
      <div class="analytics-page__budget-grid">
        <article
          v-for="budget in budgetCards"
          :key="budget.id"
          class="analytics-page__budget-card"
        >
          <span class="analytics-page__card-label">{{ budget.title }}</span>
          <strong class="analytics-page__budget-value">{{ budget.remainingLabel }}</strong>
          <p class="analytics-page__budget-meta">
            Использовано {{ budget.usedLabel }} из {{ budget.limitLabel }} {{ windowLabel }}
          </p>
          <p class="analytics-page__card-copy">{{ budget.detail }}</p>
        </article>
      </div>
    </SurfaceCard>

    <SurfaceCard
      v-if="aiSnapshot"
      eyebrow="Сырые метрики"
      title="Обычные измерения"
    >
      <div class="summary-grid">
        <article
          v-for="card in rawMetricCards"
          :key="card.label"
          class="summary-card"
        >
          <span class="summary-card__label">{{ card.label }}</span>
          <strong class="summary-card__value">{{ card.value }}</strong>
          <span class="summary-card__detail">{{ card.detail }}</span>
        </article>
      </div>
    </SurfaceCard>

    <SurfaceCard
      v-if="aiSnapshot"
      eyebrow="Операции"
      title="Что уже делали через AI"
    >
      <div class="analytics-page__task-list">
        <article
          v-for="task in taskCards"
          :key="task.key"
          class="analytics-page__task-card"
        >
          <h3 class="analytics-page__task-title">{{ task.label }}</h3>
          <div class="analytics-page__task-stats">
            <span class="chip">За 24ч: {{ task.used24h }}</span>
            <span class="chip">За всё время: {{ task.usedAllTime }}</span>
          </div>
        </article>
      </div>
    </SurfaceCard>

    <SurfaceCard
      v-if="aiSnapshot"
      eyebrow="Провайдеры"
      title="Разрез по нейросетям"
    >
      <div class="analytics-page__channel-list">
        <article
          v-for="channel in channelCards"
          :key="channel.key"
          class="analytics-page__channel-card"
        >
          <div class="analytics-page__channel-top">
            <div>
              <p class="analytics-page__channel-provider">
                {{ channel.providerLabel }}
              </p>
              <h3 class="analytics-page__channel-title">
                {{ channel.channelLabel }}
              </h3>
            </div>

            <div class="analytics-page__channel-pills">
              <span class="chip">Осталось: {{ channel.remaining24h }}</span>
              <span class="chip">Лимит: {{ channel.limit24h }}</span>
            </div>
          </div>

          <div class="analytics-page__channel-stats">
            <span class="tag">За 24ч: {{ channel.used24h }}</span>
            <span class="tag">За всё время: {{ channel.usedAllTime }}</span>
            <span class="tag">Input: {{ channel.inputTokens }}</span>
            <span class="tag">Output: {{ channel.outputTokens }}</span>
            <span class="tag">Total: {{ channel.totalTokens }}</span>
          </div>

          <div v-if="channel.models.length" class="tag-row analytics-page__models">
            <span
              v-for="model in channel.models"
              :key="model"
              class="tag"
            >
              {{ model }}
            </span>
          </div>
        </article>
      </div>
    </SurfaceCard>

    <SurfaceCard
      v-if="aiSnapshot"
      eyebrow="Скриншоты"
      title="Текущий статус вложений"
    >
      <div class="summary-grid">
        <article
          v-for="card in attachmentCards"
          :key="card.label"
          class="summary-card"
        >
          <span class="summary-card__label">{{ card.label }}</span>
          <strong class="summary-card__value">{{ card.value }}</strong>
        </article>
      </div>
    </SurfaceCard>
  </div>
</template>

<style scoped>
.analytics-page__budget-grid,
.analytics-page__task-list,
.analytics-page__channel-list {
  display: flex;
  flex-direction: column;
  gap: 0.78rem;
}

.analytics-page__budget-card,
.analytics-page__task-card,
.analytics-page__channel-card {
  padding: 1rem;
  border: 1px solid rgba(180, 154, 123, 0.22);
  border-radius: 20px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.82), rgba(255, 248, 240, 0.66));
  box-shadow: 0 10px 22px rgba(71, 50, 24, 0.06);
}

.analytics-page__card-label,
.analytics-page__channel-provider {
  display: block;
  margin: 0 0 0.34rem;
  color: var(--text-muted);
  font-size: 0.8rem;
  font-weight: 700;
}

.analytics-page__budget-value {
  display: block;
  font-size: 1.42rem;
  line-height: 1.08;
  letter-spacing: -0.04em;
}

.analytics-page__budget-meta,
.analytics-page__card-copy {
  margin: 0.3rem 0 0;
  color: var(--text-muted);
  font-size: 0.88rem;
  line-height: 1.45;
}

.analytics-page__task-title,
.analytics-page__channel-title {
  margin: 0;
  font-size: 1.02rem;
  line-height: 1.24;
}

.analytics-page__task-stats,
.analytics-page__channel-stats,
.analytics-page__channel-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 0.48rem;
  margin-top: 0.72rem;
}

.analytics-page__channel-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.8rem;
}

.analytics-page__models {
  margin-top: 0.82rem;
}

@media (min-width: 420px) {
  .analytics-page__budget-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .analytics-page__budget-card:first-child {
    grid-column: 1 / -1;
  }
}
</style>
