-- New music pushes: a friend's new song, and the weekly Fresh on Livil roundup
--
-- Owner decisions 2026-10-14 (ideas 1 and 2 of "get people listening to Livil's own
-- music"; the Home tab they open is ADR-0030). Both ride the scheduled-push machinery of
-- 20261025000000 (ADR-0029): the database decides who gets what and writes the final text,
-- send-push only delivers, ops edits every line and switches each one on or off.
--
-- ── NEW DROP ("Arjun dropped a new song 🎧") ─────────────────────────────────
-- Every 5 minutes push_run_new_drops() announces each upload posted since the switch was
-- turned on (and within the last 2 hours, at least 2 minutes old — a moment to delete a
-- mistaken upload) to the uploader's FRIENDS and the people who STAR them: the audience that
-- chose them, so naming them and their song is what those people asked for. Not blocked
-- either way, New music switch on, a phone registered, and AT MOST ONE new-drop push per
-- person per 24 hours — a second friend's song the same day is left to the tab's dot.
-- Each upload is announced once (push_sends.post_id, unique for this slot).
--
-- Bounded per UPLOADER too: only a post whose track that same person uploaded counts, and
-- at most one announcement per uploader per 24 hours (push_sends.author_id). The posts
-- insert policy checks only author_id, so anyone can write "upload" rows pointing at any
-- visible track with any created_at; without these, one account writing fake uploads could
-- fill every run's 50 places and no real upload would ever be announced (security review).
--
-- ── FRESH ON LIVIL (weekly, Sunday 19:00 IST) ───────────────────────────────
-- push_run_originals() tells everyone with the switch on how many uploads from the last
-- seven days they have not yet seen in their feed (post_impressions, as the repost digest).
-- Like the digest, only friends and starred artists are NAMED; everyone else is counted
-- ("Arjun, Kavya and 3 others", or "5 Livil artists") — a stranger's display name never
-- leads a broadcast. A stranger's upload counts only once its copyright scan came back
-- clean (latest scan complete, no match): this push is Livil promoting a song to people who
-- did not choose its uploader. Video is never scanned, so a stranger's video never counts.
--
-- Taken-down posts are deleted (20260923050000), so neither push can announce one.
--
-- ── SWITCHED OFF ────────────────────────────────────────────────────────────
-- Both slots are created OFF. Turn them on from /studio/ops → Notifications once the app
-- release with the "New music" switch (notification_preferences.new_music) is live — the
-- same App Store 4.5.4 reason the mood slots wait.
--
-- ── PRODUCTION ──────────────────────────────────────────────────────────────
-- Additive. Four CHECK constraints are WIDENED (more values allowed, none removed); every
-- existing row and every existing caller is unaffected. push_run_slot and push_digest_for
-- are untouched; ops_push_test is redefined with its existing branches verbatim plus two
-- new ones. An app that predates the tab opens these pushes on Home (route `App`); one with
-- the tab opens New on Livil (`tab`), counts the tap and keeps one card each.

-- ── 1. The recipient's switch ───────────────────────────────────────────────
-- Also added by 20261026000000 (the app's half); idempotent so either can land first.
alter table public.notification_preferences
  add column if not exists new_music boolean not null default true;

-- ── 2. Widen the CHECKs ─────────────────────────────────────────────────────
alter table public.push_messages drop constraint if exists push_messages_pool_check;
alter table public.push_messages add constraint push_messages_pool_check
  check (pool in ('mood_morning', 'mood_evening', 'digest', 'new_drop', 'originals'));

-- Fill-ins per pool. The digest's three again for the roundup ({names} = artists); a new
-- drop names one person and one song. Any other brace is a typo that would reach phones.
alter table public.push_messages drop constraint if exists push_messages_fill_ins;
-- Title and body each on their own, so a brace split across the two cannot pass.
alter table public.push_messages add constraint push_messages_fill_ins check (
  case
    when pool in ('digest', 'originals')
      then regexp_replace(title, '\{(names|songs|since)\}', '', 'g') !~ '[{}]'
       and regexp_replace(body,  '\{(names|songs|since)\}', '', 'g') !~ '[{}]'
    when pool = 'new_drop'
      then regexp_replace(title, '\{(name|song)\}', '', 'g') !~ '[{}]'
       and regexp_replace(body,  '\{(name|song)\}', '', 'g') !~ '[{}]'
    else title !~ '[{}]' and body !~ '[{}]'
  end
);

alter table public.push_slots drop constraint if exists push_slots_slot_check;
alter table public.push_slots add constraint push_slots_slot_check
  check (slot in ('mood_morning', 'digest_morning', 'digest_evening', 'mood_evening',
                  'new_drop', 'originals_weekly'));
alter table public.push_slots drop constraint if exists push_slots_pool_check;
alter table public.push_slots add constraint push_slots_pool_check
  check (pool in ('mood_morning', 'mood_evening', 'digest', 'new_drop', 'originals'));

alter table public.push_sends drop constraint if exists push_sends_slot_check;
alter table public.push_sends add constraint push_sends_slot_check
  check (slot in ('mood_morning', 'digest_morning', 'digest_evening', 'mood_evening',
                  'new_drop', 'originals_weekly', 'test'));
alter table public.push_sends drop constraint if exists push_sends_kind_check;
alter table public.push_sends add constraint push_sends_kind_check
  check (kind in ('mood_nudge', 'repost_digest', 'new_drop', 'originals_weekly'));

-- Which upload a new-drop send announced. Once per upload, enforced here rather than by a
-- read-then-write in the function, so a retried cron tick cannot announce it twice.
alter table public.push_sends
  add column if not exists post_id uuid references public.posts(id) on delete set null;
create unique index if not exists push_sends_new_drop_once
  on public.push_sends (post_id) where slot = 'new_drop' and post_id is not null;
-- …and whose upload it was, for the one-per-uploader-per-day bound (kept if the post goes).
alter table public.push_sends
  add column if not exists author_id uuid references public.profiles(id) on delete set null;
create index if not exists push_sends_new_drop_author
  on public.push_sends (author_id, created_at) where slot = 'new_drop';

-- ── 3. The two switches ─────────────────────────────────────────────────────
-- new_drop has no time of day (it follows uploads); send_at_ist is required by the table
-- and shown as "when a friend uploads" by the dashboard.
insert into public.push_slots (slot, pool, send_at_ist) values
  ('new_drop',         'new_drop',  '00:00'),
  ('originals_weekly', 'originals', '19:00')
on conflict (slot) do nothing;

-- ── 4. Names and titles, made safe to show ──────────────────────────────────
-- Display name, else @username: control, direction-override and other invisible characters
-- become spaces, runs of spaces collapse, braces become parentheses (a name cannot pose as
-- a fill-in), and at most 30 characters — so " dropped a new song" is always seen.
create or replace function public.push_clean_text(p_text text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select btrim(regexp_replace(regexp_replace(translate(coalesce(p_text, ''), '{}', '()'),
    '[[:cntrl:]' || chr(1564) || chr(4447) || chr(4448) || chr(6158)
      || chr(8203) || '-' || chr(8207) || chr(8232) || '-' || chr(8238)
      || chr(8288) || '-' || chr(8297) || chr(12644) || chr(65279) || chr(65440) || ']+',
    ' ', 'g'), ' {2,}', ' ', 'g'));
$$;

create or replace function public.push_person_name(p_display_name text, p_username text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case when char_length(n) > 30 then left(n, 29) || '…' else n end
    from (select coalesce(nullif(public.push_clean_text(p_display_name), ''),
                          '@' || public.push_clean_text(p_username)) as n) s;
$$;

-- A song title for a notification: cleaned the same way, at most 60 characters.
create or replace function public.push_song_title(p_title text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case when char_length(t) > 60 then left(t, 59) || '…' else t end
    from (select coalesce(nullif(public.push_clean_text(p_title), ''), 'a new song') as t) s;
$$;

create or replace function public.push_render_drop(p_template text, p_name text, p_song text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select replace(replace(p_template, '{name}', coalesce(p_name, '')), '{song}', coalesce(p_song, ''));
$$;

-- ── 5. What one person's weekly roundup says ────────────────────────────────
-- Uploads in [p_since, p_until) by someone else, not blocked either way, not yet seen in
-- the feed, and — unless the viewer knows the uploader — copyright-clean. Named: friends,
-- then starred (most recent first), at most two; the rest counted.
create or replace function public.push_originals_for(
  p_viewer uuid, p_since timestamptz, p_until timestamptz
)
returns table (songs integer, people integer, names text, avatar_url text)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with ups as (
    select u.author_id, u.created_at,
           case when public.are_friends(p_viewer, u.author_id) then 0
                when exists (select 1 from public.follows f
                              where f.follower_id = p_viewer and f.following_id = u.author_id
                                and f.kind = 'star') then 1
                else 2 end as closeness,
           (select s.status = 'complete' and s.match_found = false
              from public.track_copyright_scans s
             where s.track_id = u.track_id
             order by s.created_at desc
             limit 1) as clean
      from public.posts u
      join public.tracks tr on tr.id = u.track_id and tr.uploader_id = u.author_id
     where u.kind = 'upload'
       and u.created_at >= p_since and u.created_at < p_until
       and u.author_id <> p_viewer
       and not public.is_blocked_between(p_viewer, u.author_id)
       and not exists (select 1 from public.post_impressions pi
                        where pi.user_id = p_viewer and pi.post_id = u.id)
  ),
  eligible as (
    select * from ups where closeness < 2 or clean is true
  ),
  who as (
    select e.author_id, min(e.closeness) as closeness, max(e.created_at) as latest
      from eligible e
     group by e.author_id
  ),
  named as (
    select public.push_person_name(p.display_name, p.username) as name,
           p.avatar_url,
           row_number() over (order by w.closeness, w.latest desc, w.author_id) as n
      from who w
      join public.profiles p on p.id = w.author_id
     where w.closeness < 2
  ),
  tally as (
    select (select count(*)::int from who) as total,
           least((select count(*)::int from named), 2) as shown
  )
  select (select count(*)::int from eligible),
         t.total,
         case
           when t.total = 0 then null
           when t.shown = 0 then t.total || case when t.total = 1 then ' Livil artist' else ' Livil artists' end
           else
             (select string_agg(name, case when t.shown = 2 and t.total = 2 then ' and ' else ', ' end
                                order by n)
                from named where n <= t.shown)
             || case when t.total > t.shown
                  then ' and ' || (t.total - t.shown)
                       || case when t.total - t.shown = 1 then ' other' else ' others' end
                  else '' end
         end,
         (select avatar_url from named where n = 1)
    from tally t;
$$;

-- ── 6. Sunday's roundup ─────────────────────────────────────────────────────
create or replace function public.push_run_originals()
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_slot  public.push_slots;
  v_msg   public.push_messages;
  v_send  uuid;
  v_count integer;
begin
  select * into v_slot from public.push_slots where slot = 'originals_weekly' for update;
  if not found or not v_slot.enabled then
    return null;
  end if;

  select * into v_msg
    from public.push_messages m
   where m.pool = 'originals' and m.active
   order by (m.position <= v_slot.last_position), m.position
   limit 1;
  if not found then
    return null;
  end if;

  insert into public.push_sends (slot, kind, message_id)
  values ('originals_weekly', 'originals_weekly', v_msg.id)
  returning id into v_send;

  insert into public.push_deliveries (send_id, recipient_id, title, body, avatar_url)
  select v_send, p.id,
         public.push_render(v_msg.title, o.names, o.songs, 'this week'),
         public.push_render(v_msg.body,  o.names, o.songs, 'this week'),
         o.avatar_url
    from public.profiles p
    cross join lateral public.push_originals_for(p.id, now() - interval '7 days', now()) o
   where exists (select 1 from public.device_tokens t where t.user_id = p.id)
     and coalesce((select np.new_music from public.notification_preferences np
                    where np.user_id = p.id), true)
     and o.songs > 0;

  get diagnostics v_count = row_count;
  update public.push_sends set recipients = v_count where id = v_send;
  update public.push_slots set last_position = v_msg.position where slot = 'originals_weekly';

  if v_count > 0 then
    perform public.push_dispatch(v_send);
  end if;
  return v_send;
end;
$$;

-- ── 7. New drops, every 5 minutes ───────────────────────────────────────────
-- Returns how many uploads it announced (an upload nobody qualifies for still counts as
-- announced — its send row records 0 recipients, and it is not tried again).
create or replace function public.push_run_new_drops()
returns integer
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_slot  public.push_slots;
  v_msg   public.push_messages;
  v_up    record;
  v_send  uuid;
  v_count integer;
  v_done  integer := 0;
  v_name  text;
  v_song  text;
begin
  select * into v_slot from public.push_slots where slot = 'new_drop' for update;
  if not found or not v_slot.enabled then
    return 0;
  end if;

  for v_up in
    select * from (
      select distinct on (u.author_id)
             u.id, u.author_id, u.created_at, t.title, a.display_name, a.username, a.avatar_url
        from public.posts u
        join public.tracks t on t.id = u.track_id and t.uploader_id = u.author_id
        join public.profiles a on a.id = u.author_id
       where u.kind = 'upload'
         and u.created_at < now() - interval '2 minutes'
         and u.created_at > greatest(now() - interval '2 hours', v_slot.updated_at)
         and not exists (select 1 from public.push_sends s
                          where s.slot = 'new_drop' and s.post_id = u.id)
         and not exists (select 1 from public.push_sends s
                          where s.slot = 'new_drop' and s.author_id = u.author_id
                            and s.created_at > now() - interval '24 hours')
       order by u.author_id, u.created_at
    ) one_each
     order by one_each.created_at
     limit 50
  loop
    select * into v_msg
      from public.push_messages m
     where m.pool = 'new_drop' and m.active
     order by (m.position <= v_slot.last_position), m.position
     limit 1;
    if not found then
      return v_done;
    end if;

    v_send := null;  -- RETURNING INTO leaves it untouched on a conflict
    insert into public.push_sends (slot, kind, message_id, post_id, author_id)
    values ('new_drop', 'new_drop', v_msg.id, v_up.id, v_up.author_id)
    on conflict do nothing
    returning id into v_send;
    if v_send is null then
      continue;  -- announced by a concurrent run
    end if;

    v_name := public.push_person_name(v_up.display_name, v_up.username);
    v_song := public.push_song_title(v_up.title);

    insert into public.push_deliveries (send_id, recipient_id, title, body, avatar_url)
    select v_send, r.id,
           public.push_render_drop(v_msg.title, v_name, v_song),
           public.push_render_drop(v_msg.body,  v_name, v_song),
           v_up.avatar_url
      from (
        select case when f.user_a_id = v_up.author_id then f.user_b_id else f.user_a_id end as id
          from public.friendships f
         where f.status = 'accepted'
           and (f.user_a_id = v_up.author_id or f.user_b_id = v_up.author_id)
        union
        select fo.follower_id
          from public.follows fo
         where fo.following_id = v_up.author_id and fo.kind = 'star'
      ) r
     where r.id <> v_up.author_id
       and exists (select 1 from public.device_tokens t where t.user_id = r.id)
       and coalesce((select np.new_music from public.notification_preferences np
                      where np.user_id = r.id), true)
       and not public.is_blocked_between(r.id, v_up.author_id)
       and not exists (
         select 1 from public.push_deliveries d
           join public.push_sends s on s.id = d.send_id
          where d.recipient_id = r.id
            and s.slot = 'new_drop'          -- an operator's preview does not count
            and d.created_at > now() - interval '24 hours');

    get diagnostics v_count = row_count;
    update public.push_sends set recipients = v_count where id = v_send;
    update public.push_slots set last_position = v_msg.position where slot = 'new_drop';
    v_slot.last_position := v_msg.position;
    if v_count > 0 then
      perform public.push_dispatch(v_send);
    end if;
    v_done := v_done + 1;
  end loop;
  return v_done;
end;
$$;

-- ── 8. "Preview on my phone" for the two new pools ──────────────────────────
-- 20261025000000's definition with its two branches unchanged, plus: a new drop previews as
-- the operator's own newest upload (or an example), the roundup as the operator's own week
-- (or an example). Skip rules do not apply, as before.
create or replace function public.ops_push_test(p_message_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_me    uuid := auth.uid();
  v_msg   public.push_messages;
  v_send  uuid;
  v_d     record;
  v_name  text;
  v_song  text;
begin
  if not public.is_ops() or v_me is null then
    return null;
  end if;
  if not exists (select 1 from public.device_tokens t where t.user_id = v_me) then
    return null;
  end if;
  select * into v_msg from public.push_messages where id = p_message_id;
  if not found then
    return null;
  end if;

  insert into public.push_sends (slot, kind, message_id, recipients)
  values ('test',
          case v_msg.pool
            when 'digest'    then 'repost_digest'
            when 'new_drop'  then 'new_drop'
            when 'originals' then 'originals_weekly'
            else 'mood_nudge'
          end,
          v_msg.id, 1)
  returning id into v_send;

  if v_msg.pool = 'digest' then
    select * into v_d from public.push_digest_for(v_me, now() - interval '24 hours', now());
    if coalesce(v_d.songs, 0) = 0 then
      select 18 as songs, 12 as people, 'Arjun, Kavya and 10 others' as names,
             null::text as avatar_url
        into v_d;
    end if;
    insert into public.push_deliveries (send_id, recipient_id, title, body, avatar_url)
    values (v_send, v_me,
            public.push_render(v_msg.title, v_d.names, v_d.songs, 'since last night'),
            public.push_render(v_msg.body,  v_d.names, v_d.songs, 'since last night'),
            v_d.avatar_url);
  elsif v_msg.pool = 'originals' then
    select * into v_d from public.push_originals_for(v_me, now() - interval '7 days', now());
    if coalesce(v_d.songs, 0) = 0 then
      select 5 as songs, 5 as people, 'Arjun, Kavya and 3 others' as names,
             null::text as avatar_url
        into v_d;
    end if;
    insert into public.push_deliveries (send_id, recipient_id, title, body, avatar_url)
    values (v_send, v_me,
            public.push_render(v_msg.title, v_d.names, v_d.songs, 'this week'),
            public.push_render(v_msg.body,  v_d.names, v_d.songs, 'this week'),
            v_d.avatar_url);
  elsif v_msg.pool = 'new_drop' then
    select public.push_person_name(a.display_name, a.username), public.push_song_title(t.title)
      into v_name, v_song
      from public.posts u
      join public.tracks t on t.id = u.track_id
      join public.profiles a on a.id = u.author_id
     where u.author_id = v_me and u.kind = 'upload'
     order by u.created_at desc
     limit 1;
    insert into public.push_deliveries (send_id, recipient_id, title, body)
    values (v_send, v_me,
            public.push_render_drop(v_msg.title, coalesce(v_name, 'Arjun'), coalesce(v_song, 'Midnight Chai')),
            public.push_render_drop(v_msg.body,  coalesce(v_name, 'Arjun'), coalesce(v_song, 'Midnight Chai')));
  else
    insert into public.push_deliveries (send_id, recipient_id, title, body)
    values (v_send, v_me, v_msg.title, v_msg.body);
  end if;

  perform public.push_dispatch(v_send);
  return v_send;
end;
$$;

-- ── 9. Who may call what ────────────────────────────────────────────────────
revoke all on function public.push_run_new_drops() from public;
revoke all on function public.push_run_new_drops() from anon, authenticated;
revoke all on function public.push_run_originals() from public;
revoke all on function public.push_run_originals() from anon, authenticated;
revoke all on function public.push_originals_for(uuid, timestamptz, timestamptz) from public;
revoke all on function public.push_originals_for(uuid, timestamptz, timestamptz) from anon, authenticated;
revoke all on function public.push_clean_text(text) from public;
revoke all on function public.push_clean_text(text) from anon, authenticated;
revoke all on function public.push_person_name(text, text) from public;
revoke all on function public.push_person_name(text, text) from anon, authenticated;
revoke all on function public.push_song_title(text) from public;
revoke all on function public.push_song_title(text) from anon, authenticated;
revoke all on function public.push_render_drop(text, text, text) from public;
revoke all on function public.push_render_drop(text, text, text) from anon, authenticated;
revoke all on function public.ops_push_test(uuid) from public;
revoke execute on function public.ops_push_test(uuid) from anon;
grant execute on function public.ops_push_test(uuid) to authenticated;

-- ── 10. The lines to start with (editable from ops; never overwritten) ──────
insert into public.push_messages (pool, position, title, body) values
  ('new_drop',  1, '{name} dropped a new song 🎧', '“{song}” · be one of the first to listen'),
  ('originals', 1, 'Fresh on Livil this week ✨',   '{songs} from {names} · have a listen'),
  ('originals', 2, 'New music from Livil artists 🎶', '{names} uploaded {songs} this week')
on conflict (pool, position) do nothing;

-- ── 11. The schedule (UTC; Sunday 19:00 IST = Sunday 13:30 UTC) ─────────────
select cron.schedule('push-new-drops',        '*/5 * * * *', $$select public.push_run_new_drops()$$);
select cron.schedule('push-originals-weekly', '30 13 * * 0', $$select public.push_run_originals()$$);

-- ── 12. Self-checks ─────────────────────────────────────────────────────────
do $$
declare
  v_fn text;
begin
  if (select count(*) from cron.job where jobname in ('push-new-drops', 'push-originals-weekly')) <> 2 then
    raise exception 'a new-music cron job is missing';
  end if;
  if exists (select 1 from public.push_slots where slot in ('new_drop', 'originals_weekly') and enabled) then
    raise notice 'a new-music slot is ON — this migration never turns one on; ops did';
  end if;
  foreach v_fn in array array[
    'public.push_run_new_drops()', 'public.push_run_originals()',
    'public.push_originals_for(uuid,timestamptz,timestamptz)'] loop
    if has_function_privilege('anon', v_fn, 'execute')
       or has_function_privilege('authenticated', v_fn, 'execute') then
      raise exception '% is executable by a client role', v_fn;
    end if;
  end loop;
  -- The widened CHECKs replaced the originals (a mis-named DROP would have left the old
  -- list in force beside the new one, and every new-drop insert would fail).
  if (select count(*) from pg_constraint
       where conrelid = 'public.push_sends'::regclass and contype = 'c') <> 2 then
    raise exception 'push_sends should have exactly its slot and kind CHECKs';
  end if;
  if (select count(*) from pg_constraint
       where conrelid = 'public.push_slots'::regclass and contype = 'c') <> 2 then
    raise exception 'push_slots should have exactly its slot and pool CHECKs';
  end if;
end $$;
