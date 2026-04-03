import type { BaseEntity, EntityId, ISODateString } from './base'

export type InterviewSourceType = 'category' | 'note' | 'note_collection'
export type InterviewSessionStatus =
  | 'queued'
  | 'active'
  | 'completed'
  | 'cancelled'
export type InterviewQuestionStatus = 'pending' | 'answered' | 'evaluated'
export type InterviewEvaluationCriterion =
  | 'knowledge_base'
  | 'general_knowledge'

export interface InterviewSession extends BaseEntity {
  status: InterviewSessionStatus
  sourceType: InterviewSourceType
  title: string
  categoryId: EntityId | null
  noteIds: EntityId[]
  questionIds: EntityId[]
  currentQuestionId: EntityId | null
  startedAt: ISODateString
  completedAt: ISODateString | null
}

export interface InterviewQuestion extends BaseEntity {
  sessionId: EntityId
  sourceType: InterviewSourceType
  categoryId: EntityId | null
  noteIds: EntityId[]
  prompt: string
  model: string
  status: InterviewQuestionStatus
  askedAt: ISODateString
}

export interface InterviewCriterionEvaluation {
  criterion: InterviewEvaluationCriterion
  score: number
  maxScore: number
  comment: string
  improvementTip: string
  correctedAnswer: string | null
  isStrongAnswer: boolean
}

export interface InterviewAnswerEvaluation extends BaseEntity {
  sessionId: EntityId
  questionId: EntityId
  answerText: string
  answeredAt: ISODateString
  evaluatedAt: ISODateString
  model: string
  knowledgeBase: InterviewCriterionEvaluation
  generalKnowledge: InterviewCriterionEvaluation
  overallSummary: string | null
  improvedAnswer: string | null
}
