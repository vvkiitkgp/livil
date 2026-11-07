/**
 * Opening a Livil link — a post (`/p/<id>`) or a profile (`/@<handle>`) on livil-music.com —
 * INSIDE the app, through exactly the path an incoming deep link takes: RootNavigator's
 * openShareLink (the readiness gate, the RLS-checked resolvers, the "no longer available"
 * toast). RootNavigator registers it while mounted; a link tapped in a chat message calls
 * openLivilLink, and opens the page in the browser when this answers false (another
 * livil-music.com page, or nothing registered).
 */
type Handler = (url: string) => Promise<boolean>;

let handler: Handler | null = null;

export function setLivilLinkHandler(next: Handler | null): void {
  handler = next;
}

/** True when the app took the link (a post or profile it opened, or held until sign-in). */
export async function openLivilLink(url: string): Promise<boolean> {
  if (!handler) { return false; }
  try {
    return await handler(url);
  } catch (e) {
    console.warn('[links] in-app open failed', e);
    return false;
  }
}
