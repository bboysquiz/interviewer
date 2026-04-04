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
} from './dto.js'
import { AiServiceError } from './errors.js'
import { geminiProvider } from './providers/geminiProvider.js'
import { groqProvider } from './providers/groqProvider.js'
import type { AiProvider, AiProviderName } from './providerTypes.js'

type AiTask =
  | 'image_analysis'
  | 'interview_question_generation'
  | 'interview_answer_evaluation'
  | 'note_organization'

const providers: Record<AiProviderName, AiProvider> = {
  gemini: geminiProvider,
  groq: groqProvider,
}

const uniqueProviders = (value: AiProviderName[]): AiProviderName[] =>
  [...new Set(value)]

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

const isRetryableAiError = (error: unknown): boolean => {
  if (!(error instanceof AiServiceError)) {
    return false
  }

  if (error.status === 429) {
    return true
  }

  return (
    isQuotaLimitedAiError(error) ||
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

  if (eligibleProviders.length > 0) {
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
      return await run(provider)
    } catch (error) {
      lastError = error

      const hasNextProvider = index < taskProviders.length - 1

      if (!hasNextProvider || !isRetryableAiError(error)) {
        throw error
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
