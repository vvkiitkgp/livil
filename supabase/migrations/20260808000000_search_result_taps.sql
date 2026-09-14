-- ============================================================================
-- search_result_taps — what people actually open from search
-- ============================================================================
--
-- "Most searched" is defined here as WHAT PEOPLE TAPPED, not what they typed. A typed query
-- is a guess in progress: someone typing "gehra" produces "g", "ge", "geh" as they go, most
-- of which mean nothing, and a query that returned nothing at all is indistinguishable from
-- one that found exactly the right song. A tap is the moment the search worked. It is also
-- far less data, and far less sensitive.
--
-- ── What is NOT stored, deliberately ────────────────────────────────────────
--
-- THE QUERY TEXT. It is the difference between "this song gets opened a lot" and "here is a
-- log of what each person was looking for". The second is a behavioural record with no
-- feature asking for it, and the cheapest way to never leak it is to never write it. If a
-- future feature genuinely needs query strings, that is a new column with its own argument,
-- not something to have collected speculatively in the meantime.
--
-- ── What IS stored, and why user_id is here at all ──────────────────────────
--
-- `user_id` is NOT for reporting on people. It exists so that:
--   · the insert can be scoped by RLS (`auth.uid() = user_id`), without which any client
--     could write arbitrary rows and inflate any track's ranking at will;
--   · the aggregate can count DISTINCT PEOPLE. Counting raw rows would let one person
--     tapping a song fifty times outrank a song fifty people opened once, which is the
--     obvious way to game a chart and the least obvious way to notice it has been gamed.
--
-- No client can read the rows. There is no SELECT policy at all — only the aggregate RPC
-- below, which is SECURITY DEFINER and returns totals. So the row-level data is write-only
-- from every client's point of view.
--
-- ── Why a table and not a counter column ────────────────────────────────────
--
-- A `tap_count` integer on `tracks` would be smaller and would also be wrong: it cannot
-- answer "this week", it cannot count distinct people, and it would need the same
-- freeze-the-counter trigger machinery that `posts.views_count` needed after it was found
-- 196 above the real number. Rows are the source; totals are derived on read.

create table if not exists public.search_result_taps (
  id uuid not null primary key default gen_random_uuid(),
  -- Which kind of result was opened. `profile` is included because tapping a person IS a
  -- search result being opened; the product question today is songs and albums, but leaving
  -- people out would make the table describe a subset of the thing it is named after.
  kind text not null,
  -- No FK, and that is deliberate: this is an observation that a tap happened, and it stays
  -- true after the track is deleted. A cascade would quietly rewrite history — last month's
  -- totals would shrink because somebody removed a post this morning.
  entity_id uuid not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint search_result_taps_kind_check check (kind in ('track', 'album', 'profile'))
);

-- The only query this table has: "top N of one kind, since a date". Kind leads because it is
-- always filtered on; created_at follows for the window; entity_id makes the per-entity
-- grouping an index-only scan.
create index if not exists search_result_taps_kind_created_idx
  on public.search_result_taps (kind, created_at desc, entity_id);

-- One person tapping the same result repeatedly is one data point, and this index is what
-- makes `count(distinct user_id)` cheap enough to keep it that way.
create index if not exists search_result_taps_entity_user_idx
  on public.search_result_taps (entity_id, user_id);

alter table public.search_result_taps enable row level security;

-- INSERT ONLY, AND ONLY YOUR OWN. `with check` on auth.uid() is what stops a client from
-- attributing taps to somebody else — which matters precisely because the aggregate counts
-- distinct users, so forged user_ids would be forged votes.
drop policy if exists search_taps_insert_self on public.search_result_taps;
create policy search_taps_insert_self on public.search_result_taps
  for insert to authenticated
  with check (user_id = auth.uid());

-- NO SELECT POLICY, ON PURPOSE. Not an oversight to be "fixed" later: with RLS enabled and
-- no policy, every client read returns nothing, which is the whole privacy design. Reading
-- happens through the aggregate below and nowhere else. If a screen ever needs per-row
-- access, that needs its own argument, not a permissive policy added in passing.

-- NO UPDATE OR DELETE POLICY either. A tap is an event; there is nothing to correct, and an
-- editable analytics row is an analytics row nobody can trust.

comment on table public.search_result_taps is
  'One row per search result opened. Query text is deliberately never stored. No client can '
  'read rows (RLS enabled, no SELECT policy) — totals come from ops_top_search_results().';

