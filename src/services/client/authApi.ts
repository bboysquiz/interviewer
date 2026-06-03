import { API_PATHS } from '@/services/api'
import type { AuthSessionResponse } from '@/types'

import { requestJson } from './http'

export interface AuthCredentialsInput {
  username: string
  password: string
}

export const authApi = {
  me: () => requestJson<AuthSessionResponse>(API_PATHS.authMe),

  login: (input: AuthCredentialsInput) =>
    requestJson<AuthSessionResponse>(API_PATHS.authLogin, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  register: (input: AuthCredentialsInput) =>
    requestJson<AuthSessionResponse>(API_PATHS.authRegister, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  logout: () =>
    requestJson<void>(API_PATHS.authLogout, {
      method: 'POST',
    }),
}
