-- Edit Profile feature: links column on profiles + private DOB/phone table.

-- Public-readable column for support / social links (URL strings).
alter table public.profiles
  add column if not exists links text[] not null default '{}';

alter table public.profiles
  add constraint profiles_links_max_10
    check (array_length(links, 1) is null or array_length(links, 1) <= 10);

-- DOB + phone are PII. The existing profiles_select_authenticated policy
-- reads as true (any signed-in user can read every column), so we keep
-- these in their own table with self-only access.
create table if not exists public.profiles_private (
  user_id uuid primary key references auth.users(id) on delete cascade,
  date_of_birth date,
  phone_number text,
  updated_at timestamptz not null default now()
);

alter table public.profiles_private enable row level security;

create policy "profiles_private_select_self"
  on public.profiles_private for select using (user_id = auth.uid());
create policy "profiles_private_insert_self"
  on public.profiles_private for insert with check (user_id = auth.uid());
create policy "profiles_private_update_self"
  on public.profiles_private for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());
