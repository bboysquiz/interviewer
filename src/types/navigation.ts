export type AppRouteName =
  | 'home'
  | 'categories'
  | 'search'
  | 'interview'
  | 'history'

export interface NavigationItem {
  label: string
  mark: string
  routeName: AppRouteName
}
