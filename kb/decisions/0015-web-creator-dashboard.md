---
tier: 4
owner: chief-architect
consumers: [ALL]
last_verified: 2026-08-04
verify_every: 9999d
verified_by: manual
visibility: public
supersedes: []
related_adrs: [0004, 0005, 0007, 0012]
---

# ADR-0015 — Ship a browser creator dashboard, not a native desktop app

| | |
|---|---|
| **Status** | **Accepted** |
| **Date** | 2026-08-04 |
| **Domain** | platform (with client, data and security) |
| **Decided by** | human owner, in conversation |

---

## Context

User testing surfaced a workflow the product does not serve. Musicians master on a
desktop; the files that matter — WAV masters, 4K video — live there, not on a phone.
Livil today has exactly one client, and it is the phone. A professional artist's only
route to publishing is to move a large file onto a handset first.

The mobile upload ceiling is `MAX_UPLOAD_BYTES = 500 * 1024 * 1024` in
[`src/services/uploads.ts`](../../src/services/uploads.ts). That constant carries a
comment written well before this decision, recording that resumable upload has no clean
React Native solution — `tus-js-client` buffers the whole file into memory and OOM-crashes
— and that large masters are *"meant for a future web uploader that can do resumable
uploads."* This ADR is that uploader. The constraint was known; what was missing was the
second client.

Facts established by reading the repository, not inferred:

1. **No backend work is implied.** [ADR-0004](0004-supabase-direct-no-api-tier.md) commits
   to clients talking to Supabase directly with no API tier. A second client is a second
   consumer of the same RLS, not a new service.
2. **14 of 22 files in `src/services/` import nothing from React Native.** The 8 that do
   are exactly the platform-boundary ones — uploads, waveform decode, push, Google auth,
   the AsyncStorage message cache, and the two that use the image picker. Portability is
   therefore high, and the coupling is concentrated where it belongs.
3. **Media lives in Supabase Storage, bucket `tracks-media`** — not Cloudflare R2. The
   root `CLAUDE.md` describing R2 as the storage layer is stale.
4. **The apex domain is occupied.** `livil-music.com` is served by GitHub Pages from
   `main/docs` ([operations/deployment.md](../operations/deployment.md)). `docs/` is not
   only marketing: `privacy-policy.html`, `child-safety.html` and `delete-account.html`
   are registered in the Play Console listing, and it already contains both a Play Store
   link and a waitlist capture backed by the `waitlist` table.
5. **Play recording already exists and has been collecting.** `post_views
   (id, post_id, user_id, played_at)` stores one row per play instance with a timestamp
   and a listener id, indexed `(post_id)` and `(user_id, played_at desc)`. Rows are
   written by the `activity_record_play` SECURITY DEFINER RPC under a 1-second per-user
   rate limit; an AFTER-INSERT trigger maintains `posts.views_count` and fires milestone
   notifications. The client threshold is `THRESHOLD_SEC = 3` in
   [`src/utils/playTracker.ts`](../../src/utils/playTracker.ts).

   *An initial assessment in the deciding conversation wrongly concluded that no play
   recording existed and proposed creating a table. That was an error — a grep for
   `view_count` missed the actual column `views_count`. It is recorded here because it
   changed the decision: this ADR creates no analytics table, and the historical data
   the error implied was lost has in fact been accumulating.*
6. **Authentication redirects use the custom scheme `livil://auth`** throughout sign-up,
   password reset, and Google OAuth. No `https` redirect is currently allow-listed.
7. **The Play Store listing is in closed testing.** A bare
   `play.google.com/store/apps/details?id=com.livil` link resolves only for accounts
   already on the tester list. The Download button on the live marketing site therefore
   already dead-ends for the general public.

## Decision

**Build a browser-based creator dashboard — a second client on the same Supabase project,
scoped to publishing.**

1. **Browser, not native.** React + Vite, deployed to Vercel. No Electron, no Tauri.
2. **Creator dashboard, not a second Livil.** No feed, no chat, no jam rooms, no stories.
   **v1 is the uploader**; profile, catalogue management, comments and analytics are
   explicitly deferred.
3. **Sign-in only.** Email/password and Google via a standard `https` redirect. No account
   creation on web, so the permanent-username trigger is unreachable from this client.
   Signed-out visitors get the Download-app button plus the existing `waitlist` insert.
4. **One repository, two dependency trees.** `web/` carries its own `package.json` and its
   own `node_modules` and is **not** an npm workspace. `shared/` holds the database types
   and the portable services. The Supabase client is **injected** into shared services
   rather than imported by them, so [`lib/supabase.ts`](../../lib/supabase.ts) is not
   modified.
5. **Storage stays Supabase; the ceiling moves to 2 GB.** Resumable upload via TUS, which
   Supabase Storage speaks natively.
6. **`livil-music.com` moves to Vercel in full**, marketing page included. The three Play
   Console paths must resolve at their existing URLs across the cutover.
7. **The 3-second play threshold is unchanged.** Analytics will read `post_views` and
   gain a `seconds_listened` column so each query chooses its own bar.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| **Electron or Tauri desktop app** | Buys filesystem access and folder watching, and costs Apple notarization, Windows signing, auto-update infrastructure and two more release pipelines — for a solo maintainer already running an Android release train. Nothing in the actual requirement (large resumable uploads, batch metadata, artwork) needs a native shell; browsers do all of it. |
