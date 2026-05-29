-- =============================================================================
-- Mock Chat Data Seed — Livil
-- Creates 12 fake users, friendships, DM conversations, and ~20 msgs each
-- =============================================================================
--
-- STEP 1: Find YOUR user ID
--   Supabase dashboard → Authentication → Users → copy your UUID
--   OR run:  SELECT id, email FROM auth.users;
--
-- STEP 2: Replace 'PASTE_YOUR_USER_ID_HERE' on the next line, then run.
--
-- Safe to re-run: all inserts use ON CONFLICT DO NOTHING or existence checks.
-- To wipe mock data run the cleanup block at the very bottom (commented out).
-- =============================================================================

do $$
declare
  me  uuid := 'PASTE_YOUR_USER_ID_HERE'::uuid;

  -- Fixed UUIDs so the script is idempotent
  u01 uuid := 'cc000000-0000-0000-0000-000000000001'::uuid;
  u02 uuid := 'cc000000-0000-0000-0000-000000000002'::uuid;
  u03 uuid := 'cc000000-0000-0000-0000-000000000003'::uuid;
  u04 uuid := 'cc000000-0000-0000-0000-000000000004'::uuid;
  u05 uuid := 'cc000000-0000-0000-0000-000000000005'::uuid;
  u06 uuid := 'cc000000-0000-0000-0000-000000000006'::uuid;
  u07 uuid := 'cc000000-0000-0000-0000-000000000007'::uuid;
  u08 uuid := 'cc000000-0000-0000-0000-000000000008'::uuid;
  u09 uuid := 'cc000000-0000-0000-0000-000000000009'::uuid;
  u10 uuid := 'cc000000-0000-0000-0000-000000000010'::uuid;
  u11 uuid := 'cc000000-0000-0000-0000-000000000011'::uuid;
  u12 uuid := 'cc000000-0000-0000-0000-000000000012'::uuid;

  c01 uuid := 'dd000000-0000-0000-0000-000000000001'::uuid;
  c02 uuid := 'dd000000-0000-0000-0000-000000000002'::uuid;
  c03 uuid := 'dd000000-0000-0000-0000-000000000003'::uuid;
  c04 uuid := 'dd000000-0000-0000-0000-000000000004'::uuid;
  c05 uuid := 'dd000000-0000-0000-0000-000000000005'::uuid;
  c06 uuid := 'dd000000-0000-0000-0000-000000000006'::uuid;
  c07 uuid := 'dd000000-0000-0000-0000-000000000007'::uuid;
  c08 uuid := 'dd000000-0000-0000-0000-000000000008'::uuid;
  c09 uuid := 'dd000000-0000-0000-0000-000000000009'::uuid;
  c10 uuid := 'dd000000-0000-0000-0000-000000000010'::uuid;
  c11 uuid := 'dd000000-0000-0000-0000-000000000011'::uuid;
  c12 uuid := 'dd000000-0000-0000-0000-000000000012'::uuid;

begin

