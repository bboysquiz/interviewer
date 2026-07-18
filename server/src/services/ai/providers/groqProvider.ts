import {
  GROQ_API_KEY,
  GROQ_INTERVIEW_EVALUATION_MODELS,
  GROQ_INTERVIEW_QUESTION_MODELS,
  GROQ_VISION_MODELS,
} from '../../../config.js'

import type {
  AnalyzeImageForKnowledgeBaseInput,
  AnalyzeImageForKnowledgeBaseResult,
  EvaluateInterviewAnswerInput,
  EvaluateInterviewAnswerResult,
  GenerateInterviewQuestionInput,
  GenerateInterviewQuestionResult,
  OrganizeKnowledgeBaseNoteInput,
  OrganizeKnowledgeBaseNoteResult,
  OrganizedNoteSection,
  SuggestNoteStudyTopicsInput,
  SuggestNoteStudyTopicsResult,
} from '../dto.js'
import {
  buildEvaluationResult,
  buildImageAnalysisPrompt,
  buildImageAnalysisResult,
  buildInterviewEvaluationSystemPrompt,
  buildInterviewEvaluationUserPrompt,
  buildInterviewQuestionSystemPrompt,
  buildInterviewQuestionUserPrompt,
  buildNoteOrganizationResult,
  buildNoteStudySuggestionsResultFromItems,
  buildNoteOrganizationSystemPrompt,
  buildNoteOrganizationUserPrompt,
  buildNoteStudySuggestionsSystemPrompt,
  buildNoteStudySuggestionsUserPrompt,
  buildQuestionResult,
  buildUsage,
  formatProviderModel,
  parseNoteStudySuggestionsFromText,
  parseStructuredRecord,
} from '../common.js'
import { AiServiceError, toAiServiceError } from '../errors.js'
import type { AiProvider } from '../providerTypes.js'

type GroqTextContent = {
  type: 'text'
  text: string
}

type GroqImageUrlContent = {
  type: 'image_url'
  image_url: {
    url: string
  }
}

type GroqMessage = {
  role: 'system' | 'user'
  content: string | Array<GroqTextContent | GroqImageUrlContent>
}

interface GroqChatCompletionResponse {
  id?: string | null
  choices?: Array<{
    message?: {
      content?: unknown
    }
  }>
  usage?: {
    prompt_tokens?: number | null
    completion_tokens?: number | null
    total_tokens?: number | null
  }
}

interface GroqErrorBody {
  error?: {
    message?: string
    type?: string
    code?: string
  }
}

const GROQ_CHAT_COMPLETIONS_URL = 'https://api.groq.com/openai/v1/chat/completions'

const ensureGroqConfigured = (): void => {
  if (!GROQ_API_KEY) {
    throw new AiServiceError('GROQ_API_KEY is not configured on the server.', {
      status: 503,
      code: 'ai_config_error',
    })
  }
}

const toGroqAiServiceError = (
  error: unknown,
  fallbackMessage: string,
  model?: string,
): AiServiceError => {
  if (error instanceof AiServiceError) {
    const details =
      error.details && typeof error.details === 'object'
        ? (error.details as Record<string, unknown>)
        : {}

    return new AiServiceError(error.message, {
      status: error.status,
      code: error.code,
      details: {
        provider: 'groq',
        ...(model ? { model } : {}),
        ...details,
      },
    })
  }

  if (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    typeof error.status === 'number'
  ) {
    const status = error.status
    const message =
      'message' in error && typeof error.message === 'string'
        ? error.message
        : fallbackMessage
    const upstreamError =
      'error' in error && error.error && typeof error.error === 'object'
        ? (error.error as Record<string, unknown>)
        : null
    const upstreamCode =
      upstreamError && typeof upstreamError.code === 'string'
        ? upstreamError.code
        : null
    const upstreamType =
      upstreamError && typeof upstreamError.type === 'string'
        ? upstreamError.type
        : null

    return new AiServiceError(message, {
      status,
      code:
        status === 400
          ? 'ai_validation_error'
          : status === 404
            ? 'ai_not_found'
            : 'ai_upstream_error',
      details: {
        provider: 'groq',
        ...(model ? { model } : {}),
        ...(upstreamCode ? { providerCode: upstreamCode } : {}),
        ...(upstreamType ? { providerType: upstreamType } : {}),
        ...(status === 403
          ? {
              possibleCause:
                'Groq denied this request. Check the API key, organization access, model availability, and server egress region.',
            }
          : {}),
      },
    })
  }

  return toAiServiceError(error, fallbackMessage)
}

