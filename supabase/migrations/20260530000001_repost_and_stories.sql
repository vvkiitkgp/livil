-- ─────────────────────────────────────────────────────────────────────────────
-- Repost clip range + Stories feature
-- Adds clip columns to posts; creates stories, story_views tables and the
-- list_active_stories() RPC.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Clip range on posts ──────────────────────────────────────────────────────
alter table public.posts
  add column if not exists clip_start_sec numeric(10, 3),
  add column if not exists clip_end_sec   numeric(10, 3);

alter table public.posts
  drop constraint if exists posts_clip_range_check;

alter table public.posts
  add constraint posts_clip_range_check
  check (
    (clip_start_sec is null and clip_end_sec is null)
    or (clip_start_sec is not null and clip_end_sec is not null
        and clip_start_sec >= 0 and clip_end_sec > clip_start_sec)
  );

-- ── Stories (24h ephemeral reposts, clip capped at 10s) ──────────────────────
create table if not exists public.stories (
  id                uuid        primary key default gen_random_uuid(),
  author_id         uuid        not null references public.profiles(id) on delete cascade,
  track_id          uuid        not null references public.tracks(id)   on delete cascade,
  original_post_id  uuid        not null references public.posts(id)    on delete cascade,
  comment           text,
  clip_start_sec    numeric(10, 3) not null,
  clip_end_sec      numeric(10, 3) not null,
  created_at        timestamptz not null default now(),
  expires_at        timestamptz not null default (now() + interval '24 hours'),
  constraint stories_clip_check check (
    clip_start_sec >= 0
    and clip_end_sec > clip_start_sec
    and (clip_end_sec - clip_start_sec) <= 10
  )
);

create index if not exists stories_active_idx
  on public.stories (expires_at desc, author_id);

alter table public.stories enable row level security;

drop policy if exists "stories_select" on public.stories;
create policy "stories_select" on public.stories for select
  using (
    expires_at > now()
    and (
      author_id = auth.uid()
      or exists (
        select 1 from public.friendships f
        where f.status = 'accepted'
          and (
            (f.user_a_id = auth.uid() and f.user_b_id = author_id)
            or (f.user_b_id = auth.uid() and f.user_a_id = author_id)
          )
      )
      or exists (
        select 1 from public.follows fo
        where fo.follower_id = auth.uid()
          and fo.following_id = author_id
          and fo.kind = 'star'
      )
    )
  );

drop policy if exists "stories_insert" on public.stories;
create policy "stories_insert" on public.stories for insert
  with check (author_id = auth.uid());

drop policy if exists "stories_delete" on public.stories;
create policy "stories_delete" on public.stories for delete
  using (author_id = auth.uid());

-- ── Story views (seen/unseen tracking) ───────────────────────────────────────
create table if not exists public.story_views (
  story_id  uuid not null references public.stories(id) on delete cascade,
  viewer_id uuid not null references public.profiles(id) on delete cascade,
  viewed_at timestamptz not null default now(),
  primary key (story_id, viewer_id)
);

alter table public.story_views enable row level security;

drop policy if exists "story_views_select_self" on public.story_views;
create policy "story_views_select_self" on public.story_views for select
  using (viewer_id = auth.uid());

drop policy if exists "story_views_insert_self" on public.story_views;
create policy "story_views_insert_self" on public.story_views for insert
  with check (viewer_id = auth.uid());

-- ── RPC: list active stories visible to the viewer, unseen first ──────────────
create or replace function public.list_active_stories()
returns table (
  story_id         uuid,
  author_id        uuid,
  username         text,
  display_name     text,
  avatar_url       text,
  track_id         uuid,
  track_title      text,
  track_audio_url  text,
  track_video_url  text,
  track_cover_url  text,
  track_media_kind text,
  original_post_id uuid,
  comment          text,
  clip_start_sec   numeric,
  clip_end_sec     numeric,
  created_at       timestamptz,
  expires_at       timestamptz,
  viewed_at        timestamptz
)
language sql stable security invoker
as $$
  select
    s.id             as story_id,
    s.author_id,
    p.username,
    p.display_name,
    p.avatar_url,
    s.track_id,
    t.title          as track_title,
    t.audio_url      as track_audio_url,
    t.video_url      as track_video_url,
    t.cover_art_url  as track_cover_url,
    t.media_kind     as track_media_kind,
    s.original_post_id,
    s.comment,
    s.clip_start_sec,
    s.clip_end_sec,
    s.created_at,
    s.expires_at,
    sv.viewed_at
  from public.stories s
    join public.profiles p on p.id = s.author_id
    join public.tracks   t on t.id = s.track_id
    left join public.story_views sv
      on sv.story_id = s.id and sv.viewer_id = auth.uid()
  where s.expires_at > now()
  order by (sv.viewed_at is null) desc, s.created_at desc;
$$;
