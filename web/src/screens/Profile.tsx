import { useEffect, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import {
  BIO_MAX,
  DISPLAY_NAME_MAX,
  MAX_LINKS,
  updateProfile,
  validateLink,
} from '@shared/services/profile';
import { Avatar } from '../components/Avatar';
import { Button } from '../components/Button';
import { TextField } from '../components/TextField';
import { CoverCropper } from '../components/CoverCropper';
import { uploadAvatar } from '../upload/avatar';
import { fetchProfileLinks, type CreatorProfile } from '../data/creator';

type Ctx = { session: Session; profile: CreatorProfile | null };

/**
 * Profile editing.
 *
 * What is NOT here is as deliberate as what is. `username` is displayed and cannot be
 * changed — it is permanent for life via a database trigger, claimed once through
 * `claim_username`, never through an update. Birthday and phone, which the mobile editor
 * collects, are absent: they are private-profile fields and a creator operations tool has no
 * business asking for them.
 *
 * The update payload is built in `shared/services/profile.ts` as an explicit literal rather
 * than from form state, so no stray field can reach a column nothing guards.
 */
export function Profile() {
  const { session, profile } = useOutletContext<Ctx>();

  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [links, setLinks] = useState<string[]>([]);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const [cropping, setCropping] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Seed from the shell's copy when it arrives, then own the state locally.
  useEffect(() => {
    if (!profile || loaded) return;
    setDisplayName(profile.displayName ?? '');
    setBio(profile.bio ?? '');
    setAvatarUrl(profile.avatarUrl);
    setLoaded(true);
  }, [profile, loaded]);

  // `links` is not on the shell's projection, so it needs its own read.
  useEffect(() => {
    let cancelled = false;
    fetchProfileLinks(session.user.id)
      .then(l => {
        if (!cancelled) setLinks(l);
      })
      .catch(() => {
        /* an empty list is a safe starting point */
      });
    return () => {
      cancelled = true;
    };
  }, [session.user.id]);

  const linkErrors = links.map(validateLink);
  const firstLinkError = linkErrors.find(Boolean) ?? null;
  const overName = displayName.trim().length > DISPLAY_NAME_MAX;
  const overBio = bio.trim().length > BIO_MAX;
  const canSave = loaded && !saving && !uploading && !firstLinkError && !overName && !overBio;

  async function onPickedAvatar(cropped: File) {
    setCropping(null);
    setUploading(true);
    setError(null);
    try {
      const url = await uploadAvatar(session.user.id, cropped);
      // Persist immediately: an uploaded-but-unsaved avatar is a file in the bucket that
      // nothing points at, and the artist has no way to know that happened.
      await updateProfile(session.user.id, {
        displayName: displayName || null,
        bio: bio || null,
        links,
        avatarUrl: url,
      });
      setAvatarUrl(url);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update your photo.');
    } finally {
      setUploading(false);
    }
  }

  async function onSave() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await updateProfile(session.user.id, {
        displayName: displayName || null,
        bio: bio || null,
        links,
      });
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="page fade-up">
      <header className="page__head">
        <div>
          <p className="kicker">The guest list</p>
          <h1 className="display page__title">Profile</h1>
        </div>
      </header>

      <section className="panel profile__form">
        <div className="avatarpick">
          <Avatar url={avatarUrl} name={displayName || profile?.username || ''} size={72} />
          <div>
            <Button
              variant="secondary"
              size="sm"
              busy={uploading}
              onClick={() => document.getElementById('avatar-input')?.click()}
            >
              {avatarUrl ? 'Change photo' : 'Add photo'}
            </Button>
            <p className="hint">Square, shown as a circle. Saved as soon as you crop it.</p>
          </div>
          <input
            id="avatar-input"
            type="file"
            accept="image/*"
            hidden
            onChange={e => {
              const file = e.target.files?.[0];
              if (file) setCropping(file);
              e.target.value = '';
            }}
          />
        </div>

        <div>
          <TextField
            label="Display name"
            value={displayName}
            onChange={e => {
              setDisplayName(e.target.value);
              setSaved(false);
            }}
            disabled={saving}
          />
          <p className="counter" data-over={overName || undefined}>
            {displayName.trim().length}/{DISPLAY_NAME_MAX}
          </p>
        </div>

        <div>
          <TextField
            label="Bio"
            value={bio}
            onChange={e => {
              setBio(e.target.value);
              setSaved(false);
            }}
            disabled={saving}
            placeholder="One line about you"
          />
          <p className="counter" data-over={overBio || undefined}>
            {bio.trim().length}/{BIO_MAX}
          </p>
        </div>

        <div>
          <p className="field__label">Links</p>
          {links.map((link, i) => (
            <div className="linkrow" key={i}>
              <TextField
                label=""
                value={link}
                placeholder="https://…"
                disabled={saving}
                onChange={e => {
                  const next = [...links];
                  next[i] = e.target.value;
                  setLinks(next);
                  setSaved(false);
                }}
              />
              <Button
                variant="ghost"
                size="sm"
                disabled={saving}
                aria-label="Remove link"
                onClick={() => {
                  setLinks(links.filter((_, j) => j !== i));
                  setSaved(false);
                }}
              >
                ✕
              </Button>
            </div>
          ))}
          {links.length < MAX_LINKS && (
            <Button
              variant="ghost"
              size="sm"
              disabled={saving}
              onClick={() => setLinks([...links, ''])}
            >
              + Add link
            </Button>
          )}
          {firstLinkError && (
            <p className="alert" role="alert">
              {firstLinkError}
            </p>
          )}
        </div>

        {/* Permanent, and shown rather than hidden — an unchangeable field the artist can
            see is honest; one that is simply missing looks like an oversight. */}
        <div className="pass__specs">
          <div className="spec">
            <span className="spec__label">Username</span>
            <span className="spec__leader" />
            <span className="spec__value">@{profile?.username ?? '—'}</span>
          </div>
        </div>
        <p className="hint">
          Your username is permanent — it can&apos;t be changed once claimed, on web or in the
          app.
        </p>

        {error && (
          <p className="alert" role="alert">
            {error}
          </p>
        )}

        <div className="filerow">
          <Button disabled={!canSave} busy={saving} onClick={onSave}>
            Save changes
          </Button>
          {saved && !saving && <span className="hint">Saved</span>}
        </div>
      </section>

      {cropping && (
        <CoverCropper
          file={cropping}
          title="Crop your photo"
          outputPx={512}
          round
          onCancel={() => setCropping(null)}
          onDone={onPickedAvatar}
        />
      )}
    </div>
  );
}
