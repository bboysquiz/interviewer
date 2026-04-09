<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { storeToRefs } from 'pinia'

import AppNotice from '@/shared/ui/AppNotice.vue'
import SurfaceCard from '@/shared/ui/SurfaceCard.vue'
import { useAnalyticsStore } from '@/stores/analytics'
import type {
  AiAnalyticsFriendlyBudget,
  AiAnalyticsProviderRuntimeStatus,
} from '@/types'

const analyticsStore = useAnalyticsStore()
const { aiSnapshot, hasLoaded, isLoading, loadError } = storeToRefs(analyticsStore)

const numberFormatter = new Intl.NumberFormat('ru-RU')
const dateTimeFormatter = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
})

const formatNumber = (value: number | null | undefined): string => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return '—'
  }

  return numberFormatter.format(value)
}

const formatDateTime = (value: string | null | undefined): string => {
  if (!value) {
    return '—'
  }

  const parsed = new Date(value)

  if (Number.isNaN(parsed.getTime())) {
    return '—'
  }

  return dateTimeFormatter.format(parsed)
}

const formatRetryAfter = (value: number | null | undefined): string | null => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return null
  }

  const totalMinutes = Math.ceil(value / 60_000)

  if (totalMinutes < 60) {
    return `примерно ${totalMinutes} мин`
  }

  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60

  return minutes > 0
    ? `примерно ${hours} ч ${minutes} мин`
    : `примерно ${hours} ч`
}

const taskLabels = {
  interview_question_generation: 'Генерации вопросов',
  interview_answer_evaluation: 'Проверки ответов',
  image_analysis: 'Анализы скриншотов',
  note_organization: 'AI-сортировки конспекта',
} as const

