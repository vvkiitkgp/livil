import type { RootStackParamList } from './types';

/**
 * Root-stack screens presented as sheets (`presentation: 'modal'` / `'transparentModal'` in
 * RootNavigator). On iPhone a sheet is a native layer above the whole app, so it covers the
 * floating player by itself; Android draws the same screen in one window with the player on top,
 * so the player hides itself while one of these is the top screen (see FloatingPlayer).
 *
 * Kept in step with RootNavigator by `__tests__/sheetRoutes.test.ts`.
 */
export const SHEET_ROUTES: ReadonlySet<keyof RootStackParamList> = new Set<keyof RootStackParamList>([
  'Upload',
  'Repost',
  'AddToLivil',
  'Drafts',
  'Studio',
  'SpotifyRepost',
  'StoryViewer',
  'CollaboratorPicker',
  'CreateAlbum',
  'EditAlbum',
  'EditPlaylist',
  'CreatePlaylist',
  'ChatMediaViewer',
]);

export function isSheetRoute(name: string): boolean {
  return (SHEET_ROUTES as ReadonlySet<string>).has(name);
}
