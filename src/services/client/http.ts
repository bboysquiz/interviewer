import { API_BASE_URL } from '@/services/api'

export const buildApiUrl = (path: string): string => {
  if (!API_BASE_URL) {
    return path
  }

  const normalizedBase = API_BASE_URL.endsWith('/')
    ? API_BASE_URL
    : `${API_BASE_URL}/`

  return new URL(path.replace(/^\//, ''), normalizedBase).toString()
}

export const requestJson = async <T>(
  path: string,
  init: RequestInit = {},
): Promise<T> => {
  const headers = new Headers(init.headers)

  if (!(init.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  let response: Response

  try {
    response = await fetch(buildApiUrl(path), {
      ...init,
      headers,
    })
  } catch (error) {
    if (
      error instanceof DOMException &&
      error.name === 'AbortError'
    ) {
      throw new Error('Запрос был прерван. Попробуй еще раз.')
    }

    throw new Error(
      'Не удалось связаться с сервером. Проверь, что backend запущен и доступен с этого устройства.',
    )
  }

  if (!response.ok) {
    let errorMessage = `Request failed with status ${response.status}`
    let responseText = ''

    try {
      responseText = await response.text()

      if (responseText) {
        const payload = JSON.parse(responseText) as { message?: string }
        if (payload.message) {
          errorMessage = payload.message
        }
      }
    } catch {
      if (response.status === 503) {
        errorMessage =
          'AI-сервис временно недоступен. Попробуй ещё раз через минуту.'
      } else if (responseText.trim()) {
        errorMessage = responseText.trim()
      }
    }

    throw new Error(errorMessage)
  }

  if (response.status === 204) {
    return undefined as T
  }

  return (await response.json()) as T
}
