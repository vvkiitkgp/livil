import { formatCount } from '../format';

/**
 * How this post looks in the mobile feed.
 *
 * A PHONE FRAME at true 390px rather than a full-width web card, and the width is the whole
 * argument. `PostCard` clamps the track title to 1 line and the caption to 4; at 390px those
 * clamps are exercised where they will actually ship. A wide web card would show a title on
 * one line that wraps to three on a phone — a false negative on precisely the question being
 * asked. The bezel also sets the right expectation: this is an approximation of the phone,
 * not the thing itself.
 *
 * STATIC ON PURPOSE. No play button, no like, no seek. Every control drawn in a preview is
 * either a lie or a second implementation of playback, and the real player is on the right.
 *
 * DUPLICATION WE ARE CHOOSING. These constants are read from
 * `src/components/PostCard.tsx` — card radius 20 / padding 14 (:872-878), avatar 42/21
 * (:avatar), title 17/800/-0.3, caption 14/20 clamped at 4 (:628). If that file changes, this
 * preview starts lying. The real fix is to put those layout constants in `shared/` as data
 * and have both renderers read them; that is one small extraction and it is not yet earned.
 * Until then, this comment is the link between them.
 */
export function PostPreview({
  displayName,
  username,
  avatarUrl,
  title,
  caption,
  coverUrl,
  mediaKind,
  plays,
  likes,
  comments,
  reposts,
}: {
  displayName: string;
  username: string;
  avatarUrl: string | null;
  title: string;
  caption: string | null;
  coverUrl: string | null;
  mediaKind: 'audio' | 'video';
  plays: number;
  likes: number;
  comments: number;
  reposts: number;
}) {
  const initial = displayName.trim().charAt(0).toUpperCase() || '♪';

  return (
    <div className="phone" aria-label="Preview of this post in the app">
      <div className="phone__screen">
        <div className="pc">
          <header className="pc__head">
            <span className="pc__avatar">
              {avatarUrl ? <img src={avatarUrl} alt="" /> : <span>{initial}</span>}
            </span>
            <span className="pc__who">
              <span className="pc__name">{displayName}</span>
              <span className="pc__meta">
                @{username} · now
              </span>
            </span>
          </header>

          <div className="pc__art">
            {coverUrl ? (
              <img src={coverUrl} alt="" />
            ) : (
              <span className="stripes pc__art-empty" />
            )}
            {mediaKind === 'video' && <span className="pc__kind">video</span>}
          </div>

          <p className="pc__title">{title || 'Untitled'}</p>

          {caption && <p className="pc__caption">{caption}</p>}

          <div className="pc__stats">
            <span>♥ {formatCount(likes)}</span>
            <span>↺ {formatCount(reposts)}</span>
            <span>💬 {formatCount(comments)}</span>
            <span className="pc__plays">▶ {formatCount(plays)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
