import {
  AI_FALLBACK_PROVIDER,
  AI_PRIMARY_PROVIDER,
} from '../../config.js'

import type {
  AnalyzeImageForKnowledgeBaseInput,
  AnalyzeImageForKnowledgeBaseResult,
  EvaluateInterviewAnswerInput,
  EvaluateInterviewAnswerResult,
  GenerateInterviewQuestionInput,
  GenerateInterviewQuestionResult,
  OrganizeKnowledgeBaseNoteInput,
  OrganizeKnowledgeBaseNoteResult,
  SuggestNoteStudyTopicsInput,
  SuggestNoteStudyTopicsResult,
} from './dto.js'
import { AiServiceError } from './errors.js'
import { geminiProvider } from './providers/geminiProvider.js'
import { groqProvider } from './providers/groqProvider.js'
import {
  markAiProviderAvailable,
  markAiProviderFailure,
} from './providerRuntimeStatus.js'
import type { AiProvider, AiProviderName } from './providerTypes.js'

type AiTask =
  | 'image_analysis'
  | 'interview_question_generation'
  | 'interview_answer_evaluation'
  | 'note_organization'
  | 'note_study_topic_suggestions'

const providers: Record<AiProviderName, AiProvider> = {
  gemini: geminiProvider,
  groq: groqProvider,
}

const providerCooldowns = new Map<string, number>()

const DEFAULT_TEMPORARY_PROVIDER_COOLDOWN_MS = 30_000
const DEFAULT_QUOTA_PROVIDER_COOLDOWN_MS = 60_000
const DEFAULT_DAILY_QUOTA_PROVIDER_COOLDOWN_MS = 12 * 60 * 60 * 1000

const uniqueProviders = (value: AiProviderName[]): AiProviderName[] =>
  [...new Set(value)]

const buildCooldownKey = (task: AiTask, providerName: AiProviderName): string =>
  `${task}:${providerName}`

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

const getProviderCooldownUntil = (
  task: AiTask,
  providerName: AiProviderName,
): number | null => {
  const key = buildCooldownKey(task, providerName)
  const cooldownUntil = providerCooldowns.get(key) ?? null

  if (cooldownUntil === null) {
    return null
  }

  if (cooldownUntil <= Date.now()) {
    providerCooldowns.delete(key)
    return null
  }

  return cooldownUntil
}

const extractRetryDelayMsFromDetails = (details: unknown): number | null => {
  if (!details || typeof details !== 'object') {
    return null
  }

  const providerDetails = (details as { providerDetails?: unknown }).providerDetails

  if (!Array.isArray(providerDetails)) {
    return null
  }

  for (const item of providerDetails) {
    if (!item || typeof item !== 'object') {
      continue
    }

    const retryDelay = (item as { retryDelay?: unknown }).retryDelay

    if (typeof retryDelay !== 'string') {
      continue
    }

    const parsedDuration = parseDurationToMs(retryDelay)

    if (parsedDuration !== null) {
      return parsedDuration
    }
  }

  return null
}

const hasPerDayQuotaExceeded = (error: AiServiceError): boolean => {
  if (!error.details || typeof error.details !== 'object') {
    return false
  }

  const providerDetails = (error.details as { providerDetails?: unknown }).providerDetails

  if (!Array.isArray(providerDetails)) {
    return false
  }

  return providerDetails.some((item) => {
    if (!item || typeof item !== 'object') {
      return false
    }

    const violations = (item as { violations?: unknown }).violations

    if (!Array.isArray(violations)) {
      return false
    }

    return violations.some((violation) => {
      if (!violation || typeof violation !== 'object') {
        return false
      }

      const quotaId = (violation as { quotaId?: unknown }).quotaId
      return typeof quotaId === 'string' && quotaId.toLowerCase().includes('perday')
    })
  })
}

const extractRetryDelayMs = (error: AiServiceError): number | null => {
  const fromDetails = extractRetryDelayMsFromDetails(error.details)

  if (fromDetails !== null) {
    return fromDetails
  }

  const retryDelayMatch = error.message.match(
    /(?:retry|try again) in ([0-9hms.]+)/i,
  )

  if (!retryDelayMatch) {
    return null
  }

  return parseDurationToMs(retryDelayMatch[1])
}

