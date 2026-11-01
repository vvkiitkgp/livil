-- ============================================================================
-- "Made with Livil" — a label on songs made in the Livil Editor
-- ============================================================================
--
-- WHY THIS EXISTS
--
-- The Editor (Record → Magic Tune → Editor, ADR-0034..0036) posts a finished mix through the
-- ordinary Upload flow. The owner wants those posts to carry a "Made with Livil" pill
-- (2026-10-31), so the track has to remember where it came from.
--
-- WHAT CHANGES
--
-- One column on tracks, NOT NULL DEFAULT false: every existing row reads false, and an
-- insert from any shipped app (which never sends it) gets false. Nothing else changes.
--
-- WHAT IT IS NOT
--
-- A label, never proof. The uploading app sets it (owner-RLS `tracks_update_own`, like
-- title or tags), so an uploader could set it on any of their own songs by hand. That is
-- acceptable for a cosmetic pill; it must never gate rights, ranking or payouts
-- (ADR-0036 decision 1: "a client-set flag is data, never proof").
--
-- COMPATIBILITY
--
-- Add-only. Shipped apps never select or send it. The next app selects it in the feed, so
-- this must be applied BEFORE that app (or a dev build of it) runs against production.
-- Grants: none needed — tracks already grants the roles at table level, which covers a
-- new column.
--
-- Reversible: `alter table public.tracks drop column made_with_livil;` (loses only the
-- labels).

alter table public.tracks
  add column if not exists made_with_livil boolean not null default false;

comment on column public.tracks.made_with_livil is
  'Set by the app when the song was made in the Livil Editor. A display label set by the uploader''s client — never proof (ADR-0036).';
