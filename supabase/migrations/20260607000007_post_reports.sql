-- Reports against posts (uploads + reposts).
--
-- Mirrors `post_comment_reports` exactly: predefined reason enum, optional
-- details, write-only from the client (RLS allows insert where reporter_id =
-- auth.uid(); no select policy, since users shouldn't see other users'
-- reports). Moderation reads happen via service role / admin tooling later.

create table if not exists public.post_reports (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  reason text not null check (reason in ('spam','harassment','hate','misinformation','other')),
  details text,
  created_at timestamptz not null default now()
);

create index if not exists post_reports_reporter_idx on public.post_reports (reporter_id);
create index if not exists post_reports_post_idx on public.post_reports (post_id);

alter table public.post_reports enable row level security;

drop policy if exists post_reports_insert_self on public.post_reports;
create policy post_reports_insert_self on public.post_reports
  for insert to authenticated with check (reporter_id = auth.uid());
