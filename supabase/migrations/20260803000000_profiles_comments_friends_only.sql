-- Comment audience preference: everyone (default) or friends only.
--
-- Livil's social model, stated so the schema records it: friendship gates DMs,
-- jams and stories. Likes and comments are open to everyone by default, and a
-- fan can always listen, repost and follow. There is NO blocking — reporting
-- (post_reports / post_comment_reports) is the moderation path. This column is
-- the one audience control a user gets over their own posts.
--
-- Column only. No RLS change here, deliberately:
--
--   ENFORCEMENT IS NOT WIRED UP YET.
--
-- post_comments_insert_self still checks only `author_id = auth.uid()`, so this
-- preference currently records intent and restricts nothing. Making it real means
-- amending that policy to also require, when the post author has opted in, an
-- accepted friendship between the commenter and the post author (or that they ARE
-- the post author). That is an authorization change and needs the RLS tests under
-- supabase/tests/rls/ plus a security review before it ships — which is why it is
-- a separate migration rather than a clause added quietly here.
--
-- Until that lands, do not present this setting to users as protection.
--
-- Writable by its owner under the existing profiles_update_own policy — the same
-- one show_activity relies on. The counter-freeze trigger
-- (20260722160000_counters_are_not_client_writable) freezes only the named counter
-- columns, so it does not apply.
alter table public.profiles
  add column if not exists comments_friends_only boolean not null default false;

comment on column public.profiles.comments_friends_only is
  'When true, the user wants comments on their posts limited to accepted friends. NOT YET ENFORCED — post_comments_insert_self does not read this column. Enforcement requires an RLS amendment plus security review; see the migration header.';
