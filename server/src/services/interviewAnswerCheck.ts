import { OPENAI_INTERVIEW_CONTEXT_MAX_CHARS } from '../config.js'
import { coerceNullableString, coerceString } from '../lib/text.js'
import type {
  CheckInterviewAnswerResponseDto,
  EvaluateInterviewAnswerResult,
  InterviewKnowledgeFragmentInput,
} from './ai/dto.js'

export const uniqueNonEmpty = (value: string[]): string[] =>
  [...new Set(value.map((item) => item.trim()).filter(Boolean))]

export const normalizeKnowledgeBaseFragments = (
  value: unknown,
): InterviewKnowledgeFragmentInput[] => {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map((fragment): InterviewKnowledgeFragmentInput | null => {
      if (typeof fragment === 'string') {
        const text = fragment.trim()

        return text
          ? {
              text,
            }
          : null
      }

      if (!fragment || typeof fragment !== 'object' || Array.isArray(fragment)) {
        return null
      }

      const record = fragment as Record<string, unknown>
      const text = coerceString(
        record.text,
        coerceString(record.content, coerceString(record.excerpt)),
      )

      if (!text) {
        return null
      }

      return {
        text,
        noteTitle: coerceNullableString(record.noteTitle ?? record.note_title),
        sourceLabel: coerceNullableString(
          record.sourceLabel ?? record.source_label,
        ),
      }
    })
    .filter(
      (fragment): fragment is InterviewKnowledgeFragmentInput =>
        fragment !== null,
    )
}

export const buildKnowledgeBaseContextFromFragments = (
  fragments: InterviewKnowledgeFragmentInput[],
): string => {
  const sections = ['Knowledge base fragments:']
  let usedChars = sections[0].length

  for (const fragment of fragments) {
    const section = [
      fragment.noteTitle ? `Note: ${fragment.noteTitle}` : null,
      fragment.sourceLabel ? `Source: ${fragment.sourceLabel}` : null,
      fragment.text,
    ]
      .filter(Boolean)
      .join('\n')

    if (
      sections.length > 1 &&
      usedChars + section.length + 2 > OPENAI_INTERVIEW_CONTEXT_MAX_CHARS
    ) {
      break
    }

    sections.push(section)
    usedChars += section.length + 2
  }

  return sections.join('\n\n')
}

export const deriveAnswerCheckVerdict = (
  scoreKbAccuracy: number,
  scoreGeneralAccuracy: number,
): CheckInterviewAnswerResponseDto['verdict'] => {
  const averageScore = (scoreKbAccuracy + scoreGeneralAccuracy) / 2
  const minScore = Math.min(scoreKbAccuracy, scoreGeneralAccuracy)

  if (averageScore >= 8.5 && minScore >= 8) {
    return 'strong'
  }

  if (averageScore >= 6.5 && minScore >= 6) {
    return 'good_with_minor_gaps'
  }

  if (averageScore >= 4.5 && minScore >= 4) {
    return 'partial'
  }

  return 'needs_improvement'
}

export const toStrictAnswerCheckResponse = (
  evaluation: EvaluateInterviewAnswerResult,
): CheckInterviewAnswerResponseDto => ({
  score_kb_accuracy: evaluation.knowledgeBase.score,
  score_general_accuracy: evaluation.generalKnowledge.score,
  feedback_kb: evaluation.knowledgeBase.comment,
  feedback_general: evaluation.generalKnowledge.comment,
  improved_answer:
    evaluation.knowledgeBase.correctedAnswer ??
    evaluation.generalKnowledge.correctedAnswer,
  verdict: deriveAnswerCheckVerdict(
    evaluation.knowledgeBase.score,
    evaluation.generalKnowledge.score,
  ),
})
