import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { Logo } from './Logo';
import { Avatar } from './Avatar';
import { Button } from './Button';
import { signOut } from '../auth/session';
import { fetchCreatorProfile, type CreatorProfile } from '../data/creator';

/**
 * The persistent chrome: brand mark left, section nav, Upload right, identity menu far right.
 *
 * Upload is the only filled-weight action in the bar because it is the one thing an artist
 * came here to do. Everything else is navigation.
 */
export function AppShell({ session }: { session: Session }) {
  const [profile, setProfile] = useState<CreatorProfile | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    fetchCreatorProfile(session.user.id)
      .then(p => {
        if (!cancelled) setProfile(p);
      })
      .catch(() => {
        /* the shell renders fine without it; the email is the fallback identity */
      });
    return () => {
      cancelled = true;
    };
  }, [session.user.id]);

  // Close on outside click and on Escape — a menu that only closes by re-clicking its
  // trigger is the kind of thing nobody notices until it traps them.
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const name = profile?.displayName || profile?.username || session.user.email || '';

  return (
    <div className="app bg-stage">
      <header className="topbar">
        <div className="topbar__inner">
          <NavLink to="/" className="topbar__brand" aria-label="Livil for Creators">
            <Logo size={72} />
            <span className="topbar__sub">for creators</span>
          </NavLink>

          <nav className="topbar__nav">
            <NavLink to="/" end className="navlink">
              Overview
            </NavLink>
            <NavLink to="/tracks" className="navlink">
              Catalogue
            </NavLink>
          </nav>

          <div className="topbar__right">
            <Button size="sm" onClick={() => navigate('/upload')}>
              Upload
            </Button>

            <div className="menu" ref={menuRef}>
              <button
                type="button"
                className="menu__trigger"
                onClick={() => setMenuOpen(o => !o)}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                aria-label="Account menu"
              >
                <Avatar url={profile?.avatarUrl ?? null} name={name} size={32} />
              </button>

              {menuOpen && (
                <div className="menu__panel" role="menu">
                  <div className="menu__identity">
                    <span className="menu__name">{name}</span>
                    {profile?.username && (
                      <span className="hint">@{profile.username}</span>
                    )}
                  </div>
                  <button
                    type="button"
                    role="menuitem"
                    className="menu__item"
                    onClick={() => {
                      setMenuOpen(false);
                      navigate('/profile');
                    }}
                  >
                    Profile
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="menu__item"
                    onClick={signOut}
                  >
                    Sign out
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      <main className="app__body">
        <Outlet context={{ session, profile }} />
      </main>
    </div>
  );
}