-- ── 1. Auth users (cannot actually log in — empty password) ──────────────────
insert into auth.users (
  instance_id, id, aud, role, email,
  encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data,
  is_super_admin, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', u01, 'authenticated', 'authenticated', 'mock_alex@livil.test',    '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false, now(), now()),
  ('00000000-0000-0000-0000-000000000000', u02, 'authenticated', 'authenticated', 'mock_maya@livil.test',    '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false, now(), now()),
  ('00000000-0000-0000-0000-000000000000', u03, 'authenticated', 'authenticated', 'mock_jake@livil.test',    '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false, now(), now()),
  ('00000000-0000-0000-0000-000000000000', u04, 'authenticated', 'authenticated', 'mock_sarah@livil.test',   '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false, now(), now()),
  ('00000000-0000-0000-0000-000000000000', u05, 'authenticated', 'authenticated', 'mock_marcus@livil.test',  '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false, now(), now()),
  ('00000000-0000-0000-0000-000000000000', u06, 'authenticated', 'authenticated', 'mock_priya@livil.test',   '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false, now(), now()),
  ('00000000-0000-0000-0000-000000000000', u07, 'authenticated', 'authenticated', 'mock_tyler@livil.test',   '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false, now(), now()),
  ('00000000-0000-0000-0000-000000000000', u08, 'authenticated', 'authenticated', 'mock_emma@livil.test',    '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false, now(), now()),
  ('00000000-0000-0000-0000-000000000000', u09, 'authenticated', 'authenticated', 'mock_liam@livil.test',    '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false, now(), now()),
  ('00000000-0000-0000-0000-000000000000', u10, 'authenticated', 'authenticated', 'mock_zoe@livil.test',     '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false, now(), now()),
  ('00000000-0000-0000-0000-000000000000', u11, 'authenticated', 'authenticated', 'mock_nathan@livil.test',  '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false, now(), now()),
  ('00000000-0000-0000-0000-000000000000', u12, 'authenticated', 'authenticated', 'mock_sofia@livil.test',   '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false, now(), now())
on conflict (id) do nothing;

-- ── 2. Profiles (upsert so trigger-created rows get correct usernames) ────────
insert into profiles (id, username, display_name, last_seen_at, show_activity)
values
  (u01, 'alex_chen',       'Alex Chen',       now() - interval '2 minutes',  true),
  (u02, 'maya_rodriguez',  'Maya Rodriguez',  now() - interval '15 minutes', true),
  (u03, 'jake_wilson',     'Jake Wilson',     now() - interval '1 hour',     true),
  (u04, 'sarah_kim',       'Sarah Kim',       now() - interval '3 hours',    true),
  (u05, 'marcus_thompson', 'Marcus Thompson', now() - interval '30 minutes', true),
  (u06, 'priya_patel',     'Priya Patel',     now() - interval '5 minutes',  true),
  (u07, 'tyler_brooks',    'Tyler Brooks',    now() - interval '2 hours',    false),
  (u08, 'emma_davis',      'Emma Davis',      now() - interval '10 minutes', true),
  (u09, 'liam_obrien',     'Liam O''Brien',   now() - interval '4 hours',    true),
  (u10, 'zoe_williams',    'Zoe Williams',    now() - interval '1 minute',   true),
  (u11, 'nathan_park',     'Nathan Park',     now() - interval '45 minutes', true),
  (u12, 'sofia_martinez',  'Sofia Martinez',  now() - interval '8 minutes',  true)
on conflict (id) do update
  set username     = excluded.username,
      display_name = excluded.display_name,
      last_seen_at = excluded.last_seen_at,
      show_activity = excluded.show_activity;

-- ── 3. Friendships ────────────────────────────────────────────────────────────
insert into friendships (user_a_id, user_b_id, status)
select v.a, v.b, 'accepted'
from (values
  (me,u01),(me,u02),(me,u03),(me,u04),(me,u05),(me,u06),
  (me,u07),(me,u08),(me,u09),(me,u10),(me,u11),(me,u12)
) as v(a,b)
where not exists (
  select 1 from friendships f
  where (f.user_a_id = v.a and f.user_b_id = v.b)
     or (f.user_a_id = v.b and f.user_b_id = v.a)
);

-- ── 4. Conversations ──────────────────────────────────────────────────────────
insert into conversations (id, kind, created_by, last_message_at, last_message_preview, created_at)
values
  (c01,'dm',me, now()-interval '2 minutes',  'That new album is fire 🔥',           now()-interval '7 days'),
  (c02,'dm',me, now()-interval '20 minutes', 'She really snapped on that bridge',   now()-interval '5 days'),
  (c03,'dm',me, now()-interval '1 hour',     'Tomorrowland 2025 lineup dropped!!',  now()-interval '4 days'),
  (c04,'dm',me, now()-interval '3 hours',    'Absolutely breathtaking 😭',          now()-interval '6 days'),
  (c05,'dm',me, now()-interval '35 minutes', 'Miles Davis changed my life fr',      now()-interval '3 days'),
  (c06,'dm',me, now()-interval '10 minutes', 'AR Rahman is a genius honestly',      now()-interval '2 days'),
  (c07,'dm',me, now()-interval '2 hours',    'The Metallica riff is insane 🤘',     now()-interval '5 days'),
  (c08,'dm',me, now()-interval '15 minutes', 'Can''t stop replaying it tbh',        now()-interval '1 day'),
  (c09,'dm',me, now()-interval '4 hours',    'Live version is way better',          now()-interval '4 days'),
  (c10,'dm',me, now()-interval '5 minutes',  'SZA really ate on this one',          now()-interval '2 days'),
  (c11,'dm',me, now()-interval '50 minutes', 'Perfect study playlist btw',          now()-interval '3 days'),
  (c12,'dm',me, now()-interval '12 minutes', 'Bad Bunny concert was insane 🔥',     now()-interval '1 day')
on conflict (id) do nothing;

-- ── 5. Members ────────────────────────────────────────────────────────────────
insert into conversation_members (conversation_id, user_id, role, last_read_at)
values
  (c01,me, 'admin','now'),(c01,u01,'member',now()-interval '3 minutes'),
  (c02,me, 'admin','now'),(c02,u02,'member',now()-interval '25 minutes'),
  (c03,me, 'admin','now'),(c03,u03,'member',now()-interval '1 hour'),
  (c04,me, 'admin','now'),(c04,u04,'member',now()-interval '3 hours'),
  (c05,me, 'admin','now'),(c05,u05,'member',now()-interval '40 minutes'),
  (c06,me, 'admin','now'),(c06,u06,'member',now()-interval '12 minutes'),
  (c07,me, 'admin','now'),(c07,u07,'member',now()-interval '2 hours'),
  (c08,me, 'admin',now()-interval '5 minutes'),(c08,u08,'member',now()-interval '20 minutes'),
  (c09,me, 'admin','now'),(c09,u09,'member',now()-interval '4 hours'),
  (c10,me, 'admin','now'),(c10,u10,'member',now()-interval '8 minutes'),
  (c11,me, 'admin','now'),(c11,u11,'member',now()-interval '55 minutes'),
  (c12,me, 'admin','now'),(c12,u12,'member',now()-interval '15 minutes')
on conflict do nothing;

-- ── 6. Messages ───────────────────────────────────────────────────────────────
-- Each block only inserts if the conversation has no messages yet (idempotent)

-- ── c01 · Alex Chen · Kendrick / GNX ─────────────────────────────────────────
if not exists (select 1 from messages where conversation_id = c01) then
  insert into messages (conversation_id, sender_id, kind, body, created_at) values
    (c01,me,  'text','Bro have you heard GNX yet??',                                         now()-interval '7 days'),
    (c01,u01, 'text','YES. I''ve had it on loop all day',                                    now()-interval '7 days'+interval '3 minutes'),
    (c01,me,  'text','The way he came out of nowhere with it 💀',                            now()-interval '7 days'+interval '6 minutes'),
    (c01,u01, 'text','No rollout, no promo, just dropped. Legend behavior',                  now()-interval '7 days'+interval '10 minutes'),
    (c01,me,  'text','Which track is your favorite so far?',                                 now()-interval '6 days'),
    (c01,u01, 'text','Probably Reincarnated or tv off. You?',                                now()-interval '6 days'+interval '15 minutes'),
    (c01,me,  'text','squabble up goes so hard in the car fr',                               now()-interval '6 days'+interval '20 minutes'),
    (c01,u01, 'text','The SZA collab on luther is so smooth too',                            now()-interval '5 days'),
    (c01,me,  'text','That whole back half of the album is just 🔥🔥🔥',                     now()-interval '5 days'+interval '5 minutes'),
    (c01,u01, 'text','He really said "Imma drop this on Black Friday and disappear again"',  now()-interval '4 days'),
    (c01,me,  'text','LMAOOO exactly 💀',                                                    now()-interval '4 days'+interval '2 minutes'),
    (c01,u01, 'text','Already anticipating the tour announcement',                           now()-interval '3 days'),
    (c01,me,  'text','If he comes to the city I''m getting front row no matter what',        now()-interval '3 days'+interval '10 minutes'),
    (c01,u01, 'text','Same. We should go together honestly',                                 now()-interval '2 days'),
    (c01,me,  'text','Deal. I''ll keep an eye on presales',                                  now()-interval '2 days'+interval '5 minutes'),
    (c01,u01, 'text','Appreciate it 🙌',                                                     now()-interval '1 day'),
    (c01,me,  'text','Been replaying the Compton influences in this one btw',                now()-interval '1 day'+interval '2 hours'),
    (c01,u01, 'text','Yeah you can hear it heavily. The west coast energy is different',     now()-interval '1 day'+interval '3 hours'),
    (c01,me,  'text','No one reps Compton like him. Period.',                                now()-interval '12 hours'),
    (c01,u01, 'text','That new album is fire 🔥',                                            now()-interval '2 minutes');
end if;

-- ── c02 · Maya Rodriguez · Taylor Swift ──────────────────────────────────────
if not exists (select 1 from messages where conversation_id = c02) then
  insert into messages (conversation_id, sender_id, kind, body, created_at) values
    (c02,me,  'text','Did you watch the Eras Tour film?',                                    now()-interval '5 days'),
    (c02,u02, 'text','Three times in theaters 😭 no shame',                                 now()-interval '5 days'+interval '5 minutes'),
    (c02,me,  'text','Which era was the best live?',                                         now()-interval '5 days'+interval '10 minutes'),
    (c02,u02, 'text','Fearless era hits different. The nostalgia is overwhelming',           now()-interval '5 days'+interval '15 minutes'),
    (c02,me,  'text','I feel like Folklore/Evermore section was peak of the show',          now()-interval '4 days'),
    (c02,u02, 'text','YES. august and exile back to back?? I was a mess',                   now()-interval '4 days'+interval '20 minutes'),
    (c02,me,  'text','The production on the Midnights section too 🌙',                      now()-interval '4 days'+interval '45 minutes'),
    (c02,u02, 'text','Anti-Hero lighting was insane. That whole set design',                now()-interval '3 days'),
    (c02,me,  'text','She really said "I will perform 44 songs in 3 hours" 💀',             now()-interval '3 days'+interval '30 minutes'),
    (c02,u02, 'text','No dancer energy anywhere she was just vibing the whole time',        now()-interval '3 days'+interval '35 minutes'),
    (c02,me,  'text','Have you heard her TTPD album?',                                      now()-interval '2 days'),
    (c02,u02, 'text','Fortnight is perfect I don''t make the rules',                        now()-interval '2 days'+interval '10 minutes'),
    (c02,me,  'text','The Post Malone feature actually worked surprisingly well',           now()-interval '2 days'+interval '20 minutes'),
    (c02,u02, 'text','I was skeptical but he delivered honestly',                           now()-interval '1 day'),
    (c02,me,  'text','She always finds the right person for the feature',                   now()-interval '1 day'+interval '1 hour'),
    (c02,u02, 'text','She really snapped on that bridge',                                   now()-interval '20 minutes');
end if;

-- ── c03 · Jake Wilson · EDM / Festivals ──────────────────────────────────────
if not exists (select 1 from messages where conversation_id = c03) then
  insert into messages (conversation_id, sender_id, kind, body, created_at) values
    (c03,u03, 'text','Bro the Tomorrowland lineup just dropped',                             now()-interval '4 days'),
    (c03,me,  'text','No way, who''s headlining??',                                          now()-interval '4 days'+interval '5 minutes'),
    (c03,u03, 'text','Martin Garrix, Hardwell, and a mystery act on closing night',          now()-interval '4 days'+interval '7 minutes'),
    (c03,me,  'text','The mystery act is always the best one. Fingers crossed it''s Prydz', now()-interval '4 days'+interval '15 minutes'),
    (c03,u03, 'text','If it''s Prydz I''m crying on the spot. Holosphere was spiritual',    now()-interval '3 days'),
    (c03,me,  'text','Have you been to TML before?',                                         now()-interval '3 days'+interval '10 minutes'),
    (c03,u03, 'text','Twice. 2022 and 2023. You?',                                           now()-interval '3 days'+interval '20 minutes'),
    (c03,me,  'text','Never been but it''s on my bucket list fr',                           now()-interval '3 days'+interval '25 minutes'),
    (c03,u03, 'text','We should go together. Book early the tickets sell insanely fast',     now()-interval '2 days'),
    (c03,me,  'text','Let''s do it. What stage do you spend most time at?',                 now()-interval '2 days'+interval '30 minutes'),
    (c03,u03, 'text','Freedom stage for mainstage vibes, Freedom 2 for underground techno', now()-interval '2 days'+interval '45 minutes'),
    (c03,me,  'text','Have you heard Anyma''s new live show?',                              now()-interval '1 day'),
    (c03,u03, 'text','The Genesys show at MSG was next level. The visuals alone 🤯',         now()-interval '1 day'+interval '15 minutes'),
    (c03,me,  'text','Afterlife has been on a different level this year',                   now()-interval '1 day'+interval '2 hours'),
    (c03,u03, 'text','Tale Of Us building something very special',                          now()-interval '12 hours'),
    (c03,u03, 'text','Tomorrowland 2025 lineup dropped!!',                                  now()-interval '1 hour');
end if;

-- ── c04 · Sarah Kim · Classical ──────────────────────────────────────────────
if not exists (select 1 from messages where conversation_id = c04) then
  insert into messages (conversation_id, sender_id, kind, body, created_at) values
    (c04,me,  'text','I went to a live orchestra performance last night',                    now()-interval '6 days'),
    (c04,u04, 'text','Oh amazing! What did they play?',                                     now()-interval '6 days'+interval '20 minutes'),
    (c04,me,  'text','Beethoven 9th. First time hearing it live and I was not prepared 😭', now()-interval '6 days'+interval '25 minutes'),
    (c04,u04, 'text','The 4th movement live is a completely different experience',          now()-interval '6 days'+interval '30 minutes'),
    (c04,me,  'text','When the chorus came in I genuinely got chills',                      now()-interval '5 days'),
    (c04,u04, 'text','"Ode to Joy" performed live hits your chest differently. The acoustics!',now()-interval '5 days'+interval '15 minutes'),
    (c04,me,  'text','I get why people dedicate their lives to classical now',               now()-interval '5 days'+interval '40 minutes'),
    (c04,u04, 'text','Have you tried Chopin? His nocturnes are a great next step',          now()-interval '4 days'),
    (c04,me,  'text','I''ve been exploring Nocturne in E-flat major. So calming',          now()-interval '4 days'+interval '1 hour'),
    (c04,u04, 'text','Perfect choice. Ballade No. 1 is more dramatic if you want intensity',now()-interval '3 days'),
    (c04,me,  'text','What about Debussy? Someone recommended Clair de Lune',              now()-interval '3 days'+interval '2 hours'),
    (c04,u04, 'text','Clair de Lune is breathtaking. La Mer is also gorgeous',             now()-interval '2 days'),
    (c04,me,  'text','I feel like I''ve been missing out my whole life 😅',                now()-interval '2 days'+interval '30 minutes'),
    (c04,u04, 'text','It''s never too late! Classical listeners are born at all ages',     now()-interval '1 day'),
    (c04,me,  'text','Is there a good starting point that won''t feel overwhelming?',      now()-interval '1 day'+interval '2 hours'),
    (c04,u04, 'text','Spotify "Classical Essentials" playlist. Perfect entry point',       now()-interval '1 day'+interval '3 hours'),
    (c04,u04, 'text','Absolutely breathtaking 😭',                                          now()-interval '3 hours');
end if;

-- ── c05 · Marcus Thompson · Jazz ─────────────────────────────────────────────
if not exists (select 1 from messages where conversation_id = c05) then
  insert into messages (conversation_id, sender_id, kind, body, created_at) values
    (c05,u05, 'text','Just got back from a jazz club downtown',                              now()-interval '3 days'),
    (c05,me,  'text','No way, which one? How was it?',                                      now()-interval '3 days'+interval '10 minutes'),
    (c05,u05, 'text','Blue Note. Kamasi Washington was playing. Absolutely transcendent',   now()-interval '3 days'+interval '15 minutes'),
    (c05,me,  'text','Kamasi live must be insane. Heaven and Earth is already wild',        now()-interval '3 days'+interval '25 minutes'),
    (c05,u05, 'text','He played 2.5 hours with no setlist. Pure improvisation',             now()-interval '2 days'),
    (c05,me,  'text','That''s the real magic of jazz right there',                         now()-interval '2 days'+interval '20 minutes'),
    (c05,u05, 'text','You should really start with Kind of Blue if you haven''t yet',      now()-interval '2 days'+interval '40 minutes'),
    (c05,me,  'text','Miles Davis right? I keep seeing that recommended everywhere',        now()-interval '2 days'+interval '1 hour'),
    (c05,u05, 'text','It''s the best entry point to jazz. Completely changed my life',     now()-interval '1 day'),
    (c05,me,  'text','Just put it on. So What is incredible 10 seconds in',                now()-interval '1 day'+interval '30 minutes'),
    (c05,u05, 'text','YESS. That opening bass line 😭 Wait until Blue in Green comes on',  now()-interval '1 day'+interval '45 minutes'),
    (c05,me,  'text','After this what should I listen to next?',                            now()-interval '1 day'+interval '2 hours'),
    (c05,u05, 'text','Coltrane A Love Supreme then Herbie Hancock Head Hunters',           now()-interval '1 day'+interval '3 hours'),
    (c05,me,  'text','This is a whole new world I''ve been sleeping on',                   now()-interval '12 hours'),
    (c05,u05, 'text','Miles Davis changed my life fr',                                      now()-interval '35 minutes');
end if;

-- ── c06 · Priya Patel · AR Rahman / World Music ───────────────────────────────
if not exists (select 1 from messages where conversation_id = c06) then
  insert into messages (conversation_id, sender_id, kind, body, created_at) values
    (c06,u06, 'text','Did you listen to the new AR Rahman project??',                       now()-interval '2 days'),
    (c06,me,  'text','Not yet! Which one?',                                                 now()-interval '2 days'+interval '10 minutes'),
    (c06,u06, 'text','The Maa Tujhhe Salaam reimagined project. Absolutely stunning',       now()-interval '2 days'+interval '15 minutes'),
    (c06,me,  'text','AR Rahman is on another level. The man has won Oscars for a reason', now()-interval '2 days'+interval '30 minutes'),
    (c06,u06, 'text','Jai Ho still gives me goosebumps every single time',                 now()-interval '1 day'),
    (c06,me,  'text','Slumdog Millionaire soundtrack was a masterpiece honestly',           now()-interval '1 day'+interval '20 minutes'),
    (c06,u06, 'text','O Saya, Paper Planes, Jai Ho in the same album?? Iconic',            now()-interval '1 day'+interval '45 minutes'),
    (c06,me,  'text','Have you explored Fela Kuti or any Afrobeats?',                       now()-interval '1 day'+interval '2 hours'),
    (c06,u06, 'text','Burna Boy bridges that gap so well. Love his sound',                 now()-interval '20 hours'),
    (c06,me,  'text','Burna Boy and AR Rahman on a collab would be insane tbh',            now()-interval '15 hours'),
    (c06,u06, 'text','Someone manifest this please 🙏🙏🙏',                                now()-interval '10 hours'),
    (c06,me,  'text','The fusion possibilities are endless. Carnatic + Afrobeats??',        now()-interval '8 hours'),
    (c06,u06, 'text','Rahman already does fusion so well with Sufi elements',              now()-interval '5 hours'),
    (c06,me,  'text','Dil Se soundtrack is so underrated for that',                        now()-interval '2 hours'),
    (c06,u06, 'text','AR Rahman is a genius honestly',                                      now()-interval '10 minutes');
end if;

-- ── c07 · Tyler Brooks · Metal ────────────────────────────────────────────────
if not exists (select 1 from messages where conversation_id = c07) then
  insert into messages (conversation_id, sender_id, kind, body, created_at) values
    (c07,me,  'text','Okay I tried listening to some metal like you suggested',             now()-interval '5 days'),
    (c07,u07, 'text','AND?? Don''t leave me in suspense',                                   now()-interval '5 days'+interval '15 minutes'),
    (c07,me,  'text','I started with Enter Sandman and it slapped ngl',                    now()-interval '5 days'+interval '20 minutes'),
    (c07,u07, 'text','THAT''S WHAT I''M TALKING ABOUT. Classic gateway metal 🤘',           now()-interval '5 days'+interval '22 minutes'),
    (c07,me,  'text','The drum intro goes insane. Lars is actually crazy talented',         now()-interval '4 days'),
    (c07,u07, 'text','Master of Puppets next. The riff will change your brain chemistry',  now()-interval '4 days'+interval '30 minutes'),
    (c07,me,  'text','I heard it in Stranger Things and it hit different with context',     now()-interval '4 days'+interval '50 minutes'),
    (c07,u07, 'text','Eddie Munson did the lord''s work. So many people discovered it',    now()-interval '3 days'),
    (c07,me,  'text','What about heavier stuff? I kinda want to go deeper',                now()-interval '3 days'+interval '1 hour'),
    (c07,u07, 'text','Try Tool - Lateralus. Progressive metal and it''s a journey',        now()-interval '3 days'+interval '2 hours'),
    (c07,me,  'text','The time signature stuff in that song is insane. 9/8??',             now()-interval '2 days'),
    (c07,u07, 'text','Fibonacci sequence built into the lyrics and time sig. Pure art',    now()-interval '2 days'+interval '30 minutes'),
    (c07,me,  'text','I would never have guessed math could sound this heavy 😅',          now()-interval '2 days'+interval '1 hour'),
    (c07,u07, 'text','Metal is the most technically complex genre. Unpopular opinion',     now()-interval '1 day'),
    (c07,me,  'text','I''m starting to believe you',                                       now()-interval '1 day'+interval '2 hours'),
    (c07,u07, 'text','The Metallica riff is insane 🤘',                                    now()-interval '2 hours');
end if;

-- ── c08 · Emma Davis · Pop / Sabrina Carpenter ───────────────────────────────
if not exists (select 1 from messages where conversation_id = c08) then
  insert into messages (conversation_id, sender_id, kind, body, created_at) values
    (c08,u08, 'text','Sabrina Carpenter Short n'' Sweet is my album of the year no debate', now()-interval '1 day'),
    (c08,me,  'text','Espresso has been playing everywhere I go 😂',                        now()-interval '1 day'+interval '10 minutes'),
    (c08,u08, 'text','It''s SO catchy. That chorus is built different',                    now()-interval '1 day'+interval '20 minutes'),
    (c08,me,  'text','The whole album is consistent. No skips honestly',                   now()-interval '1 day'+interval '30 minutes'),
    (c08,u08, 'text','Please Please Please is heartbreak at its finest',                   now()-interval '1 day'+interval '1 hour'),
    (c08,me,  'text','She really leveled up with this project',                             now()-interval '1 day'+interval '2 hours'),
    (c08,u08, 'text','The lyricism got so much sharper. Wit mixed with emotion',           now()-interval '23 hours'),
    (c08,me,  'text','Are you going to see her on tour?',                                  now()-interval '20 hours'),
    (c08,u08, 'text','Trying to get tickets. Sold out so fast 😭',                         now()-interval '18 hours'),
    (c08,me,  'text','Check resale closer to the date, prices usually drop',               now()-interval '15 hours'),
    (c08,u08, 'text','Good tip! Also have you heard Chappell Roan?',                       now()-interval '10 hours'),
    (c08,me,  'text','Good Luck Babe is the song of the summer no debate',                 now()-interval '8 hours'),
    (c08,u08, 'text','Her Coachella set went so viral for a reason',                       now()-interval '6 hours'),
    (c08,me,  'text','She came out of nowhere. What a year for pop music',                 now()-interval '3 hours'),
    (c08,u08, 'text','Can''t stop replaying it tbh',                                       now()-interval '15 minutes');
end if;

-- ── c09 · Liam O'Brien · Folk / Indie ────────────────────────────────────────
if not exists (select 1 from messages where conversation_id = c09) then
  insert into messages (conversation_id, sender_id, kind, body, created_at) values
    (c09,me,  'text','Just discovered Phoebe Bridgers and now I''m in my feelings 😭',     now()-interval '4 days'),
    (c09,u09, 'text','Which song got you first?',                                           now()-interval '4 days'+interval '20 minutes'),
    (c09,me,  'text','Motion Sickness. Then I fell into a 3 hour rabbit hole',             now()-interval '4 days'+interval '30 minutes'),
    (c09,u09, 'text','That''s the proper way to discover her. Funeral next then Punisher', now()-interval '3 days'),
    (c09,me,  'text','Savior Complex genuinely made me stop what I was doing',             now()-interval '3 days'+interval '1 hour'),
    (c09,u09, 'text','The way the production strips back and then builds. Stunning',        now()-interval '3 days'+interval '2 hours'),
    (c09,me,  'text','Do you play acoustic yourself? Your profile says guitar',            now()-interval '2 days'),
    (c09,u09, 'text','Been playing 8 years. Started with fingerpicking indie folk stuff',  now()-interval '2 days'+interval '30 minutes'),
    (c09,me,  'text','Any artists you''d recommend who play like that?',                  now()-interval '2 days'+interval '1 hour'),
    (c09,u09, 'text','Bon Iver, Iron & Wine, Sufjan Stevens. The holy trinity of sad indie',now()-interval '1 day'),
    (c09,me,  'text','Skinny Love by Bon Iver just destroyed me. It sounds so raw',       now()-interval '1 day'+interval '2 hours'),
    (c09,u09, 'text','Recorded in a cabin in Wisconsin in winter. The isolation shows',    now()-interval '1 day'+interval '3 hours'),
    (c09,me,  'text','That context makes it hit even harder honestly',                     now()-interval '20 hours'),
    (c09,u09, 'text','Holocene next. Prepare tissues.',                                    now()-interval '12 hours'),
    (c09,me,  'text','I''m not emotionally ready but I''ll do it',                        now()-interval '6 hours'),
    (c09,u09, 'text','Live version is way better',                                          now()-interval '4 hours');
end if;

-- ── c10 · Zoe Williams · R&B / SZA ───────────────────────────────────────────
if not exists (select 1 from messages where conversation_id = c10) then
  insert into messages (conversation_id, sender_id, kind, body, created_at) values
    (c10,u10, 'text','SZA''s SOS is still going strong over a year later. Incredible',     now()-interval '2 days'),
    (c10,me,  'text','Kill Bill alone would make most artists'' careers tbh',              now()-interval '2 days'+interval '10 minutes'),
    (c10,u10, 'text','The range on this album is wild. Ballads, bangers, alt moments',    now()-interval '2 days'+interval '20 minutes'),
    (c10,me,  'text','Good Days is so underrated from that album. So dreamy',             now()-interval '2 days'+interval '40 minutes'),
    (c10,u10, 'text','Yes! People sleep on the softer tracks. Blind is gorgeous too',     now()-interval '1 day'),
    (c10,me,  'text','Have you heard Lana x SZA? Their vocal blend is something else',    now()-interval '1 day'+interval '1 hour'),
    (c10,u10, 'text','SNL performance was iconic. The chemistry was instant',              now()-interval '1 day'+interval '2 hours'),
    (c10,me,  'text','Who else in R&B has you excited right now?',                        now()-interval '1 day'+interval '3 hours'),
    (c10,u10, 'text','Summer Walker, Chloe Bailey, and Ari Lennox are all delivering',    now()-interval '20 hours'),
    (c10,me,  'text','Chloe Bailey is so talented. Her range is insane live',             now()-interval '15 hours'),
    (c10,u10, 'text','Her In Pieces album?? Peak emotional R&B',                          now()-interval '10 hours'),
    (c10,me,  'text','Adding to the list. My R&B playlist has grown so much this year',  now()-interval '5 hours'),
    (c10,u10, 'text','R&B is having a Renaissance right now. Best era since 2000s',       now()-interval '2 hours'),
    (c10,me,  'text','Agree fully. The genre is so alive',                                now()-interval '30 minutes'),
    (c10,u10, 'text','SZA really ate on this one',                                         now()-interval '5 minutes');
end if;

-- ── c11 · Nathan Park · Lo-fi / Chill ────────────────────────────────────────
if not exists (select 1 from messages where conversation_id = c11) then
  insert into messages (conversation_id, sender_id, kind, body, created_at) values
    (c11,u11, 'text','Finished the biggest project of the semester thanks to lo-fi 😭',   now()-interval '3 days'),
    (c11,me,  'text','Lo-fi is genuinely productivity fuel. Which channel?',              now()-interval '3 days'+interval '15 minutes'),
    (c11,u11, 'text','Lofi Girl on YouTube. 24/7 streams are a blessing',                 now()-interval '3 days'+interval '25 minutes'),
    (c11,me,  'text','The rain + jazz piano combo just unlocks focus somehow',            now()-interval '3 days'+interval '40 minutes'),
    (c11,u11, 'text','Science says familiar but unobtrusive audio helps with flow state', now()-interval '2 days'),
    (c11,me,  'text','I believe it. I get so much more done with it on',                  now()-interval '2 days'+interval '30 minutes'),
    (c11,u11, 'text','Have you tried binaural beats? Different but effective',            now()-interval '2 days'+interval '1 hour'),
    (c11,me,  'text','The 40Hz gamma waves one is supposed to be great for focus',        now()-interval '1 day'),
    (c11,u11, 'text','Exactly. I use it before big exams. Feels like cheating lol',       now()-interval '1 day'+interval '1 hour'),
    (c11,me,  'text','Who are your fav lo-fi artists? Not just the streams',              now()-interval '1 day'+interval '2 hours'),
    (c11,u11, 'text','Idealism, LuxuryElite, t e l e p a t h for the vaporwave side',    now()-interval '1 day'+interval '3 hours'),
    (c11,me,  'text','t e l e p a t h is such a vibe. Summer 1991 is perfect',           now()-interval '20 hours'),
    (c11,u11, 'text','Nostalgic for something you never had. The hauntology of it',       now()-interval '10 hours'),
    (c11,me,  'text','That''s exactly the right way to describe it',                      now()-interval '5 hours'),
    (c11,u11, 'text','Perfect study playlist btw',                                         now()-interval '50 minutes');
end if;

-- ── c12 · Sofia Martinez · Bad Bunny / Latin ─────────────────────────────────
if not exists (select 1 from messages where conversation_id = c12) then
  insert into messages (conversation_id, sender_id, kind, body, created_at) values
    (c12,me,  'text','Okay Bad Bunny DeBÍ TiRAR MáS FOToS is insane',                     now()-interval '1 day'),
    (c12,u12, 'text','RIGHT?? He went full Puerto Rican pride and I''m emotional',         now()-interval '1 day'+interval '5 minutes'),
    (c12,me,  'text','EL CLúB is stuck in my head. The beat is so nostalgic',             now()-interval '1 day'+interval '15 minutes'),
    (c12,u12, 'text','He sampled old salsa and bolero and made it feel fresh and current', now()-interval '1 day'+interval '30 minutes'),
    (c12,me,  'text','The whole album feels like a love letter to Puerto Rico',            now()-interval '1 day'+interval '1 hour'),
    (c12,u12, 'text','Exactly his intention. It''s also a call to protect the culture',   now()-interval '23 hours'),
    (c12,me,  'text','WELTITA with Jhayco is beautiful. Those two have chemistry',         now()-interval '20 hours'),
    (c12,u12, 'text','Jhayco has been on a roll. Timelezz was so good',                   now()-interval '18 hours'),
    (c12,me,  'text','Afrodisíaco is still one of my favorite Latin albums ever',         now()-interval '15 hours'),
    (c12,u12, 'text','The R&B + reggaeton fusion? Ahead of its time completely',          now()-interval '12 hours'),
    (c12,me,  'text','What about Karol G? Mañana Será Bonito was huge',                   now()-interval '8 hours'),
    (c12,u12, 'text','She''s transcended reggaeton at this point. Global pop star now',   now()-interval '5 hours'),
    (c12,me,  'text','TQG with SZA proves the genre has no borders anymore',             now()-interval '3 hours'),
    (c12,u12, 'text','Latin music is genuinely running the world right now',             now()-interval '1 hour'),
    (c12,me,  'text','Bad Bunny concert was insane 🔥',                                   now()-interval '12 minutes');
end if;

end;
$$;


-- =============================================================================
-- CLEANUP (commented out — uncomment and run to remove all mock data)
-- =============================================================================
/*
delete from messages           where conversation_id in (select id from conversations where id like 'dd000000%');
delete from conversation_members where conversation_id in (select id from conversations where id like 'dd000000%');
delete from conversations      where id::text like 'dd000000%';
delete from friendships        where user_a_id::text like 'cc000000%' or user_b_id::text like 'cc000000%';
delete from profiles           where id::text like 'cc000000%';
delete from auth.users         where id::text like 'cc000000%';
*/
