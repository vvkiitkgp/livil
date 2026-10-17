/**
 * A GIF provider's id as Livil stores it: base-62 ("3o7TKSjRrfIPjeiVyM"). The same pattern
 * is the database check post_comments_gif_id_format and GIF_ID_RE in supabase/functions/gifs;
 * that function's tests assert the three agree.
 */
export const GIF_ID_RE = /^[A-Za-z0-9]{1,64}$/;
