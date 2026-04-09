import { nowIso } from '../../lib/text.js'
import { AiServiceError } from './errors.js'
import type { AiProviderName } from './providerTypes.js'

type AiTask =
  | 'image_analysis'
  | 'interview_question_generation'
  | 'interview_answer_evaluation'
  | 'note_organization'

export type AiRuntimeChannel = 'text' | 'image'
export type AiRuntimeState =
  | 'available'
  | 'rate_limited'
  | 'quota_exhausted'
  | 'temporarily_unavailable'
  | 'error'

export type AiRuntimeLimitDimension = 'requests' | 'tokens' | 'unknown'
export type AiRuntimeWindow = 'minute' | 'day' | 'unknown'

export interface AiProviderRuntimeStatus {
  provider: AiProviderName
  channel: AiRuntimeChannel
  task: AiTask
  state: AiRuntimeState
  message: string | null
  limitDimension: AiRuntimeLimitDimension
  window: AiRuntimeWindow
  retryAfterMs: number | null
  limitValue: number | null
  usedValue: number | null
  requestedValue: number | null
  updatedAt: string
}

const statuses = new Map<string, AiProviderRuntimeStatus>()

const buildKey = (
  provider: AiProviderName,
  channel: AiRuntimeChannel,
): string => `${provider}:${channel}`

const toChannelFromTask = (task: AiTask): AiRuntimeChannel =>
  task === 'image_analysis' ? 'image' : 'text'

const parseDurationToMs = (value: string): number | null => {
  const normalized = value.trim().toLowerCase()

  if (!normalized) {
    return null
  }

  const pattern = /(\d+(?:\.\d+)?)(ms|h|m|s)/g
  let totalMs = 0
  let matched = false
  let match: RegExpExecArray | null = null

  while ((match = pattern.exec(normalized)) !== null) {
    matched = true
    const amount = Number.parseFloat(match[1])
    const unit = match[2]

    if (!Number.isFinite(amount) || amount <= 0) {
      continue
    }

    if (unit === 'h') {
      totalMs += amount * 60 * 60 * 1000
    } else if (unit === 'm') {
      totalMs += amount * 60 * 1000
    } else if (unit === 's') {
      totalMs += amount * 1000
    } else if (unit === 'ms') {
      totalMs += amount
    }
  }

  if (!matched || totalMs <= 0) {
    return null
  }

  return Math.ceil(totalMs)
}

const extractRetryAfterMs = (error: AiServiceError): number | null => {
  if (error.details && typeof error.details === 'object') {
    const providerDetails = (error.details as { providerDetails?: unknown })
      .providerDetails

    if (Array.isArray(providerDetails)) {
      for (const item of providerDetails) {
        if (!item || typeof item !== 'object') {
          continue
        }

        const retryDelay = (item as { retryDelay?: unknown }).retryDelay

        if (typeof retryDelay === 'string') {
          const parsed = parseDurationToMs(retryDelay)

          if (parsed !== null) {
            return parsed
          }
        }
      }
    }
  }

  const messageMatch = error.message.match(/(?:retry|try again) in ([0-9hms.]+)/i)

  if (!messageMatch) {
    return null
  }

  return parseDurationToMs(messageMatch[1])
}

const deriveStatusFromMessage = (
  error: AiServiceError,
): Pick<
  AiProviderRuntimeStatus,
  'state' | 'limitDimension' | 'window' | 'limitValue' | 'usedValue' | 'requestedValue'
