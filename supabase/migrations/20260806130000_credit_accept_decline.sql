-- Accepting a credit.
--
-- `track_collaborators.status` has been 'pending' | 'accepted' | 'declined' since the
-- baseline schema, and nothing has ever written anything but the default. Every credit
-- either client has created — for the whole life of the feature — is pending forever, and
-- both clients render pending exactly like confirmed. This migration makes the status mean
-- something: the tagged artist answers, and the answer is visible.
--
-- The product decision behind it: a pending credit still SHOWS on the track, marked as
-- unconfirmed. Acceptance verifies a credit rather than gating it. Hiding credits until
-- they were answered would have left most tracks looking uncredited, because most people
-- will not answer quickly. A declined credit stops showing, and the uploader is told, so
-- they do not re-add it and wonder.
--
-- ── The security fix that comes with it ────────────────────────────────────────
--
-- `track_collab_update_by_uploader_or_self` allows the tagged user to UPDATE their row.
-- RLS is row-level: Postgres cannot restrict which columns an UPDATE touches. So that
-- policy has always let a tagged user rewrite any column on that row — including promoting
-- their own `role` from 'Backing Vocals' to 'Lead Vocals' on somebody else's track.
--
-- Nothing exploited it because no client ever sent that update. Building accept/decline on
-- top of it would have shipped the hole with a button attached. So the policy narrows to
-- the uploader, and the collaborator's one legitimate write goes through a SECURITY DEFINER
-- function that touches `status` and nothing else. Same posture `activity_notifications`
-- already takes: reads and one constrained update for clients, everything else via RPC.

-- ── Activity types ───────────────────────────────────────────────────────────
-- 'credited'         → to the tagged artist, when a track crediting them is published
-- 'credit_accepted'  → back to the uploader
-- 'credit_declined'  → back to the uploader
alter table public.activity_notifications
  drop constraint if exists activity_notifications_type_check;

alter table public.activity_notifications
  add constraint activity_notifications_type_check check (type in (
    'like','comment','repost','play_milestone',
    'new_fan','friend_accepted','friend_rejected',
    'credited','credit_accepted','credit_declined'
  ));

-- ── Notifying the credited artist ────────────────────────────────────────────
--
-- Fires on the POST insert, not on the credit insert, and that is deliberate.
--
-- Both clients write credits BEFORE the upload post exists (mobile's `createTrack` and the
-- shared `publishTrack` both do, the latter so a failed credit insert rolls the whole
-- publish back). A trigger on `track_collaborators` would therefore never find a post to
-- attach the notification to, and `activity_notifications` hydrates its card through
-- `post_id`. Hanging it off the post means the credits are already there, the post is
-- guaranteed to exist, and neither client can forget to call anything.
--
-- Only 'upload' posts: a repost creates a post row too, and re-notifying every collaborator
-- each time somebody reposts the track would be a notification bug with a wide blast radius.
create or replace function public.tg_notify_track_credits()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.kind <> 'upload' or new.track_id is null then
    return new;
  end if;

  insert into activity_notifications (recipient_id, type, actor_id, post_id, payload, updated_at)
  select
    c.user_id,
    'credited',
    new.author_id,
    new.id,
    jsonb_build_object('role', c.role, 'credit_id', c.id),
    now()
  from track_collaborators c
  where c.track_id = new.track_id
    and c.user_id is not null
    -- Crediting yourself is legitimate; being told about it is noise.
    and c.user_id <> new.author_id;

  return new;
end;
$$;

drop trigger if exists notify_track_credits on public.posts;
create trigger notify_track_credits
  after insert on public.posts
  for each row execute function public.tg_notify_track_credits();

-- ── Answering a credit ───────────────────────────────────────────────────────
--
-- The collaborator's ONLY write to this table. Touches `status`, never `role`, and only on
-- a row that names the caller and has not been answered already — so an accept cannot be
-- flipped later, and a second tap is a no-op rather than a resurrection.
create or replace function public.credit_respond(p_credit_id uuid, p_accept boolean)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_me       uuid := auth.uid();
  v_status   text := case when p_accept then 'accepted' else 'declined' end;
  v_track    uuid;
  v_role     text;
  v_uploader uuid;
  v_post     uuid;
