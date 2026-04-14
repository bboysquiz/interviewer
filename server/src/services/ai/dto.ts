export type AiInterviewSourceType = 'category' | 'note' | 'note_collection'

export interface AiUsageDto {
  inputTokens: number | null
  outputTokens: number | null
  totalTokens: number | null
}

export interface AiExecutionDto {
  model: string
  requestId: string | null
  usage: AiUsageDto | null
}

export interface AnalyzeImageForKnowledgeBaseInput {
  imageDataUrl: string
  fileName?: string | null
  noteTitle?: string | null
  categoryName?: string | null
}

export interface AnalyzeImageForKnowledgeBaseResult extends AiExecutionDto {
  extractedText: string | null
  imageDescription: string | null
  keyTerms: string[]
}

export type InterviewQuestionDifficulty = 'easy' | 'medium' | 'hard'

export interface GenerateInterviewQuestionInput {
  sourceType: AiInterviewSourceType
  sessionTitle: string
  categoryName?: string | null
  noteTitles: string[]
  knowledgeBaseContext: string
  groundingSources: string[]
  focusPrompt?: string | null
  previousQuestions: string[]
}

export interface GenerateInterviewQuestionResult extends AiExecutionDto {
  question: string
  rationale: string | null
  expectedTopics: string[]
  difficulty: InterviewQuestionDifficulty
  sourceIndexes: number[]
}

export interface EvaluateInterviewCriterionResult {
  score: number
  maxScore: number
  comment: string
  improvementTip: string
  correctedAnswer: string | null
  isStrongAnswer: boolean
}

export interface EvaluateInterviewAnswerInput {
  sessionTitle: string
  questionPrompt: string
  answerText: string
  categoryName?: string | null
  noteTitles: string[]
  knowledgeBaseContext: string
}

export interface EvaluateInterviewAnswerResult extends AiExecutionDto {
  knowledgeBase: EvaluateInterviewCriterionResult
  generalKnowledge: EvaluateInterviewCriterionResult
  overallSummary: string | null
}

export interface OrganizeKnowledgeBaseNoteBlockInput {
  id: string
  type: 'text' | 'image'
  text?: string | null
  fileName?: string | null
  extractedText?: string | null
  imageDescription?: string | null
}

export interface OrganizeKnowledgeBaseNoteInput {
  categoryName?: string | null
  noteTitle?: string | null
  blocks: OrganizeKnowledgeBaseNoteBlockInput[]
}

export interface OrganizedNoteSection {
  title: string
  blockIndexes: number[]
}

export interface OrganizeKnowledgeBaseNoteResult extends AiExecutionDto {
  sections: OrganizedNoteSection[]
}

export interface SuggestNoteStudyTopicsInput {
  targetCategoryName?: string | null
  targetNoteTitle?: string | null
  targetNoteDigest: string
  otherNotesDigest: string
  excludedTopicTitles: string[]
}

export interface NoteStudySuggestionItem {
  title: string
  kind: 'add' | 'deepen'
  whatItIs: string
  whySuggested: string
  recommendedFocus: string
}

export interface SuggestNoteStudyTopicsResult extends AiExecutionDto {
  suggestions: NoteStudySuggestionItem[]
}

export interface GenerateInterviewQuestionRequestDto {
  sourceType: AiInterviewSourceType
  categoryId?: string | null
  noteIds?: string[]
  title?: string | null
  focusPrompt?: string | null
  previousQuestions?: string[]
}

export interface EvaluateInterviewAnswerRequestDto {
  sessionId: string
  questionId: string
  answerText: string
}

export interface InterviewKnowledgeFragmentInput {
  text: string
  noteTitle?: string | null
  sourceLabel?: string | null
}

export interface CheckInterviewAnswerRequestDto {
  question: string
  answer: string
  knowledgeBaseFragments: InterviewKnowledgeFragmentInput[]
  sessionTitle?: string | null
  categoryName?: string | null
}

export interface CheckInterviewAnswerResponseDto {
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
