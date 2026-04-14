import {
  AI_ANALYTICS_GEMINI_IMAGE_REQUEST_LIMIT,
  AI_ANALYTICS_GEMINI_TEXT_REQUEST_LIMIT,
  AI_ANALYTICS_GROQ_IMAGE_REQUEST_LIMIT,
  AI_ANALYTICS_GROQ_TEXT_REQUEST_LIMIT,
  AI_ANALYTICS_WINDOW_HOURS,
  AI_FALLBACK_PROVIDER,
  AI_PRIMARY_PROVIDER,
} from '../config.js'
import type { SqliteDatabase } from '../db.js'
import { createId, nowIso } from '../lib/text.js'
import type { AiProviderRuntimeStatus } from './ai/providerRuntimeStatus.js'
import { getAiProviderRuntimeStatuses } from './ai/providerRuntimeStatus.js'

export type AiAnalyticsTask =
  | 'image_analysis'
  | 'interview_question_generation'
  | 'interview_answer_evaluation'
  | 'note_organization'
  | 'note_study_topic_suggestions'

export type AiAnalyticsChannel = 'text' | 'image'

interface AiUsageEventRow {
  id: string
  task: AiAnalyticsTask
  provider: string
  channel: AiAnalyticsChannel
  model: string
  request_id: string | null
  category_id: string | null
  note_id: string | null
  status: string
  input_tokens: number | null
  output_tokens: number | null
  total_tokens: number | null
  occurred_at: string
}

interface AttachmentStatusRow {
  processing_status: 'pending' | 'processing' | 'ready' | 'failed'
  count: number
}

export interface RecordAiUsageEventInput {
  id?: string
  task: AiAnalyticsTask
  provider: string
  model: string
  requestId?: string | null
  categoryId?: string | null
  noteId?: string | null
  inputTokens?: number | null
  outputTokens?: number | null
  totalTokens?: number | null
  occurredAt?: string
}

export interface AiAnalyticsUsageTotals {
  requests: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
}

export interface AiAnalyticsTaskSummary extends AiAnalyticsUsageTotals {
  task: AiAnalyticsTask
  used24h: number
  usedAllTime: number
}

export interface AiAnalyticsChannelSummary extends AiAnalyticsUsageTotals {
  provider: string
  channel: AiAnalyticsChannel
  models: string[]
  used24h: number
  usedAllTime: number
  limit24h: number | null
  remaining24h: number | null
  runtimeStatus: AiProviderRuntimeStatus | null
}

export interface AiAnalyticsFriendlyBudget {
  id:
    | 'question_generation'
    | 'answer_evaluation'
    | 'image_analysis'
    | 'note_organization'
  channel: AiAnalyticsChannel
  used24h: number
  limit24h: number | null
  remaining24h: number | null
  availabilityState: 'available' | 'degraded' | 'blocked' | 'unknown'
  availabilityMessage: string | null
}

export interface AiAnalyticsAttachmentsSummary {
  total: number
  ready: number
  pending: number
  processing: number
  failed: number
}

export interface AiAnalyticsSnapshot {
  generatedAt: string
  windowHours: number
  configuredProviders: string[]
  overview: {
    lastWindow: AiAnalyticsUsageTotals
    allTime: AiAnalyticsUsageTotals
  }
  tasks: AiAnalyticsTaskSummary[]
  channels: AiAnalyticsChannelSummary[]
  friendlyBudgets: AiAnalyticsFriendlyBudget[]
  attachments: AiAnalyticsAttachmentsSummary
}

const TASK_ORDER: AiAnalyticsTask[] = [
  'interview_question_generation',
  'interview_answer_evaluation',
  'note_study_topic_suggestions',
  'note_organization',
  'image_analysis',
]

const CHANNELED_LIMITS: Record<string, number> = {
  'gemini:text': AI_ANALYTICS_GEMINI_TEXT_REQUEST_LIMIT,
  'gemini:image': AI_ANALYTICS_GEMINI_IMAGE_REQUEST_LIMIT,
  'groq:text': AI_ANALYTICS_GROQ_TEXT_REQUEST_LIMIT,
  'groq:image': AI_ANALYTICS_GROQ_IMAGE_REQUEST_LIMIT,
}

