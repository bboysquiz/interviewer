export type AppRouteName =
  | 'categories'
  | 'search'
  | 'interview'
  | 'analytics'
  | 'history'

export interface NavigationItem {
  label: string
  mark: string
  routeName: AppRouteName
}