const parseJsonObject = (rawValue: string): Record<string, unknown> | null => {
  if (!rawValue.trim()) {
    return null
  }

  try {
    const parsed = JSON.parse(rawValue) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

const callGroqChatCompletion = async (
  body: {
    model: string
    messages: GroqMessage[]
    response_format?: {
      type: 'json_object'
    }
    max_completion_tokens?: number
  },
): Promise<GroqChatCompletionResponse> => {
  ensureGroqConfigured()

  const response = await fetch(GROQ_CHAT_COMPLETIONS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${GROQ_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  const responseText = await response.text()
  const responseBody = parseJsonObject(responseText)

  if (!response.ok) {
    const errorBody = responseBody as GroqErrorBody | null
    const providerCode = errorBody?.error?.code ?? null
    const providerType = errorBody?.error?.type ?? null

    throw new AiServiceError(
      errorBody?.error?.message ||
        responseText ||
        `Groq request failed with status ${response.status}.`,
      {
        status: response.status,
        code:
          response.status === 400
            ? 'ai_validation_error'
            : response.status === 404
              ? 'ai_not_found'
              : 'ai_upstream_error',
        details: {
          provider: 'groq',
          model: body.model,
          ...(providerCode ? { providerCode } : {}),
          ...(providerType ? { providerType } : {}),
          ...(response.status === 403
            ? {
                possibleCause:
                  'Groq denied this request. Check the API key, organization access, model availability, and server egress region.',
              }
            : {}),
        },
      },
    )
  }

  return (responseBody ?? {}) as GroqChatCompletionResponse
}

const shouldTryNextGroqModel = (error: AiServiceError): boolean => {
  if ([400, 403, 404, 429].includes(error.status)) {
    return true
  }

  if (error.status >= 500 && error.status < 600) {
    return true
  }

  return error.code === 'ai_invalid_response' || error.code === 'ai_validation_error'
}

const runGroqModelCandidates = async <T>(
  models: string[],
  taskLabel: string,
  run: (model: string) => Promise<T>,
): Promise<T> => {
  let lastError: AiServiceError | null = null

  for (let index = 0; index < models.length; index += 1) {
    const model = models[index]

    try {
      return await run(model)
    } catch (error) {
      const aiError = toGroqAiServiceError(error, `Groq ${taskLabel} failed.`, model)
      lastError = aiError

      const nextModel = models[index + 1]

      if (!nextModel || !shouldTryNextGroqModel(aiError)) {
        throw aiError
      }

      console.warn(
        `Groq model "${model}" failed for ${taskLabel}. Trying "${nextModel}". status=${aiError.status} | code=${aiError.code} | message=${aiError.message}`,
      )
    }
  }

  throw (
    lastError ??
    new AiServiceError(`Groq ${taskLabel} failed.`, {
      status: 502,
      code: 'ai_upstream_error',
      details: {
        provider: 'groq',
      },
    })
  )
}

const buildGroqUsage = (
  usage:
    | {
        prompt_tokens?: number | null
        completion_tokens?: number | null
        total_tokens?: number | null
      }
    | undefined,
): AnalyzeImageForKnowledgeBaseResult['usage'] =>
  buildUsage({
    promptTokens: usage?.prompt_tokens ?? null,
    completionTokens: usage?.completion_tokens ?? null,
    totalTokens: usage?.total_tokens ?? null,
  })

const extractMessageText = (content: unknown): string => {
  if (typeof content === 'string') {
    return content.trim()
  }

  if (!Array.isArray(content)) {
    return ''
  }

  return content
    .map((part) => {
      if (
        part &&
        typeof part === 'object' &&
        'text' in part &&
        typeof part.text === 'string'
      ) {
        return part.text
      }

      return ''
    })
    .join('\n')
    .trim()
}

const shouldRetryWithoutStructuredJson = (error: unknown): boolean => {
  if (!(error instanceof AiServiceError)) {
    return false
  }

  if (error.status !== 400 || error.code !== 'ai_validation_error') {
    return false
  }

  const normalizedMessage = error.message.toLowerCase()

  return (
    normalizedMessage.includes('failed to validate json') ||
    normalizedMessage.includes('failed_generation') ||
    normalizedMessage.includes('json')
  )
}

const parseNoteOrganizationSectionsFromText = (
  rawOutput: string,
): OrganizedNoteSection[] => {
  const lines = rawOutput
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  const sections: OrganizedNoteSection[] = []
  let currentTitle: string | null = null
  let currentIndexes: number[] = []

  const flushCurrentSection = (): void => {
    if (!currentTitle || currentIndexes.length === 0) {
      currentTitle = null
      currentIndexes = []
      return
    }

    sections.push({
      title: currentTitle,
      blockIndexes: [...new Set(currentIndexes)].filter((value) => value > 0),
    })
    currentTitle = null
    currentIndexes = []
  }

  for (const line of lines) {
    const sectionMatch = line.match(/^section\s*:\s*(.+)$/i)

    if (sectionMatch?.[1]) {
      flushCurrentSection()
      currentTitle = sectionMatch[1].trim()
      continue
    }

    const blocksMatch = line.match(/^blocks?\s*:\s*(.+)$/i)

    if (blocksMatch?.[1]) {
      currentIndexes = blocksMatch[1]
        .split(',')
        .map((part) => Number.parseInt(part.trim(), 10))
        .filter((value) => Number.isInteger(value) && value > 0)
      continue
    }
  }

  flushCurrentSection()

  return sections
}

const analyzeImageForKnowledgeBase = async (
  input: AnalyzeImageForKnowledgeBaseInput,
): Promise<AnalyzeImageForKnowledgeBaseResult> => {
  if (!input.imageDataUrl.trim()) {
    throw new AiServiceError('Image data is required for AI analysis.', {
      status: 400,
      code: 'ai_validation_error',
    })
  }

  return runGroqModelCandidates(GROQ_VISION_MODELS, 'image analysis', async (model) => {
    const completion = await callGroqChatCompletion({
      model,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: [
                buildImageAnalysisPrompt(input),
                'Return only one JSON object with keys extracted_text, image_description, and key_terms.',
              ].join('\n\n'),
            },
            {
              type: 'image_url',
              image_url: {
                url: input.imageDataUrl,
              },
            },
          ],
        },
      ],
      response_format: {
        type: 'json_object',
      },
      max_completion_tokens: 1200,
    })

    const rawOutput = extractMessageText(completion.choices?.[0]?.message?.content)

    if (!rawOutput) {
      throw new AiServiceError(
        'Groq returned an empty structured response for image analysis.',
        {
          status: 502,
          code: 'ai_invalid_response',
        },
      )
    }

    const record = parseStructuredRecord(
      rawOutput,
      'Groq returned invalid JSON for image analysis.',
    )

    return buildImageAnalysisResult(
      record,
      formatProviderModel('groq', model),
      completion.id ?? null,
      buildGroqUsage(completion.usage),
    )
  })
}