const budgetMetaById = {
  question_generation: {
    title: 'Генерация вопросов',
    detail: 'Запас по текстовым вызовам для новых вопросов.',
  },
  answer_evaluation: {
    title: 'Проверка ответов',
    detail: 'Запас по текстовым вызовам для оценки ответов.',
  },
  image_analysis: {
    title: 'Анализ скриншотов',
    detail: 'Запас по image-вызовам для OCR и описания скринов.',
  },
  note_organization: {
    title: 'Упорядочивание конспекта',
    detail: 'Запас по текстовым вызовам для AI-сортировки заметки.',
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

const runtimeStateMeta: Record<
  AiAnalyticsProviderRuntimeStatus['state'],
  { label: string; tone: string }
> = {
  available: {
    label: 'Провайдер доступен',
    tone: 'success',
  },
  rate_limited: {
    label: 'Провайдер упёрся в rate limit',
    tone: 'warning',
  },
  quota_exhausted: {
    label: 'Квота провайдера исчерпана',
    tone: 'danger',
  },
  temporarily_unavailable: {
    label: 'Провайдер временно перегружен',
    tone: 'warning',
  },
  error: {
    label: 'Последний вызов завершился ошибкой',
    tone: 'danger',
  },
}

const windowLabel = computed(() => {
  const hours = aiSnapshot.value?.windowHours ?? 24
  return `за последние ${hours} ч`
})

const buildRuntimeSummary = (
  runtimeStatus: AiAnalyticsProviderRuntimeStatus | null,
): string | null => {
  if (!runtimeStatus) {
    return null
  }

  const parts: string[] = []

  if (runtimeStatus.limitDimension !== 'unknown') {
    parts.push(
      runtimeStatus.limitDimension === 'tokens' ? 'лимит по токенам' : 'лимит по запросам',
    )
  }

  if (runtimeStatus.window !== 'unknown') {
    parts.push(
      runtimeStatus.window === 'day' ? 'за день' : 'за минуту',
    )
  }

  if (
    runtimeStatus.limitValue !== null ||
    runtimeStatus.usedValue !== null ||
    runtimeStatus.requestedValue !== null
  ) {
    parts.push(
      [
        runtimeStatus.limitValue !== null ? `limit ${formatNumber(runtimeStatus.limitValue)}` : null,
        runtimeStatus.usedValue !== null ? `used ${formatNumber(runtimeStatus.usedValue)}` : null,
        runtimeStatus.requestedValue !== null
          ? `requested ${formatNumber(runtimeStatus.requestedValue)}`
          : null,
      ]
        .filter(Boolean)
        .join(' · '),
    )
  }

  const retryLabel = formatRetryAfter(runtimeStatus.retryAfterMs)

  if (retryLabel) {
    parts.push(`повторить ${retryLabel}`)
  }

  return parts.filter(Boolean).join(' · ') || runtimeStatus.message
}

const buildBudgetStatus = (budget: AiAnalyticsFriendlyBudget) => {
  if (budget.availabilityState === 'blocked') {
    return {
      value: 'Сейчас канал упёрся в лимит',
      tone: 'danger',
      detail:
        budget.availabilityMessage ??
        'Приложение сейчас не может гарантировать новые вызовы по этому каналу.',
    }
  }

  if (budget.availabilityState === 'degraded') {
    return {
      value:
        budget.remaining24h === null
          ? 'Локальная оценка недоступна'
          : `~${formatNumber(budget.remaining24h)}`,
      tone: 'warning',
      detail:
        budget.availabilityMessage ??
        'Часть провайдеров для этого канала сейчас ограничена.',
    }
  }

  if (budget.remaining24h === null) {
    return {
      value: 'Локальная оценка не задана',
      tone: 'neutral',
      detail: budget.availabilityMessage,
    }
  }

  return {
    value: `~${formatNumber(budget.remaining24h)}`,
    tone: 'neutral',
    detail: budget.availabilityMessage,
  }
}

const budgetCards = computed(() =>
  (aiSnapshot.value?.friendlyBudgets ?? []).map((budget) => {
    const status = buildBudgetStatus(budget)

    return {
      id: budget.id,
      title: budgetMetaById[budget.id].title,
      detail: budgetMetaById[budget.id].detail,
      value: status.value,
      tone: status.tone,
      providerMessage: status.detail,
      usedLabel: formatNumber(budget.used24h),
      limitLabel:
        budget.limit24h === null ? 'не задан' : formatNumber(budget.limit24h),
    }
  }),
)

const rawMetricCards = computed(() => {
  const overview = aiSnapshot.value?.overview
  const attachments = aiSnapshot.value?.attachments

  return [
    {
      label: `Успешных запросов ${windowLabel.value}`,
      value: formatNumber(overview?.lastWindow.requests ?? 0),
      detail: 'Только те AI-вызовы, которые приложение записало как успешные.',
    },
    {
      label: `Input tokens ${windowLabel.value}`,
      value: formatNumber(overview?.lastWindow.inputTokens ?? 0),
      detail: 'Текст и контекст, отправленные в модели по успешным вызовам.',
    },
    {
      label: `Output tokens ${windowLabel.value}`,
      value: formatNumber(overview?.lastWindow.outputTokens ?? 0),
      detail: 'Ответы моделей по успешным вызовам.',
    },
    {
      label: `Всего tokens ${windowLabel.value}`,
      value: formatNumber(overview?.lastWindow.totalTokens ?? 0),
      detail: 'Суммарный токеновый расход по успешным вызовам.',
    },
    {
      label: 'Успешных запросов за всё время',
      value: formatNumber(overview?.allTime.requests ?? 0),
      detail: 'История, которую приложение успело сохранить у себя.',
    },
    {
      label: 'Скриншотов готово',
      value: formatNumber(attachments?.ready ?? 0),
      detail: 'Вложения, которые уже можно использовать в вопросах и AI-сортировке.',
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
  (aiSnapshot.value?.channels ?? []).map((channel) => {
    const runtimeMeta = channel.runtimeStatus
      ? runtimeStateMeta[channel.runtimeStatus.state]
      : null

    return {
      key: `${channel.provider}:${channel.channel}`,
      providerLabel: providerLabels[channel.provider] ?? channel.provider,
      channelLabel: channelLabels[channel.channel],
      used24h: formatNumber(channel.used24h),
      usedAllTime: formatNumber(channel.usedAllTime),
      limit24h: channel.limit24h === null ? 'не задан' : formatNumber(channel.limit24h),
      remaining24h:
        channel.remaining24h === null ? 'неизвестно' : formatNumber(channel.remaining24h),
      inputTokens: formatNumber(channel.inputTokens),
      outputTokens: formatNumber(channel.outputTokens),
      totalTokens: formatNumber(channel.totalTokens),
      models: channel.models,
      runtimeLabel: runtimeMeta?.label ?? 'Живой статус провайдера пока не зафиксирован',
      runtimeTone: runtimeMeta?.tone ?? 'neutral',
      runtimeSummary: buildRuntimeSummary(channel.runtimeStatus),
      runtimeUpdatedAt: formatDateTime(channel.runtimeStatus?.updatedAt),
      runtimeMessage: channel.runtimeStatus?.message ?? null,
    }
  }),
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
        Здесь видно две разные вещи: локальный учёт приложения по успешным вызовам и
        живой статус лимитов у самих провайдеров.
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
        title="Как читать цифры"
        :message="`Числа вида “~8” и “лимит 20” — это только локальная оценка приложения по успешным вызовам ${windowLabel}. Реальный провайдер может упереться раньше в внешнюю квоту, rate limit или токены.`"
      />
    </SurfaceCard>

    <SurfaceCard
      v-if="aiSnapshot"
      eyebrow="Оценка приложения"
      title="Примерный запас по нашим счётчикам"
    >
      <div class="analytics-page__budget-grid">
        <article
          v-for="budget in budgetCards"
          :key="budget.id"
          class="analytics-page__budget-card"
        >
          <span class="analytics-page__card-label">{{ budget.title }}</span>
          <strong
            class="analytics-page__budget-value"
            :class="`analytics-page__budget-value--${budget.tone}`"
          >
            {{ budget.value }}
          </strong>
          <p class="analytics-page__budget-meta">
            По локальному счётчику: использовано {{ budget.usedLabel }} из
            {{ budget.limitLabel }} {{ windowLabel }}
          </p>
          <p class="analytics-page__card-copy">{{ budget.detail }}</p>
          <p v-if="budget.providerMessage" class="analytics-page__provider-copy">
            {{ budget.providerMessage }}
          </p>
        </article>
      </div>
    </SurfaceCard>

    <SurfaceCard
      v-if="aiSnapshot"
      eyebrow="Сырые метрики"
      title="Что приложение успело учесть"
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
      title="Живой статус по нейросетям"
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
              <span class="chip">По счётчику: ~{{ channel.remaining24h }}</span>
              <span class="chip">Локальный лимит: {{ channel.limit24h }}</span>
            </div>
          </div>

          <div
            class="analytics-page__runtime-badge"
            :class="`analytics-page__runtime-badge--${channel.runtimeTone}`"
          >
            {{ channel.runtimeLabel }}
          </div>

          <p v-if="channel.runtimeSummary" class="analytics-page__runtime-copy">
            {{ channel.runtimeSummary }}
          </p>
          <p v-else class="analytics-page__runtime-copy">
            Провайдер ещё не возвращал явный сигнал о квоте или перегрузке в текущей
            сессии сервера.
          </p>
          <p class="analytics-page__runtime-copy analytics-page__runtime-copy--muted">
            Последнее обновление: {{ channel.runtimeUpdatedAt }}
          </p>
          <p
            v-if="channel.runtimeMessage"
            class="analytics-page__runtime-copy analytics-page__runtime-copy--muted"
          >
            Последний ответ провайдера: {{ channel.runtimeMessage }}
          </p>

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
  font-size: 1.3rem;
  line-height: 1.08;
  letter-spacing: -0.04em;
}

.analytics-page__budget-value--danger {
  color: #b9473d;
}

.analytics-page__budget-value--warning {
  color: #a36a12;
}

.analytics-page__budget-meta,
.analytics-page__card-copy,
.analytics-page__provider-copy,
.analytics-page__runtime-copy {
  margin: 0.34rem 0 0;
  color: var(--text-muted);
  font-size: 0.88rem;
  line-height: 1.45;
}

.analytics-page__provider-copy,
.analytics-page__runtime-copy {
  color: var(--text-color);
}

.analytics-page__runtime-copy--muted {
  color: var(--text-muted);
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

.analytics-page__runtime-badge {
  display: inline-flex;
  align-items: center;
  margin-top: 0.82rem;
  padding: 0.44rem 0.7rem;
  border-radius: 999px;
  font-size: 0.82rem;
  font-weight: 700;
  background: rgba(139, 126, 109, 0.12);
  color: var(--text-color);
}

.analytics-page__runtime-badge--success {
  background: rgba(87, 146, 105, 0.16);
  color: #2d6b42;
}

.analytics-page__runtime-badge--warning {
  background: rgba(205, 142, 38, 0.16);
  color: #8d5c12;
}

.analytics-page__runtime-badge--danger {
  background: rgba(190, 92, 79, 0.16);
  color: #a24338;
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
