import type {
  EntityId,
  InterviewAnswerEvaluation,
  InterviewQuestion,
  InterviewSession,
  InterviewSourceType,
} from './models'

export interface InterviewAiUsage {
  inputTokens: number | null
  outputTokens: number | null
  totalTokens: number | null
}

export interface InterviewAiMetadata {
  model: string
  requestId: string | null
  usage?: InterviewAiUsage | null
}

export interface InterviewContextSummary {
  title: string
  sourceType: InterviewSourceType
  categoryId: EntityId | null
  categoryName: string | null
  noteIds: EntityId[]
  noteTitles: string[]
  noteCount: number
  chunkCount: number
  totalFoundationCount: number
  sources: InterviewQuestionSource[]
}

export interface InterviewQuestionSource {
  foundationKey: string
  noteId: EntityId
  categoryId: EntityId
  noteTitle: string
  sourceType:
    | 'note_title'
    | 'note_content'
    | 'attachment_extracted_text'
    | 'attachment_description'
  sourceLabel: string
  excerpt: string
  content: string
  attachmentId: EntityId | null
  attachmentStoragePath: string | null
  attachmentOriginalFileName: string | null
  lastQuestionedAt: string | null
}

export interface GenerateInterviewQuestionInput {
  sourceType: InterviewSourceType
  categoryId?: EntityId | null
  noteIds?: EntityId[]
  title?: string | null
  focusPrompt?: string | null
  previousQuestions?: string[]
}

export interface GenerateInterviewQuestionResponse {
  session: InterviewSession
  question: InterviewQuestion
  generated: {
    rationale: string | null
    expectedTopics: string[]
    difficulty: 'easy' | 'medium' | 'hard'
  }
  ai: InterviewAiMetadata
  context: InterviewContextSummary
}

export interface EvaluateInterviewAnswerInput {
  sessionId: EntityId
  questionId: EntityId
  answerText: string
}

export interface EvaluateInterviewAnswerResponse {
  session: InterviewSession
  question: InterviewQuestion
  evaluation: InterviewAnswerEvaluation
  ai: InterviewAiMetadata
  context: InterviewContextSummary
}

export interface InterviewHistoryRecord {
  session: InterviewSession
  questions: InterviewQuestion[]
  evaluations: InterviewAnswerEvaluation[]
}

export interface InterviewKnowledgeFragmentInput {
  text: string
  noteTitle?: string | null
  sourceLabel?: string | null
}

export interface CheckInterviewAnswerInput {
  question: string
  answer: string
  knowledgeBaseFragments: InterviewKnowledgeFragmentInput[]
  sessionTitle?: string | null
  categoryName?: string | null
}

export interface CheckInterviewAnswerResponse {
  score_kb_accuracy: number
  score_general_accuracy: number
  feedback_kb: string
  feedback_general: string
  improved_answer: string | null
  verdict:
    | 'strong'
    | 'good_with_minor_gaps'
    | 'partial'
    | 'needs_improvement'
}
