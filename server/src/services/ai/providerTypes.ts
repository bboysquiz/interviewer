import type {
  AnalyzeImageForKnowledgeBaseInput,
  AnalyzeImageForKnowledgeBaseResult,
  EvaluateInterviewAnswerInput,
  EvaluateInterviewAnswerResult,
  GenerateInterviewQuestionInput,
  GenerateInterviewQuestionResult,
} from './dto.js'

export type AiProviderName = 'gemini' | 'groq'

export interface AiProvider {
  name: AiProviderName
  isConfigured: boolean
  supportsImageAnalysis: boolean
  analyzeImageForKnowledgeBase: (
    input: AnalyzeImageForKnowledgeBaseInput,
  ) => Promise<AnalyzeImageForKnowledgeBaseResult>
  generateInterviewQuestion: (
    input: GenerateInterviewQuestionInput,
  ) => Promise<GenerateInterviewQuestionResult>
  evaluateInterviewAnswer: (
    input: EvaluateInterviewAnswerInput,
  ) => Promise<EvaluateInterviewAnswerResult>
}
