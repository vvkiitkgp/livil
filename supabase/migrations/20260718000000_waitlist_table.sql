-- Waitlist for the public landing page (livil.com). Anonymous visitors submit
-- an email via a direct PostgREST insert (no auth session) from static HTML —
-- no app user/session exists at that point, so this is a standalone table,
-- not tied to auth.users/profiles.

CREATE TABLE IF NOT EXISTS public.waitlist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.waitlist ENABLE ROW LEVEL SECURITY;

-- Anonymous visitors may only insert their own row — no read/update/delete,
-- so the landing page can never enumerate or scrape the list back out.
CREATE POLICY waitlist_insert_anon ON public.waitlist
  FOR INSERT
  TO anon
  WITH CHECK (true);
