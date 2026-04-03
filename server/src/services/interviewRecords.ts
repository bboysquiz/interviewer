import { parseStringArray } from '../lib/json.js'

export interface SessionRow {
  id: string
  status: string
  source_type: string
  title: string
  category_id: string | null
  note_ids_json: string
  current_question_id: string | null
  started_at: string
  completed_at: string | null
  created_at: string
  updated_at: string
}

export interface QuestionRow {
  id: string
  session_id: string
  source_type: string
  category_id: string | null
  note_ids_json: string
  prompt: string
  model: string
  status: string
  asked_at: string
  created_at: string
  updated_at: string
}

export interface EvaluationRow {
  id: string
  session_id: string
  question_id: string
  answer_text: string
  answered_at: string
  evaluated_at: string
  model: string
  knowledge_base_score: number
  knowledge_base_max_score: number
  knowledge_base_comment: string
  knowledge_base_improvement_tip: string
  knowledge_base_corrected_answer: string | null
  knowledge_base_is_strong_answer: number
  general_knowledge_score: number
  general_knowledge_max_score: number
  general_knowledge_comment: string
  general_knowledge_improvement_tip: string
  general_knowledge_corrected_answer: string | null
  general_knowledge_is_strong_answer: number
  overall_summary: string | null
  created_at: string
  updated_at: string
}

export const deriveImprovedAnswer = (
  knowledgeBaseCorrectedAnswer: string | null,
  generalKnowledgeCorrectedAnswer: string | null,
): string | null => {
  const candidates = [
    knowledgeBaseCorrectedAnswer?.trim() ?? '',
    generalKnowledgeCorrectedAnswer?.trim() ?? '',
  ].filter(Boolean)

  if (!candidates.length) {
    return null
  }

  const uniqueCandidates = [...new Set(candidates)]

  if (uniqueCandidates.length === 1) {
    return uniqueCandidates[0]
  }

  return uniqueCandidates.sort((left, right) => right.length - left.length)[0]
}

export const buildSession = (row: SessionRow) => ({
  id: row.id,
  status: row.status,
  sourceType: row.source_type,
  title: row.title,
  categoryId: row.category_id,
  noteIds: parseStringArray(row.note_ids_json),
  questionIds: [],
  currentQuestionId: row.current_question_id,
  startedAt: row.started_at,
  completedAt: row.completed_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

export const buildQuestion = (row: QuestionRow) => ({
  id: row.id,
  sessionId: row.session_id,
  sourceType: row.source_type,
  categoryId: row.category_id,
  noteIds: parseStringArray(row.note_ids_json),
  prompt: row.prompt,
  model: row.model,
  status: row.status,
  askedAt: row.asked_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

export const buildEvaluation = (row: EvaluationRow) => ({
  id: row.id,
  sessionId: row.session_id,
  questionId: row.question_id,
  answerText: row.answer_text,
  answeredAt: row.answered_at,
  evaluatedAt: row.evaluated_at,
  model: row.model,
  knowledgeBase: {
    criterion: 'knowledge_base' as const,
    score: row.knowledge_base_score,
    maxScore: row.knowledge_base_max_score,
    comment: row.knowledge_base_comment,
    improvementTip: row.knowledge_base_improvement_tip,
    correctedAnswer: row.knowledge_base_corrected_answer,
    isStrongAnswer: Boolean(row.knowledge_base_is_strong_answer),
  },
  generalKnowledge: {
    criterion: 'general_knowledge' as const,
    score: row.general_knowledge_score,
    maxScore: row.general_knowledge_max_score,
    comment: row.general_knowledge_comment,
    improvementTip: row.general_knowledge_improvement_tip,
    correctedAnswer: row.general_knowledge_corrected_answer,
    isStrongAnswer: Boolean(row.general_knowledge_is_strong_answer),
  },
  overallSummary: row.overall_summary,
  improvedAnswer: deriveImprovedAnswer(
    row.knowledge_base_corrected_answer,
    row.general_knowledge_corrected_answer,
  ),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

export const buildSessionWithQuestions = (
  row: SessionRow,
  questionRows: QuestionRow[],
) => {
  const questions = questionRows.map(buildQuestion)

  return {
    ...buildSession(row),
    questionIds: questions.map((question) => question.id),
    currentQuestionId: row.current_question_id ?? questions.at(-1)?.id ?? null,
  }
}

export const buildInterviewHistoryRecord = (
  sessionRow: SessionRow,
  questionRows: QuestionRow[],
  evaluationRows: EvaluationRow[],
) => ({
  session: buildSessionWithQuestions(sessionRow, questionRows),
  questions: questionRows.map(buildQuestion),
  evaluations: evaluationRows.map(buildEvaluation),
})
