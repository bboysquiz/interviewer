import OpenAI from 'openai'

import {
  GROQ_API_KEY,
  GROQ_INTERVIEW_EVALUATION_MODEL,
  GROQ_INTERVIEW_QUESTION_MODEL,
  GROQ_VISION_MODEL,
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
  buildNoteOrganizationSystemPrompt,
  buildNoteOrganizationUserPrompt,
  buildNoteStudySuggestionsResult,
  buildNoteStudySuggestionsSystemPrompt,
  buildNoteStudySuggestionsUserPrompt,
  buildQuestionResult,
  buildUsage,
  formatProviderModel,
  parseStructuredRecord,
} from '../common.js'
import { AiServiceError, toAiServiceError } from '../errors.js'
import type { AiProvider } from '../providerTypes.js'

let groqClient: OpenAI | null = null

const getGroqClient = (): OpenAI => {
  if (!GROQ_API_KEY) {
    throw new AiServiceError('GROQ_API_KEY is not configured on the server.', {
      status: 503,
      code: 'ai_config_error',
    })
  }

  groqClient ??= new OpenAI({
    apiKey: GROQ_API_KEY,
    baseURL: 'https://api.groq.com/openai/v1',
  })

  return groqClient
}

const toGroqAiServiceError = (
  error: unknown,
  fallbackMessage: string,
): AiServiceError => {
  if (error instanceof AiServiceError) {
    return error
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
      },
    })
  }

  return toAiServiceError(error, fallbackMessage)
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

  try {
    const client = getGroqClient()
    const completion = await client.chat.completions.create({
      model: GROQ_VISION_MODEL,
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

    const rawOutput = extractMessageText(completion.choices[0]?.message?.content)

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
      formatProviderModel('groq', GROQ_VISION_MODEL),
      completion.id ?? null,
      buildGroqUsage(completion.usage),
    )
  } catch (error) {
    throw toGroqAiServiceError(error, 'Groq image analysis failed.')
  }
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

  try {
    const client = getGroqClient()
    const completion = await client.chat.completions.create({
      model: GROQ_INTERVIEW_QUESTION_MODEL,
      messages: [
        {
          role: 'system',
          content: [
            buildInterviewQuestionSystemPrompt(),
            'Return only one JSON object with keys question, rationale, expected_topics, difficulty, and source_indexes.',
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
      max_completion_tokens: 900,
    })

    const rawOutput = extractMessageText(completion.choices[0]?.message?.content)

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
      formatProviderModel('groq', GROQ_INTERVIEW_QUESTION_MODEL),
      completion.id ?? null,
      buildGroqUsage(completion.usage),
      input.previousQuestions,
    )
  } catch (error) {
    throw toGroqAiServiceError(error, 'Groq interview question generation failed.')
  }
}

const evaluateInterviewAnswer = async (
  input: EvaluateInterviewAnswerInput,
): Promise<EvaluateInterviewAnswerResult> => {
  if (!input.questionPrompt.trim() || !input.answerText.trim()) {
    throw new AiServiceError(
      'Question prompt and answer text are required for evaluation.',
      {
        status: 400,
        code: 'ai_validation_error',
      },
    )
  }

  try {
    const client = getGroqClient()
    const completion = await client.chat.completions.create({
      model: GROQ_INTERVIEW_EVALUATION_MODEL,
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

    const rawOutput = extractMessageText(completion.choices[0]?.message?.content)

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
      formatProviderModel('groq', GROQ_INTERVIEW_EVALUATION_MODEL),
      completion.id ?? null,
      buildGroqUsage(completion.usage),
    )
  } catch (error) {
    throw toGroqAiServiceError(error, 'Groq interview answer evaluation failed.')
  }
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

  try {
    const client = getGroqClient()
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

    const completion = await client.chat.completions.create({
      model: GROQ_INTERVIEW_QUESTION_MODEL,
      messages,
      max_completion_tokens: 900,
    })

    const rawOutput = extractMessageText(completion.choices[0]?.message?.content)

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
          formatProviderModel('groq', GROQ_INTERVIEW_QUESTION_MODEL),
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
      model: formatProviderModel('groq', GROQ_INTERVIEW_QUESTION_MODEL),
      requestId: completion.id ?? null,
      usage: buildGroqUsage(completion.usage),
    }
  } catch (error) {
    throw toGroqAiServiceError(error, 'Groq note organization failed.')
  }
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

  try {
    const client = getGroqClient()
    const completion = await client.chat.completions.create({
      model: GROQ_INTERVIEW_QUESTION_MODEL,
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
      response_format: {
        type: 'json_object',
      },
      max_completion_tokens: 2200,
    })

    const rawOutput = extractMessageText(completion.choices[0]?.message?.content)

    if (!rawOutput) {
      throw new AiServiceError(
        'Groq returned an empty structured response for study topic suggestions.',
        {
          status: 502,
          code: 'ai_invalid_response',
        },
      )
    }

    const record = parseStructuredRecord(
      rawOutput,
      'Groq returned invalid JSON for study topic suggestions.',
    )

    return buildNoteStudySuggestionsResult(
      record,
      formatProviderModel('groq', GROQ_INTERVIEW_QUESTION_MODEL),
      completion.id ?? null,
      buildGroqUsage(completion.usage),
    )
  } catch (error) {
    throw toGroqAiServiceError(error, 'Groq study topic suggestion failed.')
  }
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
