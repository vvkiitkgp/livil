/**
 * The share function is the only place in this repository that emits raw HTML built
 * from strings a user typed. Everything else renders through React, which escapes for
 * you. So these tests are less about the layout than about two properties that fail
 * silently and expensively:
 *
 *   * user-authored text cannot break out of the markup it sits in, and
 *   * a post that is gone still returns a page rather than an error.
 *
 * The Supabase call is stubbed at `fetch`: the database's own behaviour (a repost
 * returning zero rows) is asserted in supabase/tests/rls/shared-post-public.test.sql,
 * against the real function. Here, zero rows is simply the input.
 */
import handler from '../share';

type Res = {
  headers: Record<string, string>;
  code: number;
  body: string;
  setHeader(k: string, v: string): void;
  status(c: number): Res;
  send(b: string): Res;
};

const POST_ID = '8f14e45f-ceea-4d1a-9c0f-1f2a3b4c5d6e';

const POST = {
  post_id: POST_ID,
  caption: 'made this at 4am',
  created_at: '2026-08-28T04:11:00Z',
  likes_count: 42,
  comments_count: 7,
  clip_start_sec: null,
  clip_end_sec: null,
  author_username: 'riya',
  author_display_name: 'Riya',
  author_avatar_url: 'https://cdn.invalid/a.jpg',
  track_title: 'Neon Rain',
  track_media_kind: 'audio' as const,
  track_audio_url: 'https://cdn.invalid/audio.mp3',
  track_video_url: null,
  track_cover_art_url: 'https://cdn.invalid/cover.jpg',
  track_thumbnail_url: null,
  track_duration_seconds: 214,
};

function mockRes(): Res {
  const r = { headers: {}, code: 0, body: '' } as Res;
  r.setHeader = (k, v) => { r.headers[k] = v; };
  r.status = c => { r.code = c; return r; };
  r.send = b => { r.body = b; return r; };
  return r;
}

async function render(id: string, rows: unknown[] | null): Promise<Res> {
  (globalThis as { fetch?: unknown }).fetch = async () => ({
    ok: rows !== null,
    json: async () => rows ?? [],
  });
  const res = mockRes();
  // The handler's real parameter types come from @vercel/node, which is a web-only
  // devDependency; the cast keeps this test runnable under the root Jest.
  await (handler as unknown as (q: unknown, r: Res) => Promise<void>)(
    { query: { id }, url: `/p/${id}` },
    res,
  );
  return res;
}

beforeAll(() => {
  process.env.SUPABASE_URL = 'https://project.invalid';
  process.env.SUPABASE_ANON_KEY = 'anon-key';
});

describe('share page — a post that exists', () => {
  it('renders the preview tags a chat crawler reads, since it will not run our JS', async () => {
    const res = await render(POST_ID, [POST]);
    expect(res.code).toBe(200);
    expect(res.headers['Content-Type']).toBe('text/html; charset=utf-8');
    expect(res.body).toContain('<meta property="og:title" content="Neon Rain — Riya">');
    expect(res.body).toContain('<meta property="og:image" content="https://cdn.invalid/cover.jpg">');
    expect(res.body).toContain('<meta property="og:audio" content="https://cdn.invalid/audio.mp3">');
    expect(res.body).toContain('content="music.song"');
    expect(res.body).toContain('<meta name="twitter:card" content="summary_large_image">');
  });

  it('does not preload the media — this is the egress budget, not a nicety', async () => {
    // There is no adaptive streaming: every listen is a full progressive download,
    // ~4 MB for a song and ~60 MB for a video. Preloading would bill us for everyone
    // who merely opens the link.
    const res = await render(POST_ID, [POST]);
    expect(res.body).toContain('preload="none"');
    expect(res.body).not.toContain('preload="auto"');
    expect(res.body).not.toContain('autoplay');
  });

  it('offers both ways into the app', async () => {
    const res = await render(POST_ID, [POST]);
    expect(res.body).toContain(`livil://post/${POST_ID}`);
    expect(res.body).toContain('play.google.com/store/apps/details?id=com.livil');
  });

  it('carries a seekable progress control, not just a progress indicator', async () => {
    // Shipped as a bare fill bar: it showed position and could not set it. The padded
    // wrapper is the hit area — a 5px drag target is unusable on a phone.
    const res = await render(POST_ID, [POST]);
    expect(res.body).toContain('role="slider"');
    expect(res.body).toContain('pointerdown');
    expect(res.body).toContain('touch-action:none');
  });

  it('embeds the stored duration, so the bar is seekable before the audio loads', async () => {
    // preload="none" means the browser learns the duration only on first play. Without
    // the stored value the bar would be dead until someone had already pressed play —
    // backwards from how a progress bar is used.
    const res = await render(POST_ID, [POST]);
    expect(res.body).toContain('var DUR=214');
  });

  it('uses the real app icon rather than a stand-in', async () => {
    const res = await render(POST_ID, [POST]);
    expect(res.body).toContain('src="/favicon.svg"');
  });

  it('emits an inline script that actually parses', async () => {
    // A syntax error here renders a page that looks fine and does nothing — no play, no
    // seek, no open-in-app, and no error anyone would see. Worth a real parse.
    const res = await render(POST_ID, [POST]);
    const block = res.body.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/);
    expect(block).not.toBeNull();
    expect(() => new Function(block![1]!)).not.toThrow();
  });

  it('caches at the edge so a viral link does not become a function bill', async () => {
    const res = await render(POST_ID, [POST]);
    expect(res.headers['Cache-Control']).toBe(
      'public, s-maxage=300, stale-while-revalidate=86400',
    );
  });

  it('uses the video poster and og:video for a video post', async () => {
    const res = await render(POST_ID, [{
      ...POST,
      track_media_kind: 'video',
      track_audio_url: null,
      track_video_url: 'https://cdn.invalid/clip.mp4',
      track_thumbnail_url: 'https://cdn.invalid/thumb.jpg',
    }]);
    expect(res.body).toContain('<meta property="og:video" content="https://cdn.invalid/clip.mp4">');
    expect(res.body).toContain('poster="https://cdn.invalid/thumb.jpg"');
  });
});

