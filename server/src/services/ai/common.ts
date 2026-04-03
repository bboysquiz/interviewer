import { coerceNullableString, coerceString } from '../../lib/text.js'

import type {
  AnalyzeImageForKnowledgeBaseInput,
  AnalyzeImageForKnowledgeBaseResult,
  EvaluateInterviewAnswerInput,
  EvaluateInterviewAnswerResult,
  EvaluateInterviewCriterionResult,
  GenerateInterviewQuestionInput,
  InterviewQuestionDifficulty,
} from './dto.js'
import { AiServiceError } from './errors.js'

export const imageAnalysisSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['extracted_text', 'image_description', 'key_terms'],
  properties: {
    extracted_text: {
      type: 'string',
      description:
        'Verbatim visible text from the image. Use an empty string if there is no readable text.',
    },
    image_description: {
      type: 'string',
      description:
        'A short description of what the image shows, focusing on UI, diagrams, code, or technical context.',
    },
    key_terms: {
      type: 'array',
      items: {
        type: 'string',
      },
      maxItems: 20,
    },
  },
} as const

export const interviewQuestionSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'question',
    'rationale',
    'expected_topics',
    'difficulty',
    'source_indexes',
  ],
  properties: {
    question: {
      type: 'string',
      description: 'One interviewer-style technical question.',
    },
    rationale: {
      type: 'string',
      description:
        'Short explanation of why this question was chosen for the provided knowledge base.',
    },
    expected_topics: {
      type: 'array',
      items: {
        type: 'string',
      },
      maxItems: 8,
    },
    difficulty: {
      type: 'string',
      enum: ['easy', 'medium', 'hard'],
    },
    source_indexes: {
      type: 'array',
      description:
        'One-based indexes of the grounding sources that directly support the generated question.',
      items: {
        type: 'integer',
        minimum: 1,
      },
      maxItems: 4,
    },
  },
} as const

export const interviewEvaluationSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['knowledge_base', 'general_knowledge', 'overall_summary'],
  properties: {
    knowledge_base: {
      type: 'object',
      additionalProperties: false,
      required: [
        'score',
        'max_score',
        'comment',
        'improvement_tip',
        'corrected_answer',
        'is_strong_answer',
      ],
      properties: {
        score: {
          type: 'number',
          minimum: 0,
          maximum: 10,
        },
        max_score: {
          type: 'number',
          enum: [10],
        },
        comment: {
          type: 'string',
        },
        improvement_tip: {
          type: 'string',
        },
        corrected_answer: {
          type: 'string',
        },
        is_strong_answer: {
          type: 'boolean',
        },
      },
    },
    general_knowledge: {
      type: 'object',
      additionalProperties: false,
      required: [
        'score',
        'max_score',
        'comment',
        'improvement_tip',
        'corrected_answer',
        'is_strong_answer',
      ],
      properties: {
        score: {
          type: 'number',
          minimum: 0,
          maximum: 10,
        },
        max_score: {
          type: 'number',
          enum: [10],
        },
        comment: {
          type: 'string',
        },
        improvement_tip: {
          type: 'string',
        },
        corrected_answer: {
          type: 'string',
        },
        is_strong_answer: {
          type: 'boolean',
        },
      },
    },
    overall_summary: {
      type: 'string',
    },
  },
} as const

export const buildImageAnalysisPrompt = (
  input: AnalyzeImageForKnowledgeBaseInput,
): string =>
  [
    'Analyze this uploaded image from a personal technical knowledge base.',
    input.categoryName ? `Category: ${input.categoryName}` : null,
    input.noteTitle ? `Note: ${input.noteTitle}` : null,
    input.fileName ? `File name: ${input.fileName}` : null,
    'Return strict JSON with three fields:',
    '- extracted_text: verbatim visible text from the image; empty string if there is no readable text.',
    '- image_description: a concise description of what the image shows.',
    '- key_terms: short technical terms or phrases supported by the visible content.',
    'Do not hallucinate text that is not visible.',
    'Preserve technical identifiers, code tokens, and punctuation exactly when extracting text.',
    'If the screenshot contains multiple separate information blocks, capture all of them in reading order from top to bottom and left to right.',
  ]
    .filter(Boolean)
    .join('\n')

