-- Switch post_views from once-per-user to per-play-instance.
--
-- The old model used (post_id, user_id) as the primary key, so each user could
-- only ever count as 1 view per post and visibility-based tracking was enough.
-- The new model counts plays: 3 seconds of cumulative actual playback within a
-- play instance = 1 play. Loops, prev-button restarts, and replays each create
-- a new play instance. So a single user can rack up many plays for the same
-- post, and we need multiple rows per (post_id, user_id).
--
-- The existing AFTER-INSERT trigger `trg_post_views_count` already bumps
-- posts.views_count on every insert, so once we allow duplicate (post_id,
-- user_id) rows the per-post count naturally tracks total plays.

alter table public.post_views
  drop constraint if exists post_views_pkey;

alter table public.post_views
  add column if not exists id uuid not null default gen_random_uuid();

alter table public.post_views
  add constraint post_views_pkey primary key (id);

-- `first_viewed_at` is now misleading (multiple rows per user are possible).
-- Rename to `played_at` to match the new semantics.
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='post_views' and column_name='first_viewed_at'
  ) then
    alter table public.post_views rename column first_viewed_at to played_at;
  end if;
end$$;

create index if not exists post_views_post_id_idx on public.post_views (post_id);
create index if not exists post_views_user_id_played_at_idx on public.post_views (user_id, played_at desc);