describe('share page — user-authored text cannot escape its markup', () => {
  const HOSTILE = {
    ...POST,
    track_title: 'Neon <Rain> & "Thunder"',
    author_display_name: '<b>Riya</b>',
    author_username: 'riya',
    caption: '4am </script><img src=x onerror=alert(1)> & \'quoted\'',
  };

  it('escapes a caption that tries to close the script tag', async () => {
    const res = await render(POST_ID, [HOSTILE]);
    expect(res.body).not.toContain('</script><img');
    expect(res.body).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('escapes markup in the title, in the body and in the meta tags', async () => {
    const res = await render(POST_ID, [HOSTILE]);
    expect(res.body).toContain('Neon &lt;Rain&gt; &amp; &quot;Thunder&quot;');
    expect(res.body).not.toContain('<b>Riya</b>');
  });

  it('escapes the document title, whose content is CDATA and therefore an injection point', async () => {
    // This shipped unescaped and the assertion above caught it: `<title>` content is not
    // parsed as markup, so a track title of `</title><script>...` closes the element and
    // the rest executes. Pinned separately, because a whole-body check goes green as soon
    // as any ONE occurrence is escaped.
    const res = await render(POST_ID, [HOSTILE]);
    const title = res.body.match(/<title>([\s\S]*?)<\/title>/);
    expect(title).not.toBeNull();
    expect(title![1]).not.toContain('<');
    expect(title![1]).toContain('&lt;b&gt;Riya&lt;/b&gt;');
  });

  it('leaves no raw < inside the embedded JSON island', async () => {
    // An HTML parser ends a <script> at the literal `</script>` wherever it appears,
    // including inside a JSON string — so `<` is escaped rather than trusted.
    const res = await render(POST_ID, [HOSTILE]);
    const island = res.body.match(
      /<script type="application\/json" id="__LIVIL_POST__">([\s\S]*?)<\/script>/,
    );
    expect(island).not.toBeNull();
    expect(island![1]).not.toContain('<');
    expect(island![1]).toContain('\\u003c');
  });

  it('drops a media URL that is not https rather than emitting it', async () => {
    // A stored URL becomes an attribute, and an attribute is a navigation target.
    const res = await render(POST_ID, [{
      ...POST,
      track_audio_url: 'javascript:alert(1)',
      track_cover_art_url: 'javascript:alert(2)',
    }]);
    expect(res.body).not.toContain('javascript:');
  });
});

describe('share page — a post that is not there', () => {
  it('answers 200 with a real page, because the link is already in someone chat history', async () => {
    const res = await render(POST_ID, []);
    expect(res.code).toBe(200);
    expect(res.body).toContain("This post isn't available");
    expect(res.body).toContain('name="robots" content="noindex"');
  });

  it('never touches the database for an id that cannot be a post', async () => {
    const fetchSpy = jest.fn();
    (globalThis as { fetch?: unknown }).fetch = fetchSpy;
    const res = mockRes();
    await (handler as unknown as (q: unknown, r: Res) => Promise<void>)(
      { query: { id: "'; drop table posts;--" }, url: '/p/x' },
      res,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(res.code).toBe(200);
    expect(res.body).not.toContain('drop table');
  });

  it('degrades to a page, not a stack trace, when Supabase is unreachable', async () => {
    (globalThis as { fetch?: unknown }).fetch = async () => { throw new Error('ECONNREFUSED'); };
    const res = mockRes();
    await (handler as unknown as (q: unknown, r: Res) => Promise<void>)(
      { query: { id: POST_ID }, url: `/p/${POST_ID}` },
      res,
    );
    expect(res.code).toBe(200);
    expect(res.body).toContain("This post isn't available");
    expect(res.body).not.toContain('ECONNREFUSED');
  });
});