const getProviderCooldownDurationMs = (error: AiServiceError): number | null => {
  if (hasPerDayQuotaExceeded(error)) {
    return DEFAULT_DAILY_QUOTA_PROVIDER_COOLDOWN_MS
  }

  const retryDelayMs = extractRetryDelayMs(error)

  if (retryDelayMs !== null) {
    return retryDelayMs
  }

  if (isQuotaLimitedAiError(error) || error.status === 429) {
    return DEFAULT_QUOTA_PROVIDER_COOLDOWN_MS
  }

  if (isTemporaryUpstreamAiError(error)) {
    return DEFAULT_TEMPORARY_PROVIDER_COOLDOWN_MS
  }

  return null
}

const markProviderCooldown = (
  task: AiTask,
  providerName: AiProviderName,
  error: AiServiceError,
): void => {
  const durationMs = getProviderCooldownDurationMs(error)

  if (durationMs === null || durationMs <= 0) {
    return
  }

  providerCooldowns.set(buildCooldownKey(task, providerName), Date.now() + durationMs)
}

const isQuotaLimitedAiError = (error: AiServiceError): boolean => {
  const normalizedMessage = error.message.toLowerCase()

  return [
    'quota',
    'rate limit',
    'too many requests',
    'resource exhausted',
    'exceeded your current quota',
  ].some((pattern) => normalizedMessage.includes(pattern))
}

const isLanguageComplianceAiError = (error: AiServiceError): boolean =>
  error.message.toLowerCase().includes('non-russian interview question')

const isRepeatedQuestionAiError = (error: AiServiceError): boolean =>
  error.message.toLowerCase().includes('repeated interview question')

const isTemporaryUpstreamAiError = (error: AiServiceError): boolean => {
  const normalizedMessage = error.message.toLowerCase()

  return (
    (error.code === 'ai_upstream_error' &&
      error.status >= 500 &&
      error.status < 600) ||
    [
      'timed out',
      'timeout',
      'service unavailable',
      'temporarily unavailable',
      'overloaded',
      'internal error',
    ].some((pattern) => normalizedMessage.includes(pattern))
  )
}

const isRetryableAiError = (error: unknown): boolean => {
  if (error instanceof Error && !(error instanceof AiServiceError)) {
    const normalizedMessage = error.message.toLowerCase()

    return ['timed out', 'timeout', 'socket hang up', 'econnreset'].some(
      (pattern) => normalizedMessage.includes(pattern),
    )
  }

  if (!(error instanceof AiServiceError)) {
    return false
  }

  if (error.status === 429) {
    return true
  }

  return (
    isQuotaLimitedAiError(error) ||
    isTemporaryUpstreamAiError(error) ||
    isLanguageComplianceAiError(error) ||
    isRepeatedQuestionAiError(error)
  )
}

const formatFallbackReason = (error: unknown): string => {
  if (!(error instanceof AiServiceError)) {
    return error instanceof Error ? error.message : 'Unknown error'
  }

  const detailsSummary =
    error.details && typeof error.details === 'object'
      ? Object.entries(error.details as Record<string, unknown>)
          .filter(([, value]) => value !== null && value !== undefined && value !== '')
          .map(([key, value]) =>
            `${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`,
          )
          .join(', ')
      : ''

  return [
    `status=${error.status}`,
    `code=${error.code}`,
    `message=${error.message}`,
    detailsSummary ? `details={${detailsSummary}}` : null,
  ]
    .filter(Boolean)
    .join(' | ')
}