begin
  if v_me is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  update track_collaborators
     set status = v_status
   where id = p_credit_id
     and user_id = v_me
     and status = 'pending'
  returning track_id, role into v_track, v_role;

  -- Not yours, already answered, or gone. Indistinguishable on purpose: telling a caller
  -- which of those it was would confirm the existence of credits on tracks they cannot see.
  if v_track is null then
    return null;
  end if;

  select t.uploader_id into v_uploader from tracks t where t.id = v_track;
  select p.id into v_post
    from posts p
   where p.track_id = v_track and p.kind = 'upload'
   order by p.created_at asc
   limit 1;

  -- Record the answer on the Livil-bot message that asked the question, so the bubble
  -- renders "you accepted this" from its own row. Without it, the message keeps offering
  -- Accept/Decline after a reload — the buttons would be harmless (this function refuses a
  -- second answer) but the UI would be lying about the state.
  update activity_notifications
     set payload = payload || jsonb_build_object('answered', v_status)
   where recipient_id = v_me
     and type = 'credited'
     and payload->>'credit_id' = p_credit_id::text;

  -- Tell the uploader, so a declined credit reads as an answer rather than as a credit
  -- that silently vanished. Mirrors `activity_notify_friend_outcome`.
  if v_uploader is not null and v_uploader <> v_me then
    insert into activity_notifications (recipient_id, type, actor_id, post_id, payload, updated_at)
    values (
      v_uploader,
      case when p_accept then 'credit_accepted' else 'credit_declined' end,
      v_me,
      v_post,
      jsonb_build_object('role', v_role),
      now()
    );
  end if;

  return v_status;
end;
$$;

-- ── The tagged artist's pending list ─────────────────────────────────────────
--
-- Hydrated at read time — title, art and uploader come from the join rather than from a
-- payload written when the credit was created, so a renamed track or a changed avatar is
-- correct here without a backfill. Same reasoning as `activity_list`.
create or replace function public.list_pending_credits()
returns table (
  credit_id        uuid,
  track_id         uuid,
  track_title      text,
  cover_art_url    text,
  role             text,
  created_at       timestamptz,
  uploader_id      uuid,
  uploader_name    text,
  uploader_avatar  text
)
language sql security definer set search_path = public as $$
  select
    c.id, c.track_id, t.title, t.cover_art_url, c.role, c.created_at,
    t.uploader_id, coalesce(p.display_name, p.username), p.avatar_url
  from track_collaborators c
  join tracks t   on t.id = c.track_id
  left join profiles p on p.id = t.uploader_id
  where c.user_id = auth.uid()
    and c.status = 'pending'
  order by c.created_at desc;
$$;

-- ── Narrow the update policy ─────────────────────────────────────────────────
-- The uploader manages the credit list. The collaborator answers through
-- `credit_respond` and has no direct UPDATE at all — see the header.
drop policy if exists "track_collab_update_by_uploader_or_self" on public.track_collaborators;
drop policy if exists "track_collab_update_by_uploader" on public.track_collaborators;
create policy "track_collab_update_by_uploader" on public.track_collaborators
  for update to authenticated
  using (
    exists (select 1 from public.tracks t
            where t.id = track_collaborators.track_id and t.uploader_id = auth.uid())
  )
  with check (
    exists (select 1 from public.tracks t
            where t.id = track_collaborators.track_id and t.uploader_id = auth.uid())
  );

-- ── Grants ───────────────────────────────────────────────────────────────────
revoke all on function public.credit_respond(uuid, boolean) from public, anon;
revoke all on function public.list_pending_credits()        from public, anon;
revoke all on function public.tg_notify_track_credits()     from public, anon;
grant execute on function public.credit_respond(uuid, boolean) to authenticated;
grant execute on function public.list_pending_credits()        to authenticated;

comment on function public.credit_respond(uuid, boolean) is
  'Accept or decline a credit naming you. Writes status only; never role. Returns the new status, or null when the credit is not yours, already answered, or gone.';
comment on function public.list_pending_credits() is
  'Credits naming the caller that are still awaiting an answer, newest first.';
