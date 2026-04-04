export type AiAnalyticsTask =
  | 'image_analysis'
  | 'interview_question_generation'
  | 'interview_answer_evaluation'
  | 'note_organization'

export type AiAnalyticsChannel = 'text' | 'image'

export interface AiAnalyticsUsageTotals {
  requests: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
}

export interface AiAnalyticsTaskSummary extends AiAnalyticsUsageTotals {
  task: AiAnalyticsTask
  used24h: number
  usedAllTime: number
}

export interface AiAnalyticsChannelSummary extends AiAnalyticsUsageTotals {
  provider: string
  channel: AiAnalyticsChannel
  models: string[]
  used24h: number
  usedAllTime: number
  limit24h: number | null
  remaining24h: number | null
}

export interface AiAnalyticsFriendlyBudget {
  id:
    | 'question_generation'
    | 'answer_evaluation'
    | 'image_analysis'
    | 'note_organization'
  channel: AiAnalyticsChannel
  used24h: number
  limit24h: number | null
  remaining24h: number | null
}

export interface AiAnalyticsAttachmentsSummary {
  total: number
  ready: number
  pending: number
  processing: number
  failed: number
}

export interface AiAnalyticsSnapshot {
  generatedAt: string
  windowHours: number
  configuredProviders: string[]
  overview: {
    lastWindow: AiAnalyticsUsageTotals
    allTime: AiAnalyticsUsageTotals
  }
  tasks: AiAnalyticsTaskSummary[]
  channels: AiAnalyticsChannelSummary[]
  friendlyBudgets: AiAnalyticsFriendlyBudget[]
  attachments: AiAnalyticsAttachmentsSummary
}