const getProvidersForTask = (task: AiTask): AiProvider[] => {
  const orderedNames = uniqueProviders([AI_PRIMARY_PROVIDER, AI_FALLBACK_PROVIDER])
  const eligibleProviders = orderedNames
    .map((providerName) => providers[providerName])
    .filter((provider) => provider.isConfigured)
    .filter((provider) => task !== 'image_analysis' || provider.supportsImageAnalysis)

  const readyProviders = eligibleProviders.filter(
    (provider) => getProviderCooldownUntil(task, provider.name) === null,
  )

  if (readyProviders.length > 0) {
    return readyProviders
  }

  if (eligibleProviders.length > 0) {
    const now = Date.now()
    const cooldownEntries = eligibleProviders
      .map((provider) => ({
        provider,
        cooldownUntil: getProviderCooldownUntil(task, provider.name),
      }))
      .filter(
        (entry): entry is { provider: AiProvider; cooldownUntil: number } =>
          entry.cooldownUntil !== null,
      )

    const nearestCooldown = cooldownEntries.reduce<number | null>(
      (current, entry) =>
        current === null || entry.cooldownUntil < current ? entry.cooldownUntil : current,
      null,
    )

    if (nearestCooldown !== null) {
      const retryInMs = Math.max(1_000, nearestCooldown - now)
      const retryInMinutes = Math.ceil(retryInMs / 60_000)

      throw new AiServiceError(
        `Все доступные AI-провайдеры временно упёрлись в лимиты. Попробуй снова примерно через ${retryInMinutes} мин.`,
        {
          status: 429,
          code: 'ai_upstream_error',
          details: {
            provider: 'router',
            retryAfterMs: retryInMs,
            task,
            providers: cooldownEntries.map((entry) => entry.provider.name),
          },
        },
      )
    }

    return eligibleProviders
  }

  if (task === 'image_analysis') {
    throw new AiServiceError(
      'No configured AI provider is available for image analysis. Set GEMINI_API_KEY or GROQ_API_KEY on the server.',
      {
        status: 503,
        code: 'ai_config_error',
      },
    )
  }

  throw new AiServiceError(
    'No configured AI provider is available for interview generation or evaluation. Set GEMINI_API_KEY or GROQ_API_KEY on the server.',
    {
      status: 503,
      code: 'ai_config_error',
    },
  )
}

const withProviderFallback = async <T>(
  task: AiTask,
  run: (provider: AiProvider) => Promise<T>,
): Promise<T> => {
  const taskProviders = getProvidersForTask(task)
  let lastError: unknown = null

  for (let index = 0; index < taskProviders.length; index += 1) {
    const provider = taskProviders[index]

    try {
      const result = await run(provider)
      markAiProviderAvailable(task, provider.name)
      return result
    } catch (error) {
      lastError = error
      markAiProviderFailure(task, provider.name, error)

      const hasNextProvider = index < taskProviders.length - 1

      if (!hasNextProvider || !isRetryableAiError(error)) {
        console.warn(
          `AI provider "${provider.name}" failed for ${task} with no further fallback. ${formatFallbackReason(error)}`,
        )
        throw error
      }

      if (error instanceof AiServiceError) {
        markProviderCooldown(task, provider.name, error)
      }

      console.warn(
        `AI provider "${provider.name}" failed for ${task}. Falling back to "${taskProviders[index + 1]?.name ?? 'unknown'}". ${formatFallbackReason(error)}`,
      )
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new AiServiceError('AI provider execution failed.', {
        status: 502,
        code: 'ai_upstream_error',
      })
}

export const analyzeImageForKnowledgeBase = async (
  input: AnalyzeImageForKnowledgeBaseInput,
): Promise<AnalyzeImageForKnowledgeBaseResult> =>
  withProviderFallback('image_analysis', (provider) =>
    provider.analyzeImageForKnowledgeBase(input),
  )

export const generateInterviewQuestion = async (
  input: GenerateInterviewQuestionInput,
): Promise<GenerateInterviewQuestionResult> =>
  withProviderFallback('interview_question_generation', (provider) =>
    provider.generateInterviewQuestion(input),
  )

export const evaluateInterviewAnswer = async (
  input: EvaluateInterviewAnswerInput,
): Promise<EvaluateInterviewAnswerResult> =>
  withProviderFallback('interview_answer_evaluation', (provider) =>
    provider.evaluateInterviewAnswer(input),
  )

export const organizeKnowledgeBaseNote = async (
  input: OrganizeKnowledgeBaseNoteInput,
): Promise<OrganizeKnowledgeBaseNoteResult> =>
  withProviderFallback('note_organization', (provider) =>
    provider.organizeKnowledgeBaseNote(input),
  )

export const suggestNoteStudyTopics = async (
  input: SuggestNoteStudyTopicsInput,
): Promise<SuggestNoteStudyTopicsResult> =>
  withProviderFallback('note_study_topic_suggestions', (provider) =>
    provider.suggestNoteStudyTopics(input),
  )