> => {
  const normalizedMessage = error.message.toLowerCase()

  const parsedFromMessage =
    error.message.match(
      /on\s+(tokens|requests)\s+per\s+(day|minute)[^:]*:\s+Limit\s+([0-9]+),\s+Used\s+([0-9]+),\s+Requested\s+([0-9]+)/i,
    ) ??
    error.message.match(
      /limit\s*:?\s*([0-9]+).*used\s*:?\s*([0-9]+).*requested\s*:?\s*([0-9]+)/i,
    )

  let limitDimension: AiRuntimeLimitDimension = 'unknown'
  let window: AiRuntimeWindow = 'unknown'
  let limitValue: number | null = null
  let usedValue: number | null = null
  let requestedValue: number | null = null

  if (parsedFromMessage) {
    if (parsedFromMessage.length >= 6) {
      limitDimension =
        parsedFromMessage[1]?.toLowerCase() === 'tokens' ? 'tokens' : 'requests'
      window = parsedFromMessage[2]?.toLowerCase() === 'day' ? 'day' : 'minute'
      limitValue = Number.parseInt(parsedFromMessage[3] ?? '', 10)
      usedValue = Number.parseInt(parsedFromMessage[4] ?? '', 10)
      requestedValue = Number.parseInt(parsedFromMessage[5] ?? '', 10)
    } else {
      limitValue = Number.parseInt(parsedFromMessage[1] ?? '', 10)
      usedValue = Number.parseInt(parsedFromMessage[2] ?? '', 10)
      requestedValue = Number.parseInt(parsedFromMessage[3] ?? '', 10)
    }
  }

  if (error.details && typeof error.details === 'object') {
    const providerDetails = (error.details as { providerDetails?: unknown })
      .providerDetails

    if (Array.isArray(providerDetails)) {
      for (const item of providerDetails) {
        if (!item || typeof item !== 'object') {
          continue
        }

        const violations = (item as { violations?: unknown }).violations

        if (!Array.isArray(violations)) {
          continue
        }

        for (const violation of violations) {
          if (!violation || typeof violation !== 'object') {
            continue
          }

          const quotaMetric = (violation as { quotaMetric?: unknown }).quotaMetric
          const quotaId = (violation as { quotaId?: unknown }).quotaId
          const quotaValue = (violation as { quotaValue?: unknown }).quotaValue

          if (typeof quotaMetric === 'string') {
            if (quotaMetric.toLowerCase().includes('token')) {
              limitDimension = 'tokens'
            } else if (quotaMetric.toLowerCase().includes('request')) {
              limitDimension = 'requests'
            }
          }

          if (typeof quotaId === 'string') {
            const normalizedQuotaId = quotaId.toLowerCase()

            if (normalizedQuotaId.includes('perday')) {
              window = 'day'
            } else if (normalizedQuotaId.includes('perminute')) {
              window = 'minute'
            }
          }

          if (typeof quotaValue === 'string') {
            const parsedQuotaValue = Number.parseInt(quotaValue, 10)

            if (Number.isFinite(parsedQuotaValue)) {
              limitValue = parsedQuotaValue
            }
          }
        }
      }
    }
  }

  let state: AiRuntimeState = 'error'

  if (
    error.status === 429 ||
    normalizedMessage.includes('quota') ||
    normalizedMessage.includes('rate limit') ||
    normalizedMessage.includes('too many requests') ||
    normalizedMessage.includes('resource exhausted')
  ) {
    state =
      window === 'day' ||
      normalizedMessage.includes('per day') ||
      normalizedMessage.includes('current quota') ||
      normalizedMessage.includes('quota exceeded')
        ? 'quota_exhausted'
        : 'rate_limited'
  } else if (
    error.status >= 500 ||
    normalizedMessage.includes('high demand') ||
    normalizedMessage.includes('service unavailable') ||
    normalizedMessage.includes('temporarily unavailable') ||
    normalizedMessage.includes('timed out') ||
    normalizedMessage.includes('timeout') ||
    normalizedMessage.includes('unavailable')
  ) {
    state = 'temporarily_unavailable'
  }

  return {
    state,
    limitDimension,
    window,
    limitValue: Number.isFinite(limitValue ?? NaN) ? limitValue : null,
    usedValue: Number.isFinite(usedValue ?? NaN) ? usedValue : null,
    requestedValue: Number.isFinite(requestedValue ?? NaN) ? requestedValue : null,
  }
}

export const markAiProviderAvailable = (
  task: AiTask,
  provider: AiProviderName,
): void => {
  const updatedAt = nowIso()
  const channel = toChannelFromTask(task)

  statuses.set(buildKey(provider, channel), {
    provider,
    channel,
    task,
    state: 'available',
    message: null,
    limitDimension: 'unknown',
    window: 'unknown',
    retryAfterMs: null,
    limitValue: null,
    usedValue: null,
    requestedValue: null,
    updatedAt,
  })
}

export const markAiProviderFailure = (
  task: AiTask,
  provider: AiProviderName,
  error: unknown,
): void => {
  const updatedAt = nowIso()
  const channel = toChannelFromTask(task)

  if (!(error instanceof AiServiceError)) {
    statuses.set(buildKey(provider, channel), {
      provider,
      channel,
      task,
      state: 'error',
      message: error instanceof Error ? error.message : 'Unknown error',
      limitDimension: 'unknown',
      window: 'unknown',
      retryAfterMs: null,
      limitValue: null,
      usedValue: null,
      requestedValue: null,
      updatedAt,
    })
    return
  }

  const derived = deriveStatusFromMessage(error)

  statuses.set(buildKey(provider, channel), {
    provider,
    channel,
    task,
    state: derived.state,
    message: error.message,
    limitDimension: derived.limitDimension,
    window: derived.window,
    retryAfterMs: extractRetryAfterMs(error),
    limitValue: derived.limitValue,
    usedValue: derived.usedValue,
    requestedValue: derived.requestedValue,
    updatedAt,
  })
}

export const getAiProviderRuntimeStatuses = (): AiProviderRuntimeStatus[] =>
  [...statuses.values()].sort((left, right) => {
    if (left.provider !== right.provider) {
      return left.provider.localeCompare(right.provider, 'en')
    }

    return left.channel.localeCompare(right.channel, 'en')
  })