const generateInterviewQuestion = async (
  input: GenerateInterviewQuestionInput,
): Promise<GenerateInterviewQuestionResult> => {
  if (!input.knowledgeBaseContext.trim()) {
    throw new AiServiceError('Knowledge base context is required.', {
      status: 400,
      code: 'ai_validation_error',
    })
  }

  return runGroqModelCandidates(
    GROQ_INTERVIEW_QUESTION_MODELS,
    'interview prompt generation',
    async (model) => {
      const completion = await callGroqChatCompletion({
        model,
        messages: [
          {
            role: 'system',
            content: [
              buildInterviewQuestionSystemPrompt(),
              'Return only one JSON object with keys question, rationale, expected_topics, difficulty, and source_indexes.',
              'The question key must contain the complete interview prompt, whether it is a conceptual question or a practical task.',
            ].join('\n\n'),
          },
          {
            role: 'user',
            content: buildInterviewQuestionUserPrompt(input),
          },
        ],
        response_format: {
          type: 'json_object',
        },
        max_completion_tokens: 1400,
      })

      const rawOutput = extractMessageText(completion.choices?.[0]?.message?.content)

      if (!rawOutput) {
        throw new AiServiceError(
          'Groq returned an empty structured response for interview question generation.',
          {
            status: 502,
            code: 'ai_invalid_response',
          },
        )
      }

      const record = parseStructuredRecord(
        rawOutput,
        'Groq returned invalid JSON for interview question generation.',
      )

      return buildQuestionResult(
        record,
        formatProviderModel('groq', model),
        completion.id ?? null,
        buildGroqUsage(completion.usage),
        input.previousQuestions,
      )
    },
  )
}

const evaluateInterviewAnswer = async (
  input: EvaluateInterviewAnswerInput,
): Promise<EvaluateInterviewAnswerResult> => {
  if (!input.questionPrompt.trim() || !input.answerText.trim()) {
    throw new AiServiceError(
      'Interview prompt and user response are required for evaluation.',
      {
        status: 400,
        code: 'ai_validation_error',
      },
    )
  }

  return runGroqModelCandidates(
    GROQ_INTERVIEW_EVALUATION_MODELS,
    'interview answer evaluation',
    async (model) => {
      const completion = await callGroqChatCompletion({
        model,
        messages: [
          {
            role: 'system',
            content: [
              buildInterviewEvaluationSystemPrompt(),
              'Return only one JSON object with keys knowledge_base, general_knowledge, and overall_summary. Each criterion object must include score, max_score, comment, improvement_tip, corrected_answer, and is_strong_answer.',
            ].join('\n\n'),
          },
          {
            role: 'user',
            content: buildInterviewEvaluationUserPrompt(input),
          },
        ],
        response_format: {
          type: 'json_object',
        },
        max_completion_tokens: 1600,
      })

      const rawOutput = extractMessageText(completion.choices?.[0]?.message?.content)

      if (!rawOutput) {
        throw new AiServiceError(
          'Groq returned an empty structured response for answer evaluation.',
          {
            status: 502,
            code: 'ai_invalid_response',
          },
        )
      }

      const record = parseStructuredRecord(
        rawOutput,
        'Groq returned invalid JSON for interview answer evaluation.',
      )

      return buildEvaluationResult(
        record,
        formatProviderModel('groq', model),
        completion.id ?? null,
        buildGroqUsage(completion.usage),
      )
    },
  )
}

