-- Comment likes + reports + realtime for the post comments feature.
--
-- post_comments already exists in production (with comments_count trigger,
-- cascade FKs, and RLS). This migration adds:
--   * like_count column on post_comments
--   * post_comment_likes table + count trigger
--   * post_comment_reports table (write-only from client)
--   * indexes for the "top sort" query and parent lookup
--   * inclusion in supabase_realtime publication so the sheet sees inserts/updates

alter table public.post_comments
  add column if not exists like_count int not null default 0;

create index if not exists post_comments_top_sort_idx
  on public.post_comments (post_id, parent_comment_id, like_count desc, created_at desc);

create index if not exists post_comments_parent_idx
  on public.post_comments (parent_comment_id);

-- ── post_comment_likes ───────────────────────────────────────────────────────

create table if not exists public.post_comment_likes (
  comment_id uuid not null references public.post_comments(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id)
);

create or replace function public.tg_post_comment_likes_count()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    update public.post_comments
       set like_count = like_count + 1
     where id = new.comment_id;
    return new;
  elsif tg_op = 'DELETE' then
    update public.post_comments
       set like_count = greatest(like_count - 1, 0)
     where id = old.comment_id;
    return old;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_post_comment_likes_count on public.post_comment_likes;
create trigger trg_post_comment_likes_count
  after insert or delete on public.post_comment_likes
  for each row execute function public.tg_post_comment_likes_count();

alter table public.post_comment_likes enable row level security;

drop policy if exists post_comment_likes_select on public.post_comment_likes;
create policy post_comment_likes_select on public.post_comment_likes
  for select to authenticated using (true);

drop policy if exists post_comment_likes_insert_self on public.post_comment_likes;
create policy post_comment_likes_insert_self on public.post_comment_likes
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists post_comment_likes_delete_self on public.post_comment_likes;
create policy post_comment_likes_delete_self on public.post_comment_likes
  for delete to authenticated using (user_id = auth.uid());

-- ── post_comment_reports ────────────────────────────────────────────────────
-- Write-only from the client (no select policy) — moderation reads happen via
-- service role or future admin tooling. reporter_id always = auth.uid().

create table if not exists public.post_comment_reports (
  id uuid primary key default gen_random_uuid(),
  comment_id uuid not null references public.post_comments(id) on delete cascade,
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  reason text not null check (reason in ('spam','harassment','hate','misinformation','other')),
  details text,
  created_at timestamptz not null default now()
);

create index if not exists post_comment_reports_reporter_idx
  on public.post_comment_reports (reporter_id);

alter table public.post_comment_reports enable row level security;

drop policy if exists post_comment_reports_insert_self on public.post_comment_reports;
create policy post_comment_reports_insert_self on public.post_comment_reports
  for insert to authenticated with check (reporter_id = auth.uid());

-- ── realtime publication ────────────────────────────────────────────────────
-- Both tables are added so the CommentsSheet can subscribe to INSERT/DELETE on
-- post_comments and UPDATE on post_comments (for live like_count changes).

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and tablename = 'post_comments'
  ) then
    alter publication supabase_realtime add table public.post_comments;
  end if;
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and tablename = 'post_comment_likes'
  ) then
    alter publication supabase_realtime add table public.post_comment_likes;
  end if;
end$$;

alter table public.post_comments replica identity full;
alter table public.post_comment_likes replica identity full;
