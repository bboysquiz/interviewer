const rawApiBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim()

export const API_BASE_URL =
  rawApiBaseUrl ?? (import.meta.env.DEV ? 'http://localhost:3000' : '')

export const API_PATHS = {
  health: '/api/health',
  categories: '/api/categories',
  notes: '/api/notes',
  search: '/api/search',
  attachments: '/api/attachments',
  analyticsAi: '/api/analytics/ai',
  interviewQuestions: '/api/interview/questions',
  interviewEvaluations: '/api/interview/evaluations',
  interviewCheckAnswer: '/api/interview/check-answer',
  interviewHistory: '/api/interview/history',
} as const