const organizeKnowledgeBaseNote = async (
  input: OrganizeKnowledgeBaseNoteInput,
): Promise<OrganizeKnowledgeBaseNoteResult> => {
  if (input.blocks.length === 0) {
    throw new AiServiceError('Note blocks are required for organization.', {
      status: 400,
      code: 'ai_validation_error',
    })
  }

  return runGroqModelCandidates(
    GROQ_INTERVIEW_QUESTION_MODELS,
    'note organization',
    async (model) => {
      const systemPrompt = [
        buildNoteOrganizationSystemPrompt(),
        'Return plain text only.',
        'Use this exact format and nothing else:',
        'SECTION: <short Russian title>',
        'BLOCKS: <comma-separated one-based indexes>',
        'Repeat the SECTION/BLOCKS pair for every section.',
        'Do not add explanations, markdown, bullets, JSON, or prose before or after the sections.',
      ].join('\n\n')
      const messages = [
        {
          role: 'system' as const,
          content: systemPrompt,
        },
        {
          role: 'user' as const,
          content: buildNoteOrganizationUserPrompt(input),
        },
      ]

      const completion = await callGroqChatCompletion({
        model,
        messages,
        max_completion_tokens: 900,
      })

      const rawOutput = extractMessageText(completion.choices?.[0]?.message?.content)

      if (!rawOutput) {
        throw new AiServiceError(
          'Groq returned an empty response for note organization.',
          {
            status: 502,
            code: 'ai_invalid_response',
          },
        )
      }

      let sections = parseNoteOrganizationSectionsFromText(rawOutput)

      if (sections.length === 0) {
        try {
          const record = parseStructuredRecord(
            rawOutput,
            'Groq returned invalid structured data for note organization.',
          )
          sections = buildNoteOrganizationResult(
            record,
            formatProviderModel('groq', model),
            completion.id ?? null,
            buildGroqUsage(completion.usage),
          ).sections
        } catch (error) {
          const aiError = error instanceof AiServiceError
            ? error
            : new AiServiceError(
                'Groq returned an unreadable response for note organization.',
                {
                  status: 502,
                  code: 'ai_invalid_response',
                },
              )

          if (!shouldRetryWithoutStructuredJson(aiError)) {
            throw aiError
          }

          throw aiError
        }
      }

      return {
        sections,
        model: formatProviderModel('groq', model),
        requestId: completion.id ?? null,
        usage: buildGroqUsage(completion.usage),
      }
    },
  )
}

const suggestNoteStudyTopics = async (
  input: SuggestNoteStudyTopicsInput,
): Promise<SuggestNoteStudyTopicsResult> => {
  if (!input.targetNoteDigest.trim()) {
    throw new AiServiceError(
      'Target note digest is required for study topic suggestions.',
      {
        status: 400,
        code: 'ai_validation_error',
      },
    )
  }

  return runGroqModelCandidates(
    GROQ_INTERVIEW_QUESTION_MODELS,
    'study topic suggestion',
    async (model) => {
      const completion = await callGroqChatCompletion({
        model,
        messages: [
          {
            role: 'system',
            content: buildNoteStudySuggestionsSystemPrompt(),
          },
          {
            role: 'user',
            content: buildNoteStudySuggestionsUserPrompt(input),
          },
        ],
        max_completion_tokens: 1500,
      })

      const rawOutput = extractMessageText(completion.choices?.[0]?.message?.content)

      if (!rawOutput) {
        throw new AiServiceError(
          'Groq returned an empty response for study topic suggestions.',
          {
            status: 502,
            code: 'ai_invalid_response',
          },
        )
      }

      const suggestions = parseNoteStudySuggestionsFromText(
        rawOutput,
        'Groq returned an unreadable response for study topic suggestions.',
      )

      return buildNoteStudySuggestionsResultFromItems(
        suggestions,
        formatProviderModel('groq', model),
        completion.id ?? null,
        buildGroqUsage(completion.usage),
      )
    },
  )
}

export const groqProvider: AiProvider = {
  name: 'groq',
  get isConfigured() {
    return Boolean(GROQ_API_KEY)
  },
  supportsImageAnalysis: true,
  analyzeImageForKnowledgeBase,
  generateInterviewQuestion,
  evaluateInterviewAnswer,
  organizeKnowledgeBaseNote,
  suggestNoteStudyTopics,
}
