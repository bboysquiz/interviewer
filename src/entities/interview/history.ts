import type {
  InterviewAnswerEvaluation,
  InterviewHistoryRecord,
  InterviewQuestion,
  InterviewSession,
} from '@/types'

export const sortInterviewHistoryRecords = (
  records: InterviewHistoryRecord[],
): InterviewHistoryRecord[] =>
  [...records].sort((left, right) => {
    const leftDate =
      left.evaluations[0]?.evaluatedAt ??
      left.session.completedAt ??
      left.session.startedAt
    const rightDate =
      right.evaluations[0]?.evaluatedAt ??
      right.session.completedAt ??
      right.session.startedAt

    return rightDate.localeCompare(leftDate)
  })

export const getInterviewHistoryQuestion = (
  record: InterviewHistoryRecord,
): InterviewQuestion | null => record.questions.at(-1) ?? null

export const getInterviewHistoryEvaluation = (
  record: InterviewHistoryRecord,
): InterviewAnswerEvaluation | null => record.evaluations[0] ?? null

export const getInterviewHistoryOccurredAt = (
  record: InterviewHistoryRecord,
): string =>
  getInterviewHistoryEvaluation(record)?.evaluatedAt ??
  record.session.completedAt ??
  record.session.startedAt

export const getInterviewHistorySourceLabel = (
  session: InterviewSession,
): string => {
  if (session.sourceType === 'category') {
    return 'По категории'
  }

  if (session.sourceType === 'note') {
    return 'По заметке'
  }

  return 'По подборке заметок'
}

export const formatInterviewHistoryDate = (value: string): string =>
  new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
