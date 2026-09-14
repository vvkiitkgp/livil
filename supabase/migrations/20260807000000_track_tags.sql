-- ============================================================================
-- tracks.tags — the artist's own words, made searchable
-- ============================================================================
--
-- Until now a track could only be found by its title or its description, and both are prose:
-- `searchPosts` matches them with ILIKE '%q%', so searching "lofi" finds a track whose
-- description happens to contain the substring and misses the one the artist would describe
-- as lofi if anyone had asked. Tags are the asking.
--
-- ── A COLUMN, not a join table ───────────────────────────────────────────────
--
-- `text[]` on the row, indexed GIN, the same posture `waveform_peaks` and `lyrics` take:
-- small data the reader always wants alongside the track it belongs to. A `track_tags` table
-- with a `tags` directory was the alternative, and it buys two things we do not need yet —
-- usage counts for a trending view, and rename/merge — at a real cost:
--
--   · a second INSERT inside `publishTrack`'s rollback window, which is the choreography
--     most likely to be got wrong later (see the credits ordering comment there),
--   · two more RLS policies on a table whose only reader is a search query,
--   · a counter trigger, which is the class of thing that drifts silently.
--
-- Containment (`tags && array['lofi']`) is the only query the product has. GIN answers it
-- directly. Revisit when trending tags or tag renaming is actually being built — moving
-- `text[]` into a join table later is a mechanical migration, and the reverse is not.
--
-- ── What the constraint enforces, and what it deliberately does not ──────────
--
-- Normalization lives in `shared/constants/tags.ts`, which both clients call. This constraint
-- is the BACKSTOP and is deliberately looser than that module: it enforces only what search
-- correctness depends on — lowercase, no whitespace, no '#', bounded, no duplicates — and
-- lets any character through otherwise.
--
-- That asymmetry is the point. A constraint stricter than the client rejects the INSERT after
-- a multi-hundred-megabyte master has already uploaded, and the artist discovers their tag
-- was unacceptable by watching the whole publish roll back. Anything this permits but the
-- normalizer would not produce is a cosmetic difference in one row; anything this forbids
-- that the normalizer emits is a failed upload. So the strictness lives where the failure is
-- cheap.
--
-- Specifically NOT constrained: which characters a tag is made of. The client normalizer
-- allows Unicode letters and digits, because Livil's first audience is in India and a rule
-- of `[a-z0-9]` would silently delete every Devanagari or Tamil or Japanese tag at upload.
-- Encoding that here as `[[:alnum:]]` would make the answer depend on the database's
-- collation, which is not somewhere a publish should be able to fail.
--
-- ── Visibility ───────────────────────────────────────────────────────────────
--
-- NOT RENDERED TO LISTENERS. Tags are an input to search and, later, to suggestions — they
-- are not a badge on the track, and no consumption surface shows them. The only screens that
-- display them are the ones that MANAGE them: the two upload screens and the dashboard's
-- track page, where the artist has to see a tag to remove it. Worth stating in the schema
-- because "readable by everyone signed in" and "shown to everyone" are different claims, and
-- the first is true here while the second is not.
--
-- PUBLIC, by inheritance and on purpose. No new policy: `tracks_select_authenticated` is
-- `using (true)`, so tags are readable by every signed-in user — which is what "searchable"
-- means. Writes are already covered: `tracks_insert_own` and `tracks_update_own` scope both
-- to the uploader, and there is no column-level exception to make here because the column
-- carries no privileged data. An empty list is stored as NULL, never as `'{}'`, so "no tags"
-- has exactly one representation for every query that follows.

-- ── The rules, as a function ─────────────────────────────────────────────────
--
-- A CHECK expression cannot contain a subquery, and both the per-element rules and the
-- duplicate check need `unnest`. An IMMUTABLE function is the supported way to express that.
--
-- The known caveat: Postgres does not re-validate existing rows when the function changes.
-- Any future edit that tightens a rule must therefore come with its own validation pass
-- (`alter table ... validate constraint` after a NOT VALID re-add), or it is a rule that is
-- true only of rows written after the deploy.
create or replace function public.track_tags_ok(tags text[])
returns boolean
language sql
immutable
parallel safe
set search_path = pg_catalog
as $$
  select
    tags is null
    or (
      -- 1..20, so "no tags" is NULL and never an empty array. Twenty rather than ten
      -- because every upload starts with the ten `EMOTION_TAGS` already applied, and an
      -- artist who prunes those to two still needs room for genre, language and scene.
      cardinality(tags) between 1 and 20
      -- A NULL element is not a tag and would make every containment query subtly wrong.
      and array_position(tags, null) is null
      and coalesce(
        (
          select bool_and(
            char_length(t) between 2 and 30
            -- Lowercase is what makes search case-insensitive without a functional index:
            -- the writer lowercases, so the reader can compare exactly.
            and t = lower(t)
            -- No whitespace and no '#'. Both would mean the stored tag is not the tag the
            -- search box constructs from the same typed text.
            and t !~ '[[:space:]#]'
          )
          from unnest(tags) as t
        ),
        true
      )
      -- One tag twice is not a stronger tag; it is a row that renders a duplicate chip.
      and cardinality(tags) = (select count(distinct t) from unnest(tags) as t)
    );
$$;

comment on function public.track_tags_ok(text[]) is
  'Backstop validation for tracks.tags. Deliberately looser than shared/constants/tags.ts — '
  'see the migration header: a constraint stricter than the client fails a publish only '
  'after the media has uploaded.';

alter table public.tracks
  add column if not exists tags text[];

alter table public.tracks
  drop constraint if exists tracks_tags_valid;

alter table public.tracks
  add constraint tracks_tags_valid check (public.track_tags_ok(tags));

-- GIN, because the only query is containment: `tags && array['lofi']`. A btree on a text[]
-- would index the whole array as one value and answer nothing the product asks.
create index if not exists tracks_tags_gin on public.tracks using gin (tags);

comment on column public.tracks.tags is
  'Lowercase, whitespace-free tags, 1..20 per track, NULL when there are none. Normalized by '
  'shared/constants/tags.ts on both clients; searched by containment via searchPosts. Never '
  'rendered to listeners — an input to search and suggestions, not a badge. Public: inherits '
  'tracks_select_authenticated.';
