import { useEffect, useState } from 'react';
import { Link, useNavigate, useOutletContext, useParams } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { updateTrackMetadata } from '@shared/services/editTrack';
import { Button } from '../components/Button';
import { TextField } from '../components/TextField';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { PostPreview } from '../components/PostPreview';
import {
  fetchPostDetail,
  unpublishPost,
  type CreatorProfile,
  type PostDetail,
} from '../data/creator';
import { formatCount, formatDate, formatDuration } from '../format';

type Ctx = { session: Session; profile: CreatorProfile | null };

/**
 * One post: how it looks, how it did, and the two things worth changing after publishing.
 *
 * Editing metadata after the fact is the highest-value thing a desktop tool adds over the
 * phone — mobile has no edit-track screen at all — and it is cheap, because title and
 * description are plain columns.
 */
export function TrackDetail() {
  const { postId } = useParams<{ postId: string }>();
  const { profile } = useOutletContext<Ctx>();
  const navigate = useNavigate();

  const [post, setPost] = useState<PostDetail | null | 'missing'>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [removing, setRemoving] = useState(false);

  useEffect(() => {
    if (!postId) return;
    let cancelled = false;
    fetchPostDetail(postId)
      .then(p => {
        if (cancelled) return;
        if (!p) {
          setPost('missing');
          return;
        }
        setPost(p);
        setTitle(p.title);
        // The two columns are kept in step by `updateTrackMetadata`; either is a valid
        // starting value, and `description` is the one search reads.
        setDescription(p.description ?? p.caption ?? '');
      })
      .catch(() => {
        if (!cancelled) setPost('missing');
      });
    return () => {
      cancelled = true;
    };
  }, [postId]);

  if (post === 'missing') {
    return (
      <div className="page fade-up">
        <div className="empty panel">
          <p className="empty__title">Track not found</p>
          <p className="hint">It may have been unpublished.</p>
          <Button onClick={() => navigate('/tracks')}>Back to catalogue</Button>
        </div>
      </div>
    );
  }

  if (post === null) {
    return (
      <div className="page fade-up">
        <div className="skeleton skeleton--rows" />
      </div>
    );
  }

  const dirty = title !== post.title || description !== (post.description ?? post.caption ?? '');
  const canSave = dirty && title.trim() !== '' && !saving;

  async function onSave() {
    if (!postId || post === null || post === 'missing') return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await updateTrackMetadata({
        trackId: post.trackId,
        postId: post.postId,
        title,
        description,
      });
      setPost({ ...post, title: title.trim(), description: description.trim() || null,
        caption: description.trim() || null });
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.');
    } finally {
      setSaving(false);
    }
  }

  async function onUnpublish() {
    if (!postId) return;
    setRemoving(true);
    try {
      await unpublishPost(postId);
      navigate('/tracks', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not unpublish.');
      setRemoving(false);
      setConfirming(false);
    }
  }

  const displayName = profile?.displayName || profile?.username || 'You';

  return (
    <div className="page fade-up">
      <header className="page__head">
        <div>
          <p className="kicker">
            <Link className="linkish" to="/tracks">
              ← Catalogue
            </Link>
          </p>
          <h1 className="display page__title">{post.title}</h1>
          <p className="hint">
            {post.mediaKind} · {formatDuration(post.durationSeconds)} · published{' '}
            {formatDate(post.publishedAt)}
          </p>
        </div>
      </header>

      <div className="detail">
        {/* ── How it looks ───────────────────────────────────────────── */}
        <section className="detail__preview">
          <p className="kicker">In the app</p>
          <PostPreview
            displayName={displayName}
            username={profile?.username ?? ''}
            avatarUrl={profile?.avatarUrl ?? null}
            title={title}
            caption={description || null}
            coverUrl={post.coverUrl}
            mediaKind={post.mediaKind}
            plays={post.plays}
            likes={post.likes}
            comments={post.comments}
            reposts={post.reposts}
          />
          <p className="hint detail__previewnote">
            Live preview at true phone width — the title and caption clip here exactly as they
            will in the feed.
          </p>
        </section>

        {/* ── Numbers, player, edit ──────────────────────────────────── */}
        <section className="detail__main">
          <div className="metrics metrics--four">
            <Stat label="Plays" value={post.plays} strong />
            <Stat label="Likes" value={post.likes} />
            <Stat label="Comments" value={post.comments} />
            <Stat label="Reposts" value={post.reposts} />
          </div>

          {post.mediaUrl && (
            <div className="panel">
              <div className="panel__head">
                <h2 className="panel__title">Listen to what shipped</h2>
              </div>
              {/* The published file, not the local one — this answers "did the upload
                  actually work", which the preview structurally cannot. */}
              <audio className="player" controls preload="none" src={post.mediaUrl} />
            </div>
          )}

          <div className="panel">
            <div className="panel__head">
              <h2 className="panel__title">Details</h2>
              {saved && !dirty && <span className="hint">Saved</span>}
            </div>

            <div className="form">
              <TextField
                label="Title"
                value={title}
                onChange={e => {
                  setTitle(e.target.value);
                  setSaved(false);
                }}
                disabled={saving}
              />
              <TextField
                label="Description"
                value={description}
                onChange={e => {
                  setDescription(e.target.value);
                  setSaved(false);
                }}
                disabled={saving}
                placeholder="What should listeners know about this?"
              />

              {error && (
                <p className="alert" role="alert">
                  {error}
                </p>
              )}

              <div className="filerow">
                <Button disabled={!canSave} busy={saving} onClick={onSave}>
                  Save changes
                </Button>
                {dirty && (
                  <Button
                    variant="ghost"
                    disabled={saving}
                    onClick={() => {
                      setTitle(post.title);
                      setDescription(post.description ?? post.caption ?? '');
                      setError(null);
                    }}
                  >
                    Discard
                  </Button>
                )}
              </div>
            </div>
          </div>

          <div className="panel panel--danger">
            <div className="panel__head">
              <h2 className="panel__title">Unpublish</h2>
            </div>
            <p className="hint">
              Removes this post from feeds and your profile. Your uploaded file is kept — this
              is not deleting the track.
            </p>
            <div className="filerow">
              <Button variant="destructive" onClick={() => setConfirming(true)}>
                Unpublish
              </Button>
            </div>
          </div>
        </section>
      </div>

      {confirming && (
        <ConfirmDialog
          title="Unpublish this track?"
          body="It disappears from feeds and your profile straight away. The uploaded file stays, so you can publish it again later."
          confirmLabel="Unpublish"
          destructive
          busy={removing}
          onConfirm={onUnpublish}
          onCancel={() => setConfirming(false)}
        />
      )}
    </div>
  );
}

function Stat({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className="metric">
      <span className="metric__value" data-strong={strong || undefined}>
        {formatCount(value)}
      </span>
      <span className="metric__label">{label}</span>
    </div>
  );
}
