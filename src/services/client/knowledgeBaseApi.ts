import { API_PATHS } from '@/services/api'
import type {
  Attachment,
  AiAnalyticsSnapshot,
  Category,
  CheckInterviewAnswerInput,
  CheckInterviewAnswerResponse,
  InterviewHistoryRecord,
  EvaluateInterviewAnswerInput,
  EvaluateInterviewAnswerResponse,
  GenerateInterviewQuestionInput,
  GenerateInterviewQuestionResponse,
  Note,
  NoteContentBlock,
  SearchResult,
} from '@/types'

import { requestJson } from './http'

export interface CreateCategoryInput {
  name: string
  description?: string
  color?: string | null
  icon?: string | null
  sortOrder?: number
  slug?: string
}

export interface UpdateCategoryInput {
  name?: string
  description?: string
  color?: string | null
  icon?: string | null
  sortOrder?: number
  slug?: string
}

export interface CreateNoteInput {
  categoryId: string
  title: string
  rawText: string
  contentBlocks?: NoteContentBlock[]
}

export interface UpdateNoteInput {
  title?: string
  rawText?: string
  contentBlocks?: NoteContentBlock[]
}

export interface OrganizeNoteResponse {
  note: Note
  organized: {
    sectionCount: number
    mode?: 'ai' | 'local'
  }
  ai: {
    model: string
    requestId: string | null
    usage: {
      inputTokens: number | null
      outputTokens: number | null
      totalTokens: number | null
    } | null
  }
}

export interface OrganizeNoteInput {
  mode?: 'ai' | 'local'
  sectionTitles?: string[]
}

export interface UpdateAttachmentProcessingInput {
  extractedText?: string | null
  imageDescription?: string | null
  keyTerms?: string[]
  processingStatus?: 'pending' | 'processing' | 'ready' | 'failed'
  processingError?: string | null
  analysisModel?: string | null
  analysisRequestId?: string | null
  width?: number | null
  height?: number | null
}

export interface AnalyzeAttachmentInput {
  force?: boolean
}

export interface AnalyzeAttachmentResponse {
  attachment: Attachment | null
  analysis: {
    status: 'completed' | 'skipped'
    model: string | null
    requestId: string | null
    usage: {
      inputTokens: number | null
      outputTokens: number | null
      totalTokens: number | null
    } | null
  }
}

export interface SearchInput {
  query: string
  categoryId?: string
}

export const knowledgeBaseApi = {
  listCategories: () => requestJson<Category[]>(API_PATHS.categories),

  createCategory: (input: CreateCategoryInput) =>
    requestJson<Category>(API_PATHS.categories, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  updateCategory: (categoryId: string, input: UpdateCategoryInput) =>
    requestJson<Category>(`${API_PATHS.categories}/${categoryId}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),

  deleteCategory: (categoryId: string) =>
    requestJson<void>(`${API_PATHS.categories}/${categoryId}`, {
      method: 'DELETE',
    }),

  search: ({ query, categoryId }: SearchInput) => {
    const params = new URLSearchParams()
    params.set('q', query.trim())

    if (categoryId) {
      params.set('categoryId', categoryId)
    }

    return requestJson<SearchResult[]>(
      `${API_PATHS.search}?${params.toString()}`,
    )
  },

  listNotes: (categoryId?: string) => {
    const query = categoryId
      ? `${API_PATHS.notes}?categoryId=${encodeURIComponent(categoryId)}`
      : API_PATHS.notes

    return requestJson<Note[]>(query)
  },

  getNote: (noteId: string) => requestJson<Note>(`${API_PATHS.notes}/${noteId}`),

  createNote: (input: CreateNoteInput) =>
    requestJson<Note>(API_PATHS.notes, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  updateNote: (noteId: string, input: UpdateNoteInput) =>
    requestJson<Note>(`${API_PATHS.notes}/${noteId}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),

  organizeNote: (noteId: string, input: OrganizeNoteInput = {}) =>
    requestJson<OrganizeNoteResponse>(`${API_PATHS.notes}/${noteId}/organize`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  deleteNote: (noteId: string) =>
    requestJson<void>(`${API_PATHS.notes}/${noteId}`, {
      method: 'DELETE',
    }),

  listAttachments: (filters: { noteId?: string; categoryId?: string } = {}) => {
    const params = new URLSearchParams()

    if (filters.noteId) {
      params.set('noteId', filters.noteId)
    }

    if (filters.categoryId) {
      params.set('categoryId', filters.categoryId)
    }

    const query = params.size
      ? `${API_PATHS.attachments}?${params.toString()}`
      : API_PATHS.attachments

    return requestJson<Attachment[]>(query)
  },

  uploadAttachment: (formData: FormData) =>
    requestJson<Attachment>(API_PATHS.attachments, {
      method: 'POST',
      body: formData,
    }),

  analyzeAttachment: (
    attachmentId: string,
    input: AnalyzeAttachmentInput = {},
  ) =>
    requestJson<AnalyzeAttachmentResponse>(
      `${API_PATHS.attachments}/${attachmentId}/analyze`,
      {
        method: 'POST',
        body: JSON.stringify(input),
      },
    ),

  getAiAnalytics: () =>
    requestJson<AiAnalyticsSnapshot>(API_PATHS.analyticsAi),

  updateAttachmentProcessing: (
    attachmentId: string,
    input: UpdateAttachmentProcessingInput,
  ) =>
    requestJson<Attachment>(`${API_PATHS.attachments}/${attachmentId}/processing`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),

  listInterviewHistory: () =>
    requestJson<InterviewHistoryRecord[]>(API_PATHS.interviewHistory),

  getInterviewHistoryRecord: (sessionId: string) =>
    requestJson<InterviewHistoryRecord>(
      `${API_PATHS.interviewHistory}/${sessionId}`,
    ),

  generateInterviewQuestion: (input: GenerateInterviewQuestionInput) =>
    requestJson<GenerateInterviewQuestionResponse>(API_PATHS.interviewQuestions, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  evaluateInterviewAnswer: (input: EvaluateInterviewAnswerInput) =>
    requestJson<EvaluateInterviewAnswerResponse>(
      API_PATHS.interviewEvaluations,
      {
        method: 'POST',
        body: JSON.stringify(input),
      },
    ),

  checkInterviewAnswer: (input: CheckInterviewAnswerInput) =>
    requestJson<CheckInterviewAnswerResponse>(API_PATHS.interviewCheckAnswer, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
}
