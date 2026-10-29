-- An upload rings the transcoder's doorbell (20261117000000_transcode_dispatch_on_upload.sql).
--
-- Inserting an upload post asks GitHub to run transcode-media.yml — once, with the
-- Vault token, `ref: main` — at most once a minute: a second upload inside the minute
-- (or a bulk insert) is HELD, and the flush sends it when the minute is up. A repost,
-- a missing or blank secret, send nothing. And the doorbell can never fail the upload.
--
-- Requests are observed through CI's pg_net stand-in (`net.stub_requests`, see the
-- `migrations` job in .github/workflows/ci.yml). Vault has no stand-in there, so this
-- file shims `vault.decrypted_secrets` inside its own transaction.
--
--     psql -v ON_ERROR_STOP=1 -f supabase/tests/rls/transcode-dispatch.test.sql

\set ON_ERROR_STOP on
begin;

create or replace function pg_temp.assert(label text, actual boolean, expected boolean)
returns void language plpgsql as $$
begin
  if actual is distinct from expected then
    raise exception 'FAIL  %  (expected %, got %)', label, expected, actual;
  end if;
  raise notice 'ok    %', label;
end $$;

create or replace function pg_temp.set_user(uid uuid)
returns void language plpgsql as $$
begin
  execute format('create or replace function auth.uid() returns uuid language sql stable as $f$ select %L::uuid $f$', uid);
end $$;

grant usage on schema auth to authenticated;

-- ── Stand-ins ───────────────────────────────────────────────────────────────
-- CI ships the pg_net stub; make sure the table it records into is there.
create schema if not exists net;
create table if not exists net.stub_requests (id bigserial primary key,
  url text, body jsonb, headers jsonb, created_at timestamptz default now());
-- Vault: production's `vault.decrypted_secrets` view, as a plain table.
create schema if not exists vault;
create table if not exists vault.decrypted_secrets (name text, decrypted_secret text);

create or replace function pg_temp.dispatches()
returns bigint language sql as $$
  select count(*) from net.stub_requests
   where url = 'https://api.github.com/repos/vvkiitkgp/livil/actions/workflows/transcode-media.yml/dispatches'
$$;
-- "The minute is up": pretend the last ask was long ago.
create or replace function pg_temp.minute_is_up()
returns void language sql as $$
  update public.transcode_dispatch_state set last_dispatched_at = now() - interval '61 seconds' where id = 1
$$;
create or replace function pg_temp.upload(post_suffix text, track_suffix text)
returns void language plpgsql as $$
begin
  perform pg_temp.set_user('ce000000-0000-0000-0000-0000000000b1');
  set local role authenticated;
  insert into posts (id, author_id, kind, track_id) values
    (('d3000000-0000-0000-0000-0000000000' || post_suffix)::uuid,
     'ce000000-0000-0000-0000-0000000000b1', 'upload',
     ('d1000000-0000-0000-0000-0000000000' || track_suffix)::uuid);
  reset role;
end $$;

-- ── Fixtures ────────────────────────────────────────────────────────────────
--   SAM (…b1) has nine songs (…b1 … …b9); BOB (…b2) reposts one of them.
insert into auth.users (id) values
  ('ce000000-0000-0000-0000-0000000000b1'),
  ('ce000000-0000-0000-0000-0000000000b2')
on conflict do nothing;
insert into profiles (id, username, username_set) values
  ('ce000000-0000-0000-0000-0000000000b1', 'td_sam', true),
  ('ce000000-0000-0000-0000-0000000000b2', 'td_bob', true)
on conflict do nothing;

insert into tracks (id, uploader_id, title, media_kind, audio_url, created_at)
select ('d1000000-0000-0000-0000-0000000000b' || n)::uuid,
       'ce000000-0000-0000-0000-0000000000b1', 'Song ' || n, 'audio',
       'https://x.supabase.co/storage/v1/object/public/tracks-media/ce000000-0000-0000-0000-0000000000b1/d1000000-0000-0000-0000-0000000000b' || n || '/audio.mp3',
       now()
  from generate_series(1, 9) n;