-- ── The aggregate ───────────────────────────────────────────────────────────
--
-- Same shape as the other /studio/ops readers: SECURITY DEFINER because it must read past
-- the no-SELECT policy above, gated on is_ops() in the BODY because definer rights bypass
-- RLS, and RETURNING EMPTY rather than raising for a non-ops caller so the dashboard renders
-- without a route guard.
--
-- `search_path = public, pg_temp` with pg_temp LAST — the LIV-16 rule. Without it Postgres
-- searches the session temp schema first for relation names, and a caller can put an empty
-- `search_result_taps` in front of the one this body reads.
create or replace function public.ops_top_search_results(
  p_kind text default 'track',
  p_days integer default 30,
  p_limit integer default 20
)
returns table (
  entity_id uuid,
  title text,
  subtitle text,
  people bigint,
  taps bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_ops() then
    return;
  end if;

  -- Bounded rather than trusted: these arrive from a URL in a dashboard, and an unbounded
  -- limit or a negative window turns a chart into a table scan.
  p_limit := least(greatest(coalesce(p_limit, 20), 1), 100);
  p_days  := least(greatest(coalesce(p_days, 30), 1), 3650);

  return query
  with hits as (
    select t.entity_id,
           count(distinct t.user_id) as people,
           count(*)                  as taps
      from public.search_result_taps t
     where t.kind = p_kind
       and t.created_at >= now() - make_interval(days => p_days)
     group by t.entity_id
  )
  select h.entity_id,
         -- One query for three kinds: the title/subtitle come from whichever table the kind
         -- names. A separate function per kind would triple the is_ops gate and the bounds
         -- checking, which is three places for them to drift apart.
         case p_kind
           when 'track'   then tr.title
           when 'album'   then al.title
           when 'profile' then coalesce(pr.display_name, pr.username)
         end as title,
         case p_kind
           when 'track'   then '@' || tru.username
           when 'album'   then '@' || alu.username
           when 'profile' then '@' || pr.username
         end as subtitle,
         h.people,
         h.taps
    from hits h
    left join public.tracks   tr  on p_kind = 'track'   and tr.id = h.entity_id
    left join public.profiles tru on tru.id = tr.uploader_id
    left join public.albums   al  on p_kind = 'album'   and al.id = h.entity_id
    left join public.profiles alu on alu.id = al.uploader_id
    left join public.profiles pr  on p_kind = 'profile' and pr.id = h.entity_id
    -- Ordered by PEOPLE first: fifty people opening a song once is a stronger signal than
    -- one person opening it fifty times, and putting taps second keeps it as a tiebreak
    -- rather than a lever.
   order by h.people desc, h.taps desc
   limit p_limit;
end;
$$;

-- REVOKE FROM anon EXPLICITLY, not just from PUBLIC. Supabase's default privileges issue a
-- DIRECT execute grant to `anon` on every new function in `public`, and a direct grant is
-- untouched by revoking from the PUBLIC pseudo-role — the trap
-- `20260806040000_revoke_stale_anon_function_grants.sql` was written to clean up after. It
-- caught this migration too: both functions were anon-executable on first apply.
revoke all on function public.ops_top_search_results(text, integer, integer) from public;
revoke execute on function public.ops_top_search_results(text, integer, integer) from anon;
grant execute on function public.ops_top_search_results(text, integer, integer) to authenticated;

comment on function public.ops_top_search_results(text, integer, integer) is
  'Top opened search results by DISTINCT people, for /studio/ops. Ops-only (checked in the '
  'body, since SECURITY DEFINER bypasses RLS); returns empty for everyone else.';

-- ── Feeding the search ranking ──────────────────────────────────────────────
--
-- The ranking that orders search results runs on the client (src/utils/searchRanking.ts),
-- and it cannot read this table — by design, there is no SELECT policy. So it needs an
-- aggregate-only reader: how many distinct PEOPLE opened each of these ids, and nothing else.
--
-- Not ops-gated, unlike the dashboard function above, and the difference is worth stating.
-- This returns a popularity number for content the caller can already see, of the same kind
-- as `posts.views_count`, which every client reads today. It exposes no per-user row, no
-- timestamp and no query. What it must never become is a way to ask "who opened this" — if
-- that is ever wanted it is a different function with a different argument.
--
-- Takes the ids the client already has on screen rather than returning a global chart: the
-- caller is ordering ~40 results it has just fetched, and a top-N list would not tell it
-- about the other 30.
create or replace function public.search_result_popularity(
  p_kind text,
  p_ids uuid[]
)
returns table (entity_id uuid, people bigint)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select t.entity_id, count(distinct t.user_id) as people
    from public.search_result_taps t
   where t.kind = p_kind
     -- Bounded so a caller cannot ask about the whole table in one request.
     and t.entity_id = any(p_ids[1:200])
   group by t.entity_id;
$$;

revoke all on function public.search_result_popularity(text, uuid[]) from public;
-- Same as above: anon holds a direct grant unless it is taken away by name.
revoke execute on function public.search_result_popularity(text, uuid[]) from anon;
grant execute on function public.search_result_popularity(text, uuid[]) to authenticated;

comment on function public.search_result_popularity(text, uuid[]) is
  'Distinct-people counts for a set of ids, so client-side search ranking can weigh what '
  'people actually open. Aggregate only — never exposes who, when, or what was typed.';
