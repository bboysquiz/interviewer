export type AiServiceErrorCode =
  | 'ai_config_error'
  | 'ai_validation_error'
  | 'ai_not_found'
  | 'ai_upstream_error'
  | 'ai_invalid_response'

export class AiServiceError extends Error {
  status: number
  code: AiServiceErrorCode
  details?: unknown

  constructor(
    message: string,
    options: {
      status?: number
      code?: AiServiceErrorCode
      details?: unknown
    } = {},
  ) {
    super(message)
    this.name = 'AiServiceError'
    this.status = options.status ?? 500
    this.code = options.code ?? 'ai_upstream_error'
    this.details = options.details
  }
}

export const toAiServiceError = (
  error: unknown,
  fallbackMessage: string,
): AiServiceError => {
  if (error instanceof AiServiceError) {
    return error
  }

  if (error instanceof Error) {
    return new AiServiceError(error.message, {
      status: 502,
      code: 'ai_upstream_error',
    })
  }

  return new AiServiceError(fallbackMessage, {
    status: 502,
    code: 'ai_upstream_error',
  })
}
