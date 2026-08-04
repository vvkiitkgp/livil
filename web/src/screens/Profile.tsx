import { useOutletContext } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { Avatar } from '../components/Avatar';
import type { CreatorProfile } from '../data/creator';

type Ctx = { session: Session; profile: CreatorProfile | null };

/**
 * Profile — read-only for now.
 *
 * Editing writes to `profiles` and uploads to the `avatars` bucket, which is new write
 * surface for the browser client. principal-security has not reviewed that yet (their agent
 * run was interrupted), and the one thing that must not be got wrong is `username`: it is
 * permanent for life via a DB trigger, and the sign-in gate in `auth/session.ts` exists
 * precisely because a half-claimed username is unrecoverable for that user.
 *
 * So this shows the data and states plainly what cannot change, and editing lands once the
 * write surface has been looked at.
 */
export function Profile() {
  const { session, profile } = useOutletContext<Ctx>();
  const name = profile?.displayName || profile?.username || session.user.email || '';

  return (
    <div className="page fade-up">
      <header className="page__head">
        <div>
          <p className="kicker">The guest list</p>
          <h1 className="display page__title">Profile</h1>
        </div>
      </header>

      <section className="panel profile">
        <div className="profile__identity">
          <Avatar url={profile?.avatarUrl ?? null} name={name} size={72} />
          <div>
            <p className="profile__name">{name}</p>
            <p className="hint">@{profile?.username ?? '—'}</p>
          </div>
        </div>

        <div className="pass__specs">
          <div className="spec">
            <span className="spec__label">Username</span>
            <span className="spec__leader" />
            <span className="spec__value">@{profile?.username ?? '—'}</span>
          </div>
          <div className="spec">
            <span className="spec__label">Display name</span>
            <span className="spec__leader" />
            <span className="spec__value">{profile?.displayName || '—'}</span>
          </div>
          <div className="spec">
            <span className="spec__label">Fans</span>
            <span className="spec__leader" />
            <span className="spec__value spec__value--info">{profile?.followers ?? 0}</span>
          </div>
          <div className="spec">
            <span className="spec__label">Following</span>
            <span className="spec__leader" />
            <span className="spec__value">{profile?.following ?? 0}</span>
          </div>
        </div>

        {profile?.bio && <p className="profile__bio">{profile.bio}</p>}

        <p className="hint">
          Your username is permanent — it can&apos;t be changed once claimed. Editing your
          photo, display name, bio and links is coming here; for now the app has it.
        </p>
      </section>
    </div>
  );
}
