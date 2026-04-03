import type {
  InterviewAnswerEvaluation,
  InterviewCriterionEvaluation,
} from '@/types'

export type InterviewCriterionTone = 'strong' | 'medium' | 'weak'
export type InterviewResultStatus = 'excellent' | 'good' | 'needs_work'

export interface InterviewResultStatusMeta {
  key: InterviewResultStatus
  label: string
  description: string
}

const toRatio = (evaluation: InterviewCriterionEvaluation): number => {
  if (evaluation.maxScore <= 0) {
    return 0
  }

  return evaluation.score / evaluation.maxScore
}

export const getInterviewCriterionTone = (
  evaluation: InterviewCriterionEvaluation,
): InterviewCriterionTone => {
  const ratio = toRatio(evaluation)

  if (ratio >= 0.8) {
    return 'strong'
  }

  if (ratio >= 0.5) {
    return 'medium'
  }

  return 'weak'
}

export const getInterviewCriterionStatusLabel = (
  evaluation: InterviewCriterionEvaluation,
): string => {
  const tone = getInterviewCriterionTone(evaluation)

  if (tone === 'strong') {
    return 'Сильно'
  }

  if (tone === 'medium') {
    return 'Хорошо'
  }

  return 'Нужно усилить'
}

export const getInterviewResultStatus = (
  evaluation: InterviewAnswerEvaluation,
): InterviewResultStatusMeta => {
  const knowledgeBaseRatio = toRatio(evaluation.knowledgeBase)
  const generalKnowledgeRatio = toRatio(evaluation.generalKnowledge)
  const averageRatio = (knowledgeBaseRatio + generalKnowledgeRatio) / 2
  const minimumRatio = Math.min(knowledgeBaseRatio, generalKnowledgeRatio)

  if (averageRatio >= 0.85 && minimumRatio >= 0.8) {
    return {
      key: 'excellent',
      label: 'Отлично',
      description:
        'Ответ уверенно держится и по твоей базе знаний, и по общим знаниям модели.',
    }
  }

  if (averageRatio >= 0.65 && minimumRatio >= 0.6) {
    return {
      key: 'good',
      label: 'Хорошо',
      description:
        'Основа ответа крепкая. Если добавить несколько точных деталей, он станет заметно сильнее.',
    }
  }

  return {
    key: 'needs_work',
    label: 'Есть что исправить',
    description:
      'В ответе есть пробелы или неточности. Лучше опереться на подсказки ниже и переформулировать мысль.',
  }
}

export const getInterviewImprovedAnswer = (
  evaluation: InterviewAnswerEvaluation,
): string | null => {
  if (evaluation.improvedAnswer?.trim()) {
    return evaluation.improvedAnswer.trim()
  }

  const candidates = [
    evaluation.knowledgeBase.correctedAnswer,
    evaluation.generalKnowledge.correctedAnswer,
  ]
    .map((value) => value?.trim() ?? '')
    .filter(Boolean)

  if (!candidates.length) {
    return null
  }

  const uniqueCandidates = [...new Set(candidates)]

  if (uniqueCandidates.length === 1) {
    return uniqueCandidates[0]
  }

  return uniqueCandidates.sort((left, right) => right.length - left.length)[0]
}
