import type {
  GenerateInterviewQuestionInput,
  InterviewAnswerEvaluation,
  InterviewHistoryRecord,
  InterviewSourceType,
} from '@/types'

import {
  getInterviewHistoryEvaluation,
  getInterviewHistoryOccurredAt,
  getInterviewHistoryQuestion,
  getInterviewHistorySourceLabel,
} from './history'

const WEAK_SCORE_THRESHOLD = 7

export interface InterviewWeakSpot {
  id: string
  title: string
  sourceType: InterviewSourceType
  sourceLabel: string
  categoryId: string | null
  noteIds: string[]
  noteId: string | null
  latestQuestionPrompt: string | null
  lastOccurredAt: string
  weakestScore: number
  averageScore: number
  attempts: number
  latestKnowledgeBaseScore: number | null
  latestGeneralKnowledgeScore: number | null
  improvedAnswer: string | null
  recommendation: string
  priorityLabel: string
}

const getAverageScore = (evaluation: InterviewAnswerEvaluation): number =>
  (evaluation.knowledgeBase.score + evaluation.generalKnowledge.score) / 2

const getWeakestScore = (evaluation: InterviewAnswerEvaluation): number =>
  Math.min(evaluation.knowledgeBase.score, evaluation.generalKnowledge.score)

export const isWeakInterviewEvaluation = (
  evaluation: InterviewAnswerEvaluation,
): boolean =>
  getWeakestScore(evaluation) < WEAK_SCORE_THRESHOLD ||
  getAverageScore(evaluation) < WEAK_SCORE_THRESHOLD

const getWeakSpotKey = (record: InterviewHistoryRecord): string => {
  if (record.session.sourceType === 'category' && record.session.categoryId) {
    return `category:${record.session.categoryId}`
  }

  if (record.session.sourceType === 'note' && record.session.noteIds[0]) {
    return `note:${record.session.noteIds[0]}`
  }

  if (
    record.session.sourceType === 'note_collection' &&
    record.session.noteIds.length
  ) {
    return `note_collection:${record.session.noteIds.join(',')}`
  }

  return `${record.session.sourceType}:${record.session.title}`
}

const getWeakSpotRecommendation = (weakestScore: number): string => {
  if (weakestScore <= 4) {
    return 'Лучше повторить тему почти с нуля и потом снова проговорить ответ вслух.'
  }

  if (weakestScore <= 6) {
    return 'Стоит еще раз пройтись по ключевым тезисам и затем пересобрать формулировку.'
  }

  return 'Тема уже знакома, но полезно закрепить точные формулировки еще одним вопросом.'
}

const getWeakSpotPriorityLabel = (weakestScore: number): string => {
  if (weakestScore <= 4) {
    return 'Повторить в первую очередь'
  }

  if (weakestScore <= 6) {
    return 'Нужно повторить'
  }

  return 'Стоит закрепить'
}

export const buildInterviewWeakSpots = (
  records: InterviewHistoryRecord[],
): InterviewWeakSpot[] => {
  const spotMap = new Map<string, InterviewWeakSpot>()

  for (const record of records) {
    const evaluation = getInterviewHistoryEvaluation(record)

    if (!evaluation || !isWeakInterviewEvaluation(evaluation)) {
      continue
    }

    const currentKey = getWeakSpotKey(record)
    const weakestScore = getWeakestScore(evaluation)
    const averageScore = getAverageScore(evaluation)
    const occurredAt = getInterviewHistoryOccurredAt(record)
    const question = getInterviewHistoryQuestion(record)
    const existing = spotMap.get(currentKey)

    if (!existing) {
      spotMap.set(currentKey, {
        id: currentKey,
        title: record.session.title,
        sourceType: record.session.sourceType,
        sourceLabel: getInterviewHistorySourceLabel(record.session),
        categoryId: record.session.categoryId,
        noteIds: record.session.noteIds,
        noteId: record.session.noteIds[0] ?? null,
        latestQuestionPrompt: question?.prompt ?? null,
        lastOccurredAt: occurredAt,
        weakestScore,
        averageScore,
        attempts: 1,
        latestKnowledgeBaseScore: evaluation.knowledgeBase.score,
        latestGeneralKnowledgeScore: evaluation.generalKnowledge.score,
        improvedAnswer: evaluation.improvedAnswer,
        recommendation: getWeakSpotRecommendation(weakestScore),
        priorityLabel: getWeakSpotPriorityLabel(weakestScore),
      })
      continue
    }

    const isNewer = occurredAt.localeCompare(existing.lastOccurredAt) > 0
    const nextWeakestScore = Math.min(existing.weakestScore, weakestScore)
    const nextAttempts = existing.attempts + 1

    spotMap.set(currentKey, {
      ...existing,
      weakestScore: nextWeakestScore,
      averageScore:
        Math.round(
          ((existing.averageScore * existing.attempts + averageScore) /
            nextAttempts) *
            10,
        ) / 10,
      attempts: nextAttempts,
      recommendation: getWeakSpotRecommendation(nextWeakestScore),
      priorityLabel: getWeakSpotPriorityLabel(nextWeakestScore),
      ...(isNewer
        ? {
            title: record.session.title,
            sourceType: record.session.sourceType,
            sourceLabel: getInterviewHistorySourceLabel(record.session),
            categoryId: record.session.categoryId,
            noteIds: record.session.noteIds,
            noteId: record.session.noteIds[0] ?? null,
            latestQuestionPrompt: question?.prompt ?? null,
            lastOccurredAt: occurredAt,
            latestKnowledgeBaseScore: evaluation.knowledgeBase.score,
            latestGeneralKnowledgeScore: evaluation.generalKnowledge.score,
            improvedAnswer: evaluation.improvedAnswer,
          }
        : {}),
    })
  }

  return [...spotMap.values()].sort((left, right) => {
    if (left.weakestScore !== right.weakestScore) {
      return left.weakestScore - right.weakestScore
    }

    if (left.averageScore !== right.averageScore) {
      return left.averageScore - right.averageScore
    }

    return right.lastOccurredAt.localeCompare(left.lastOccurredAt)
  })
}

export const toWeakSpotQuestionInput = (
  weakSpot: InterviewWeakSpot,
): GenerateInterviewQuestionInput => ({
  sourceType: weakSpot.sourceType,
  categoryId: weakSpot.categoryId,
  noteIds: weakSpot.noteIds,
  title: `Повтор: ${weakSpot.title}`,
})