delete from net.stub_requests
 where url = 'https://api.github.com/repos/vvkiitkgp/livil/actions/workflows/transcode-media.yml/dispatches';
update public.transcode_dispatch_state
   set last_dispatched_at = null, pending = false, pending_since = null, dispatches = 0
 where id = 1;

-- ── 1. No secret yet: the upload lands, nobody is called ────────────────────
select pg_temp.upload('b1', 'b1');

select pg_temp.assert('#1 the upload is in',
  exists (select 1 from posts where id = 'd3000000-0000-0000-0000-0000000000b1'), true);
select pg_temp.assert('#2 without the Vault secret nothing is sent and no minute is claimed',
  pg_temp.dispatches() = 0
  and (select last_dispatched_at is null and not pending from transcode_dispatch_state where id = 1), true);

-- ── 2. Secret in place: one upload → one workflow_dispatch, the right shape ─
insert into vault.decrypted_secrets (name, decrypted_secret)
values ('github_transcode_dispatch_token', 'github_pat_TEST');

select pg_temp.upload('b2', 'b2');

select pg_temp.assert('#3 an upload sends exactly one dispatch',
  pg_temp.dispatches() = 1, true);
select pg_temp.assert('#4 …as workflow_dispatch of the default branch',
  (select body = '{"ref":"main"}'::jsonb from net.stub_requests
    where url like '%/transcode-media.yml/dispatches' order by id desc limit 1), true);
select pg_temp.assert('#5 …bearing the Vault token (Actions: write) and GitHub''s API headers',
  (select headers->>'Authorization' = 'Bearer github_pat_TEST'
      and headers->>'Accept' = 'application/vnd.github+json'
      and headers ? 'X-GitHub-Api-Version'
     from net.stub_requests
    where url like '%/transcode-media.yml/dispatches' order by id desc limit 1), true);
select pg_temp.assert('#6 …and the minute is claimed',
  (select last_dispatched_at is not null and not pending and dispatches = 1
     from transcode_dispatch_state where id = 1), true);

-- ── 3. A second upload inside the minute is held, not sent ──────────────────
select pg_temp.upload('b3', 'b3');

select pg_temp.assert('#7 inside the minute: still one dispatch',
  pg_temp.dispatches() = 1, true);
select pg_temp.assert('#8 …and the ask is held for the flush',
  (select pending and pending_since is not null from transcode_dispatch_state where id = 1), true);
select pg_temp.assert('#9 the flush inside the minute keeps holding it',
  public.transcode_dispatch_flush() = 'deferred' and pg_temp.dispatches() = 1, true);

-- ── 4. A repost carries no new media: silent ────────────────────────────────
select pg_temp.set_user('ce000000-0000-0000-0000-0000000000b2');
set local role authenticated;
insert into posts (id, author_id, kind, track_id) values
  ('d3000000-0000-0000-0000-0000000000c1', 'ce000000-0000-0000-0000-0000000000b2', 'repost',
   'd1000000-0000-0000-0000-0000000000b2');
reset role;

select pg_temp.assert('#10 a repost does not ring the doorbell',
  pg_temp.dispatches() = 1, true);

-- ── 5. The minute is up: the flush sends the held ask ───────────────────────
select pg_temp.minute_is_up();

select pg_temp.assert('#11 the flush sends the held ask once the minute is up',
  public.transcode_dispatch_flush() = 'sent' and pg_temp.dispatches() = 2, true);
select pg_temp.assert('#12 …and nothing is held any more',
  (select not pending and pending_since is null and dispatches = 2 from transcode_dispatch_state where id = 1), true);
select pg_temp.assert('#13 an idle flush does nothing',
  public.transcode_dispatch_flush() = 'idle' and pg_temp.dispatches() = 2, true);