export const buildInterviewQuestionSystemPrompt = (): string =>
  [
    'You are an interviewer generating one technical interview question.',
    'Use the provided personal knowledge base as the primary grounding source.',
    'The question must stay close to the provided notes and screenshots.',
    'Ask exactly one clear, concise question.',
    'Return all natural-language fields in Russian.',
    'The question, rationale, and expected_topics fields must be written in Russian.',
    'Return source_indexes as one-based numbers pointing to the grounding sources that directly support the question.',
    'Pick one to four source indexes and avoid indexes for sources that are only loosely related.',
    'Do not switch to English unless you are preserving exact code, API names, library names, or quoted text from the notes.',
    'Prefer questions that help the user recall and explain ideas, tradeoffs, or mechanisms.',
    'Do not introduce unrelated concepts, frameworks, or APIs that are not clearly supported by the provided grounding sources.',
    'If the context is narrow, ask a narrow question instead of broadening the topic.',
    'Do not mention that you saw snippets or internal notes.',
  ].join('\n')

export const buildInterviewQuestionUserPrompt = (
  input: GenerateInterviewQuestionInput,
): string =>
  [
    `Session title: ${input.sessionTitle}`,
    `Source type: ${input.sourceType}`,
    input.categoryName ? `Category: ${input.categoryName}` : null,
    input.noteTitles.length > 0
      ? `Note titles: ${input.noteTitles.join(', ')}`
      : null,
    input.groundingSources.length > 0
      ? `Grounding sources:\n${input.groundingSources
          .map((source, index) => `[${index + 1}] ${source}`)
          .join('\n')}`
      : null,
    input.focusPrompt ? `Additional focus: ${input.focusPrompt}` : null,
    input.previousQuestions.length > 0
      ? `Previously asked questions to avoid repeating:\n- ${input.previousQuestions.join('\n- ')}`
      : null,
    input.previousQuestions.length > 0
      ? 'Generate a different question. Do not repeat the same wording or the same central mechanism if the knowledge base supports a different angle.'
      : null,
    'Important: write the final interview question in Russian.',
    'Knowledge base context:',
    input.knowledgeBaseContext,
  ]
    .filter(Boolean)
    .join('\n\n')

export const buildInterviewEvaluationSystemPrompt = (): string =>
  [
    'You are evaluating an interview answer for a personal technical training app.',
    'Return all natural-language fields in Russian.',
    'Return two separate evaluations:',
    '1. knowledge_base: score the answer only against the provided knowledge base context.',
    '2. general_knowledge: score the answer against your broader technical understanding.',
    'For each criterion, provide a score from 0 to 10, a concise comment, a practical improvement tip, and a corrected answer only if correction is truly needed.',
    'If the answer is already strong, say so in the comment, keep the tip brief, and return an empty corrected_answer.',
    'Be strict, fair, and specific.',
  ].join('\n')

export const buildInterviewEvaluationUserPrompt = (
  input: EvaluateInterviewAnswerInput,
): string =>
  [
    `Session title: ${input.sessionTitle}`,
    input.categoryName ? `Category: ${input.categoryName}` : null,
    input.noteTitles.length > 0
      ? `Note titles: ${input.noteTitles.join(', ')}`
      : null,
    `Question: ${input.questionPrompt}`,
    `Answer: ${input.answerText}`,
    'Knowledge base context:',
    input.knowledgeBaseContext,
  ]
    .filter(Boolean)
    .join('\n\n')

export const normalizeOptionalString = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
}

export const normalizeStringArray = (
  value: unknown,
  maxItems: number,
): string[] => {
  if (!Array.isArray(value)) {
    return []
  }

  return [
    ...new Set(
      value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ].slice(0, maxItems)
}

const containsCyrillic = (value: string): boolean => /[А-Яа-яЁё]/.test(value)

const normalizeIntegerArray = (
  value: unknown,
  maxItems: number,
): number[] => {
  if (!Array.isArray(value)) {
    return []
  }

  return [
    ...new Set(
      value
        .map((item) =>
          typeof item === 'number'
            ? item
            : typeof item === 'string'
              ? Number.parseInt(item, 10)
              : Number.NaN,
        )
        .filter((item) => Number.isInteger(item) && item > 0),
    ),
  ].slice(0, maxItems) as number[]
}

const normalizeComparableQuestion = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const extractJsonObjectCandidate = (rawText: string): string => {
  const trimmed = rawText.trim()

  if (!trimmed) {
    return trimmed
  }

  const fencedMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)

  if (fencedMatch?.[1]) {
    return fencedMatch[1].trim()
  }

  return trimmed
}

