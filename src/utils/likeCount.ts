/**
 * The like count to show after a like/unlike tap, given whether the viewer's like now stands.
 *
 * `prevCount` is what the screen showed before the tap, and it includes the viewer's own like
 * when `prevLiked` is true. Take that like out to get everyone else's, then add the viewer's
 * back if it stands. Used for the optimistic flip AND for settling on the server's answer.
 *
 * The formula this replaces, `prevCount + (serverLiked ? 1 : 0)`, assumed the viewer had not
 * liked before the tap. So an unlike left the count where it was, and a tap on a card whose
 * like had already been removed on another screen counted the viewer twice: 1 like showed as 2.
 */
export function likeCountAfterToggle(
  prevCount: number,
  prevLiked: boolean,
  likedNow: boolean,
): number {
  const others = Math.max(prevCount - (prevLiked ? 1 : 0), 0);
  return others + (likedNow ? 1 : 0);
}