| **`react-native-web` to reuse the mobile UI** | Would drag Fabric-era dependencies into a browser bundle to avoid rebuilding roughly ten components. The mobile UI is also the wrong UI — a dashboard is not a phone screen. |
| **npm workspaces monorepo** | Hoists `node_modules` to the repo root. The RN half depends on exact-pinned `react-native-video@6.19.2` with a native patch applied on `postinstall` ([ADR-0002](0002-patched-video-library.md)) and on Gradle autolinking resolving paths inside `node_modules`. A hoisting mistake there needs a full native rebuild to even observe. A shared lockfile is not worth that exposure. |
| **Separate repository** | Clean boundaries, but the two clients write to one database. Schema and client would drift across repos, and a migration could ship without the client that depends on it. One repo keeps them in a single commit. |
| **Migrate storage to Cloudflare R2 now** | R2 needs presigned multipart plus a Worker to get resumability. Supabase Storage speaks TUS natively, so the hard requirement is nearly free where the data already is. Bundling a storage migration into a new-client project would risk both. |
| **`studio.livil-music.com` subdomain** | Genuinely lower risk — a DNS record, GitHub Pages untouched. Rejected because the apex is only a simple about page, so the migration cost is small, and holding the apex keeps public track pages available at `livil-music.com/@artist/track` later. Remains the fallback if the cutover proves difficult. |
| **Allow account creation on web** | Would remove a funnel gate on precisely the professional users this targets. Rejected for v1 because signup must replicate the `ChooseUsernameScreen` gate, and username is permanent via a DB trigger — a half-created desktop account is unrecoverable for that user. Recorded as dissent below. |
| **Raise the play threshold to 30 s** | Considered to match streaming convention. Rejected: the threshold governs what is *written*, and those writes feed `posts.views_count`, a counter shown in the UI and wired to milestone notifications. Raising it would stall every artist's counter and put a false cliff in the series on the changeover date. Storing `seconds_listened` and filtering at query time gets the same number without destroying information at write time. |
| **Create a new play-events table** | Proposed and withdrawn — `post_views` already is one (see Context 5). |
| **Keep the 500 MB cap** | Leaves the originating problem unsolved. |
| **5 GB ceiling** | More headroom than the requirement, on billed Micro-tier storage and egress. 2 GB covers an hour-long 24-bit/96 kHz master and is one console setting to raise. |

## Consequences

**Made easy.** Large resumable uploads, batch and folder publishing, and artwork/metadata
editing on a real screen. Waveform peaks can be computed in-browser via Web Audio —
including for **video**, which [ADR-0003](0003-on-device-waveform-decode.md) forbids on
device because decoding a video there exhausts memory and the OS kills the process. The
web client therefore becomes the backfill path for a gap the phone structurally cannot
close.

**Made hard.** A second UI codebase with no shared components: the design system now has
two implementations and can diverge. Vercel becomes a second deployment target and a new
third-party dependency alongside GitHub Pages, Supabase and Firebase.

**Costs accepted.**
- Artists who discover Livil on desktop cannot sign up there. They must install the phone
  app first — a funnel gate on the exact audience this serves.
- The Download button inherits the closed-testing dead-end (Context 7). Until the listing
  opens, the waitlist is the only working path for a non-tester.
- DNS cutover puts three Play Console URLs at risk. Path parity must be verified *before*
  the flip; a 404 on those paths is a policy violation against a live listing.
- Storage policies are not in migrations ([ADR-0007](0007-storage-policies-unversioned.md)),
  so the bucket policy admitting the TUS upload path is a console change, unversioned and
  invisible to review — the same class of risk [ADR-0012](0012-storage-config-ratification-and-modifications.md) ratified.
- The `web/` island means a dependency upgrade must be applied twice.

**Foreclosed.** Nothing native — no filesystem watching, no DAW integration, no offline
drafts — without revisiting decision 1.

**Explicitly NOT addressed.** `post_views` carries
`create policy "post_views_select_authenticated" ... for select to authenticated using (true)`,
never narrowed since the baseline schema. Any authenticated account can read every row,
which is the complete listening history of every user by timestamp. The `anon`-scoping pass
did not cover it because it is granted to `authenticated`. This predates this ADR and is
untouched by it. Analytics needs only author-scoped aggregates, so the eventual fix is an
RPC with direct table reads revoked — a separate decision, deliberately not bundled here.

**Process note.** `web/**` and `shared/**` appear in no tier of
[`.claude/autonomy-config.yml`](../../.claude/autonomy-config.yml), and that file is
`never_agent` — an agent may not widen its own scope. A human must add those paths before
agent-authored code can land in them. The injected-client design in decision 4 exists partly
so that `lib/supabase.ts`, also `never_agent`, is never touched.

## Dissent

**Recorded against decision 3 (sign-in only).** The assistant argued that web signup should
be allowed, on the grounds that the project's stated purpose is to reach professional artists
who work on desktop, and requiring a phone install first gates exactly that audience at the
moment of highest intent. The owner chose sign-in-only for v1, accepting the funnel cost in
exchange for not duplicating the permanent-username gate in a second client. If desktop
sign-ups are later found to be a material acquisition channel, this is the line to revisit
first.

## Revisit when

- The Play Store listing leaves closed testing — the Download button becomes real and the
  waitlist path can retire.
- Desktop visitors are measurably bouncing at the sign-in wall (reopen decision 3).
- An artist has a legitimate file above 2 GB (one console setting plus one constant).
- Feed or chat is requested on web — that reopens decision 2, and would pull the realtime,
  messaging and stories services into `shared/`, which v1 deliberately excludes.
- Storage egress on the Micro tier becomes a material line item — reopens the R2 rejection.
- iOS ships ([ADR-0005](0005-ios-platform-status.md)) — a second store link and a second
  set of redirect URLs.
- The apex cutover proves harder than expected — fall back to `studio.livil-music.com`.

---

> **ADRs are append-only.** Do not edit an accepted ADR to reflect a new decision — write a new
> one and mark this one `Superseded by ADR-NNNN`. The record of what we believed and when is
> the point.
