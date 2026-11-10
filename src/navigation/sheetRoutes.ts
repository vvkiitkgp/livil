import { getCurrentRoute, subscribeCurrentRoute } from './navigationRef';
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

/**
 * How long a sheet takes to slide away on Android: react-native-screens' slide_from_bottom exit
 * (rns_slide_out_to_bottom) runs for config_mediumAnimTime, 400 ms. A little longer, so what
 * comes back after a sheet does so once it has gone.
 */
export const SHEET_CLOSE_MS = 420;

/**
 * Runs `cb` once no sheet is on top any more and the last one has finished sliding away — at
 * once (after the slide time) if none is up now. Returns a cancel. For work that must not land
 * in the middle of a sheet's close (rebuilding the feed's music player after the Editor).
 */
export function afterSheetsClose(cb: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let unsubscribe: (() => void) | null = null;
  const settle = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; if (!isSheetRoute(getCurrentRoute().name)) { unsubscribe?.(); unsubscribe = null; cb(); } }, SHEET_CLOSE_MS);
  };
  unsubscribe = subscribeCurrentRoute(() => { if (!isSheetRoute(getCurrentRoute().name)) settle(); });
  if (!isSheetRoute(getCurrentRoute().name)) settle();
  return () => { if (timer) clearTimeout(timer); unsubscribe?.(); unsubscribe = null; };
}