-- ── 6. A bulk insert (one statement, three uploads) is one ask ──────────────
select pg_temp.minute_is_up();
select pg_temp.set_user('ce000000-0000-0000-0000-0000000000b1');
set local role authenticated;
insert into posts (id, author_id, kind, track_id) values
  ('d3000000-0000-0000-0000-0000000000b4', 'ce000000-0000-0000-0000-0000000000b1', 'upload', 'd1000000-0000-0000-0000-0000000000b4'),
  ('d3000000-0000-0000-0000-0000000000b5', 'ce000000-0000-0000-0000-0000000000b1', 'upload', 'd1000000-0000-0000-0000-0000000000b5'),
  ('d3000000-0000-0000-0000-0000000000b6', 'ce000000-0000-0000-0000-0000000000b1', 'upload', 'd1000000-0000-0000-0000-0000000000b6');
reset role;

select pg_temp.assert('#14 three uploads in one statement: one dispatch',
  pg_temp.dispatches() = 3, true);
select pg_temp.assert('#15 …the rest held',
  (select pending from transcode_dispatch_state where id = 1), true);

-- ── 7. A blank secret is no secret ──────────────────────────────────────────
update vault.decrypted_secrets set decrypted_secret = '   ' where name = 'github_transcode_dispatch_token';
select pg_temp.minute_is_up();

select pg_temp.assert('#16 a whitespace-only token sends nothing',
  public.transcode_dispatch_flush() = 'no_token' and pg_temp.dispatches() = 3, true);

update vault.decrypted_secrets set decrypted_secret = 'github_pat_TEST' where name = 'github_transcode_dispatch_token';

-- ── 8. The doorbell breaking never fails the upload ─────────────────────────
-- Break pg_net itself: the realistic failure.
alter function net.http_post(text, jsonb, jsonb, jsonb, integer) rename to http_post_broken;
select pg_temp.minute_is_up();
update transcode_dispatch_state set pending = false, pending_since = null where id = 1;

select pg_temp.upload('b7', 'b7');

select pg_temp.assert('#17 the upload still lands when pg_net blows up',
  exists (select 1 from posts where id = 'd3000000-0000-0000-0000-0000000000b7'), true);
select pg_temp.assert('#18 …nothing half-formed was sent',
  pg_temp.dispatches() = 3, true);
select pg_temp.assert('#19 …and the failed claim rolled back, so the next ask is not throttled',
  (select last_dispatched_at <= now() - interval '61 seconds' and dispatches = 3
     from transcode_dispatch_state where id = 1), true);

alter function net.http_post_broken(text, jsonb, jsonb, jsonb, integer) rename to http_post;

-- Break the secret lookup too (undefined column → exception inside the trigger).
alter table vault.decrypted_secrets rename column decrypted_secret to gone;
select pg_temp.upload('b8', 'b8');
select pg_temp.assert('#20 the upload still lands when the Vault lookup blows up',
  exists (select 1 from posts where id = 'd3000000-0000-0000-0000-0000000000b8')
  and pg_temp.dispatches() = 3, true);
alter table vault.decrypted_secrets rename column gone to decrypted_secret;

-- ── 9. Installed the safe way ───────────────────────────────────────────────
select pg_temp.assert('#21 the trigger function is SECURITY DEFINER with a pinned search_path',
  (select p.prosecdef and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'transcode_dispatch_on_upload'), true);
select pg_temp.assert('#22 the trigger fires only for kind = upload (WHEN clause)',
  (select pg_get_triggerdef(t.oid) ilike '%WHEN ((new.kind = ''upload''::text))%'
     from pg_trigger t where t.tgrelid = 'public.posts'::regclass
      and t.tgname = 'trg_posts_transcode_dispatch'), true);

-- The state table is server-only: RLS with no policy shows a client nothing, whatever
-- the harness granted.
select pg_temp.set_user('ce000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select pg_temp.assert('#23 a client sees no state row',
  (select count(*) from transcode_dispatch_state) = 0, true);
reset role;

select pg_temp.assert('#24 the flush is on the schedule, every minute',
  exists (select 1 from cron.job where jobname = 'transcode-dispatch-flush' and schedule = '* * * * *'), true);
select pg_temp.assert('#25 pg_cron''s run log is pruned daily',
  exists (select 1 from cron.job where jobname = 'cron-history-prune'), true);

rollback;