const toChannelFromTask = (task: AiAnalyticsTask): AiAnalyticsChannel =>
  task === 'image_analysis' ? 'image' : 'text'

const buildTotals = (): AiAnalyticsUsageTotals => ({
  requests: 0,
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
})

const addUsageToTotals = (
  totals: AiAnalyticsUsageTotals,
  row: Pick<
    AiUsageEventRow,
    'input_tokens' | 'output_tokens' | 'total_tokens'
  >,
): void => {
  totals.requests += 1
  totals.inputTokens += row.input_tokens ?? 0
  totals.outputTokens += row.output_tokens ?? 0
  totals.totalTokens += row.total_tokens ?? 0
}

const getChannelLimit = (
  provider: string,
  channel: AiAnalyticsChannel,
): number | null => CHANNELED_LIMITS[`${provider}:${channel}`] ?? null

const buildConfiguredProviders = (): string[] =>
  [...new Set([AI_PRIMARY_PROVIDER, AI_FALLBACK_PROVIDER])]

export const createAnalyticsRepository = (db: SqliteDatabase) => {
  const insertUsageEventStatement = db.prepare(
    `
      INSERT INTO ai_usage_events (
        id,
        task,
        provider,
        channel,
        model,
        request_id,
        category_id,
        note_id,
        status,
        input_tokens,
        output_tokens,
        total_tokens,
        occurred_at,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?, ?, ?, ?, ?, ?)
    `,
  )
  const usageEventsStatement = db.prepare(
    `
      SELECT
        id,
        task,
        provider,
        channel,
        model,
        request_id,
        category_id,
        note_id,
        status,
        input_tokens,
        output_tokens,
        total_tokens,
        occurred_at
      FROM ai_usage_events
      ORDER BY occurred_at DESC
    `,
  )
  const attachmentStatusesStatement = db.prepare(
    `
      SELECT
        processing_status,
        COUNT(*) AS count
      FROM attachments
      GROUP BY processing_status
    `,
  )

  return {
    recordAiUsageEvent: (input: RecordAiUsageEventInput): void => {
      const occurredAt = input.occurredAt ?? nowIso()

      insertUsageEventStatement.run(
        input.id ?? createId(),
        input.task,
        input.provider,
        toChannelFromTask(input.task),
        input.model,
        input.requestId ?? null,
        input.categoryId ?? null,
        input.noteId ?? null,
        input.inputTokens ?? null,
        input.outputTokens ?? null,
        input.totalTokens ?? null,
        occurredAt,
        occurredAt,
        occurredAt,
      )
    },

    getAiAnalyticsSnapshot: (): AiAnalyticsSnapshot => {
      const configuredProviders = buildConfiguredProviders()
      const windowStartDate = new Date(
        Date.now() - AI_ANALYTICS_WINDOW_HOURS * 60 * 60 * 1000,
      )
      const windowStart = windowStartDate.toISOString()
      const usageRows = usageEventsStatement.all() as AiUsageEventRow[]
      const attachmentStatusRows =
        attachmentStatusesStatement.all() as AttachmentStatusRow[]
      const runtimeStatuses = getAiProviderRuntimeStatuses()
      const runtimeStatusByChannel = new Map(
        runtimeStatuses.map((status) => [
          `${status.provider}:${status.channel}`,
          status,
        ]),
      )

      const overviewLastWindow = buildTotals()
      const overviewAllTime = buildTotals()
      const taskSummaries = new Map<
        AiAnalyticsTask,
        AiAnalyticsTaskSummary
      >(
        TASK_ORDER.map((task) => [
          task,
          {
            task,
            used24h: 0,
            usedAllTime: 0,
            ...buildTotals(),
          },
        ]),
      )
      const channelSummaries = new Map<
        string,
        AiAnalyticsChannelSummary & { modelSet: Set<string> }
      >()

      for (const provider of configuredProviders) {
        for (const channel of ['text', 'image'] as const) {
          const key = `${provider}:${channel}`

          channelSummaries.set(key, {
            provider,
            channel,
            models: [],
            modelSet: new Set<string>(),
            used24h: 0,
            usedAllTime: 0,
            limit24h: getChannelLimit(provider, channel),
            remaining24h: getChannelLimit(provider, channel),
            runtimeStatus: null,
            ...buildTotals(),
          })
        }
      }

      for (const row of usageRows) {
        if (row.status !== 'completed') {
          continue
        }

        const isInWindow = row.occurred_at >= windowStart
        const taskSummary = taskSummaries.get(row.task)
        const channelKey = `${row.provider}:${row.channel}`
        const channelSummary =
          channelSummaries.get(channelKey) ??
          {
            provider: row.provider,
            channel: row.channel,
            models: [],
            modelSet: new Set<string>(),
            used24h: 0,
            usedAllTime: 0,
            limit24h: getChannelLimit(row.provider, row.channel),
            remaining24h: getChannelLimit(row.provider, row.channel),
            runtimeStatus: null,
            ...buildTotals(),
          }

        if (!channelSummaries.has(channelKey)) {
          channelSummaries.set(channelKey, channelSummary)
        }

        addUsageToTotals(overviewAllTime, row)
        if (taskSummary) {
          taskSummary.usedAllTime += 1
        }
        channelSummary.usedAllTime++

        if (taskSummary) {
          addUsageToTotals(taskSummary, row)
        }

        addUsageToTotals(channelSummary, row)
        channelSummary.modelSet.add(row.model)

        if (isInWindow) {
          addUsageToTotals(overviewLastWindow, row)
          if (taskSummary) {
            taskSummary.used24h += 1
          }
          channelSummary.used24h++
        }
      }

      const buildAvailabilityForChannel = (channel: AiAnalyticsChannel) => {
        const channelStatuses = configuredProviders.map(
          (provider) => runtimeStatusByChannel.get(`${provider}:${channel}`) ?? null,
        )
        const knownStatuses = channelStatuses.filter(
          (status): status is AiProviderRuntimeStatus => status !== null,
        )

        if (knownStatuses.length === 0) {
          return {
            availabilityState: 'unknown' as const,
            availabilityMessage: null,
          }
        }

        const blockingStatuses = knownStatuses.filter(
          (status) => status.state !== 'available',
        )
        const availableStatuses = knownStatuses.filter(
          (status) => status.state === 'available',
        )

        if (blockingStatuses.length === 0) {
          return {
            availabilityState: 'available' as const,
            availabilityMessage: null,
          }
        }

        const summary = blockingStatuses
          .map((status) => {
            const providerLabel = status.provider.toUpperCase()
            const dimensionLabel =
              status.limitDimension === 'tokens'
                ? 'tokens'
                : status.limitDimension === 'requests'
                  ? 'requests'
                  : 'quota'
            const windowLabel =
              status.window === 'day'
                ? 'per day'
                : status.window === 'minute'
                  ? 'per minute'
                  : ''
            const retryLabel =
              typeof status.retryAfterMs === 'number' && status.retryAfterMs > 0
                ? ` Retry in ~${Math.max(1, Math.ceil(status.retryAfterMs / 60_000))} min.`
                : ''

            if (status.state === 'quota_exhausted') {
              return `${providerLabel}: quota exhausted${windowLabel ? ` (${dimensionLabel} ${windowLabel})` : ''}.${retryLabel}`
            }

            if (status.state === 'rate_limited') {
              return `${providerLabel}: rate limited${windowLabel ? ` (${dimensionLabel} ${windowLabel})` : ''}.${retryLabel}`
            }

            if (status.state === 'temporarily_unavailable') {
              return `${providerLabel}: temporarily unavailable.${retryLabel}`
            }

            return `${providerLabel}: request failed.${retryLabel}`
          })
          .join(' ')

        return {
          availabilityState:
            blockingStatuses.length === knownStatuses.length &&
            availableStatuses.length === 0 &&
            knownStatuses.length === channelStatuses.length
              ? ('blocked' as const)
              : ('degraded' as const),
          availabilityMessage: summary,
        }
      }

      const finalizedChannelSummaries = [...channelSummaries.values()]
        .map((summary) => {
          const models = [...summary.modelSet].sort((left, right) =>
            left.localeCompare(right, 'en'),
          )
          const remaining24h =
            summary.limit24h === null
              ? null
              : Math.max(summary.limit24h - summary.used24h, 0)

          return {
            provider: summary.provider,
            channel: summary.channel,
            models,
            used24h: summary.used24h,
            usedAllTime: summary.usedAllTime,
            limit24h: summary.limit24h,
            remaining24h,
            runtimeStatus:
              runtimeStatusByChannel.get(
                `${summary.provider}:${summary.channel}`,
              ) ?? null,
            requests: summary.requests,
            inputTokens: summary.inputTokens,
            outputTokens: summary.outputTokens,
            totalTokens: summary.totalTokens,
          }
        })
        .sort((left, right) => {
          if (left.provider !== right.provider) {
            return left.provider.localeCompare(right.provider, 'en')
          }

          return left.channel.localeCompare(right.channel, 'en')
        })

      const sumBudgetByChannel = (channel: AiAnalyticsChannel) => {
        const channelRows = finalizedChannelSummaries.filter(
          (summary) =>
            summary.channel === channel &&
            configuredProviders.includes(summary.provider),
        )
        const limitRows = channelRows.filter(
          (summary) => summary.limit24h !== null,
        )

        return {
          used24h: channelRows.reduce((total, summary) => total + summary.used24h, 0),
          limit24h:
            limitRows.length > 0
              ? limitRows.reduce(
                  (total, summary) => total + (summary.limit24h ?? 0),
                  0,
                )
              : null,
        }
      }

      const textBudget = sumBudgetByChannel('text')
      const imageBudget = sumBudgetByChannel('image')
      const friendlyBudgets: AiAnalyticsFriendlyBudget[] = [
        {
          id: 'question_generation',
          channel: 'text',
          used24h: textBudget.used24h,
          limit24h: textBudget.limit24h,
          remaining24h:
            textBudget.limit24h === null
              ? null
              : Math.max(textBudget.limit24h - textBudget.used24h, 0),
          ...buildAvailabilityForChannel('text'),
        },
        {
          id: 'answer_evaluation',
          channel: 'text',
          used24h: textBudget.used24h,
          limit24h: textBudget.limit24h,
          remaining24h:
            textBudget.limit24h === null
              ? null
              : Math.max(textBudget.limit24h - textBudget.used24h, 0),
          ...buildAvailabilityForChannel('text'),
        },
        {
          id: 'image_analysis',
          channel: 'image',
          used24h: imageBudget.used24h,
          limit24h: imageBudget.limit24h,
          remaining24h:
            imageBudget.limit24h === null
              ? null
              : Math.max(imageBudget.limit24h - imageBudget.used24h, 0),
          ...buildAvailabilityForChannel('image'),
        },
        {
          id: 'note_organization',
          channel: 'text',
          used24h: textBudget.used24h,
          limit24h: textBudget.limit24h,
          remaining24h:
            textBudget.limit24h === null
              ? null
              : Math.max(textBudget.limit24h - textBudget.used24h, 0),
          ...buildAvailabilityForChannel('text'),
        },
      ]

      const attachments = {
        total: 0,
        ready: 0,
        pending: 0,
        processing: 0,
        failed: 0,
      }

      for (const row of attachmentStatusRows) {
        attachments.total += row.count

        if (row.processing_status === 'ready') {
          attachments.ready = row.count
        }

        if (row.processing_status === 'pending') {
          attachments.pending = row.count
        }

        if (row.processing_status === 'processing') {
          attachments.processing = row.count
        }

        if (row.processing_status === 'failed') {
          attachments.failed = row.count
        }
      }

      return {
        generatedAt: nowIso(),
        windowHours: AI_ANALYTICS_WINDOW_HOURS,
        configuredProviders,
        overview: {
          lastWindow: overviewLastWindow,
          allTime: overviewAllTime,
        },
        tasks: TASK_ORDER.map((task) => taskSummaries.get(task)!),
        channels: finalizedChannelSummaries,
        friendlyBudgets,
        attachments,
      }
    },
  }
}