export const parseStructuredRecord = (
  rawText: string,
  errorMessage: string,
): Record<string, unknown> => {
  const candidate = extractJsonObjectCandidate(rawText)

  const parseCandidates = [candidate]
  const firstBrace = candidate.indexOf('{')
  const lastBrace = candidate.lastIndexOf('}')

  if (firstBrace >= 0 && lastBrace > firstBrace) {
    parseCandidates.push(candidate.slice(firstBrace, lastBrace + 1))
  }

  for (const currentCandidate of parseCandidates) {
    try {
      const parsed = JSON.parse(currentCandidate) as unknown

      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Structured response must be an object.')
      }

      return parsed as Record<string, unknown>
    } catch {
      // Try the next candidate if available.
    }
  }

  throw new AiServiceError(errorMessage, {
    status: 502,
    code: 'ai_invalid_response',
  })
}

export interface AiUsageLike {
  inputTokens?: number | null
  outputTokens?: number | null
  totalTokens?: number | null
  promptTokens?: number | null
  completionTokens?: number | null
}

export const buildUsage = (
  usage: AiUsageLike | null | undefined,
): AnalyzeImageForKnowledgeBaseResult['usage'] => ({
  inputTokens: usage?.inputTokens ?? usage?.promptTokens ?? null,
  outputTokens: usage?.outputTokens ?? usage?.completionTokens ?? null,
  totalTokens: usage?.totalTokens ?? null,
})

export const normalizeDifficulty = (
  value: unknown,
): InterviewQuestionDifficulty => {
  if (value === 'easy' || value === 'medium' || value === 'hard') {
    return value
  }

  return 'medium'
}

export const normalizeScore = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0
  }

  if (value < 0) {
    return 0
  }

  if (value > 10) {
    return 10
  }

  return Math.round(value * 10) / 10
}

export const normalizeCriterion = (
  value: unknown,
): EvaluateInterviewCriterionResult => {
  const record =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {}

  return {
    score: normalizeScore(record.score),
    maxScore: normalizeScore(record.max_score) || 10,
    comment: coerceString(record.comment),
    improvementTip: coerceString(record.improvement_tip),
    correctedAnswer: normalizeOptionalString(record.corrected_answer),
    isStrongAnswer: record.is_strong_answer === true,
  }
}

export const buildQuestionResult = (
  record: Record<string, unknown>,
  model: string,
  requestId: string | null,
  usage: AnalyzeImageForKnowledgeBaseResult['usage'],
  previousQuestions: string[] = [],
) => {
  const question =
    coerceString(record.question) ||
    'Объясни основную идею этой темы и связанные с ней компромиссы.'

  if (!containsCyrillic(question)) {
    throw new AiServiceError('AI returned a non-Russian interview question.', {
      status: 502,
      code: 'ai_invalid_response',
    })
  }

  const normalizedQuestion = normalizeComparableQuestion(question)
  const repeatedQuestion = previousQuestions.some(
    (previousQuestion) =>
      normalizeComparableQuestion(previousQuestion) === normalizedQuestion,
  )

  if (repeatedQuestion) {
    throw new AiServiceError('AI returned a repeated interview question.', {
      status: 502,
      code: 'ai_invalid_response',
    })
  }

  return {
    question,
    rationale: coerceNullableString(record.rationale),
    expectedTopics: normalizeStringArray(record.expected_topics, 8),
    difficulty: normalizeDifficulty(record.difficulty),
    sourceIndexes: normalizeIntegerArray(record.source_indexes, 4),
    model,
    requestId,
    usage,
  }
}

export const buildImageAnalysisResult = (
  record: Record<string, unknown>,
  model: string,
  requestId: string | null,
  usage: AnalyzeImageForKnowledgeBaseResult['usage'],
) => ({
  extractedText: normalizeOptionalString(record.extracted_text),
  imageDescription: normalizeOptionalString(record.image_description),
  keyTerms: normalizeStringArray(record.key_terms, 20),
  model,
  requestId,
  usage,
})

export const buildEvaluationResult = (
  record: Record<string, unknown>,
  model: string,
  requestId: string | null,
  usage: EvaluateInterviewAnswerResult['usage'],
) => ({
  knowledgeBase: normalizeCriterion(record.knowledge_base),
  generalKnowledge: normalizeCriterion(record.general_knowledge),
  overallSummary: normalizeOptionalString(record.overall_summary),
  model,
  requestId,
  usage,
})

export const formatProviderModel = (
  providerName: string,
  model: string,
): string => `${providerName}:${model}`
