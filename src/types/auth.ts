export interface AuthUser {
  id: string
  username: string
}

export interface AuthSessionResponse {
  user: AuthUser
}
