/**
 * The profile-link page (`livil-music.com/@<username>`).
 *
 * The page renders user-authored display names into raw HTML and is read by chat
 * crawlers and search engines, so the properties pinned here are the ones that fail
 * silently:
 *
 *   * a display name cannot break out of the markup (or the JSON-LD block) it sits in;
 *   * the page shows WHO the link is and nothing else — the owner's rule is that the
 *     profile itself is only ever seen in the app;
 *   * listeners are `noindex`, artists are indexable;
 *   * a missing profile is a real 404 and an outage is a 503, so a search engine drops
 *     the first and retries the second instead of de-listing an artist during an outage.
 *
 * The database's own behaviour (who gets a card at all) is asserted against the real
 * function in supabase/tests/rls/public-profile.test.sql. Here the rows are the input.
 */
import handler from '../profile';

type Res = {
  headers: Record<string, string>;
  code: number;
  body: string;
  setHeader(k: string, v: string): void;
  status(c: number): Res;
  send(b: string): Res;
};

const ARTIST = {
  username: 'riya',
  display_name: 'Riya',
  avatar_url: 'https://cdn.invalid/riya.jpg',
  is_artist: true,
};

const LISTENER = {
  username: 'sam_k',
  display_name: null,
  avatar_url: null,
  is_artist: false,
};

function mockRes(): Res {
  const r = { headers: {}, code: 0, body: '' } as Res;
  r.setHeader = (k, v) => { r.headers[k] = v; };
  r.status = c => { r.code = c; return r; };
  r.send = b => { r.body = b; return r; };
  return r;
}

let lastRequestBody: string | null = null;

function stubFetch(rows: unknown[] | null) {
  (globalThis as { fetch?: unknown }).fetch = async (_url: string, init?: { body?: string }) => {
    lastRequestBody = init?.body ?? null;
    return {
      ok: rows !== null,
      status: rows !== null ? 200 : 500,
      statusText: '',
      json: async () => rows ?? [],
    };
  };
}

async function render(u: string, rows: unknown[] | null): Promise<Res> {
  stubFetch(rows);
  const res = mockRes();
  await (handler as unknown as (q: unknown, r: Res) => Promise<void>)(
    { query: { u }, url: `/@${u}` },
    res,
  );
  return res;
}

beforeAll(() => {
  process.env.SUPABASE_URL = 'https://project.invalid';
  process.env.SUPABASE_ANON_KEY = 'anon-key';
});

beforeEach(() => { lastRequestBody = null; });

describe('profile page — an artist', () => {
  it('renders the preview tags a chat crawler reads, since it will not run our JS', async () => {
    const res = await render('riya', [ARTIST]);
    expect(res.code).toBe(200);
    expect(res.headers['Content-Type']).toBe('text/html; charset=utf-8');
    expect(res.body).toContain('<meta property="og:title" content="Riya (@riya) on Livil">');
    expect(res.body).toContain('<meta property="og:description" content="Follow me on Livil">');
    expect(res.body).toContain('<meta property="og:image" content="https://livil-music.com/og-follow.png">');
    expect(res.body).toContain('<meta name="twitter:card" content="summary_large_image">');
  });

  it('gives search engines one canonical URL and a name to rank for', async () => {
    const res = await render('riya', [ARTIST]);
    expect(res.body).toContain('<link rel="canonical" href="https://livil-music.com/@riya">');
    expect(res.body).toContain('<title>Riya (@riya) on Livil</title>');
    expect(res.body).toMatch(/<meta name="description" content="Listen to Riya on Livil/);
    expect(res.body).not.toContain('noindex');
  });

  it('carries ProfilePage structured data that parses', async () => {
    const res = await render('riya', [ARTIST]);
    const block = res.body.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    expect(block).not.toBeNull();
    const data = JSON.parse(block![1]!);
    expect(data['@type']).toBe('ProfilePage');
    expect(data.mainEntity).toMatchObject({
      '@type': 'Person',
      name: 'Riya',
      alternateName: '@riya',
      image: 'https://cdn.invalid/riya.jpg',
    });
  });

  it('shows who the link is and sends people to the app — nothing more', async () => {
    const res = await render('riya', [ARTIST]);
    expect(res.body).toContain('<h1 class="name">Riya</h1>');
    expect(res.body).toContain('<p class="handle">@riya</p>');
    expect(res.body).toContain('livil://profile/riya');
    expect(res.body).toContain('play.google.com/store/apps/details?id=com.livil');
    expect(res.body).toContain('apps.apple.com/app/id6809119164');
    // A signpost, not a player: nothing to play, nothing to egress.
    expect(res.body).not.toContain('<audio');
    expect(res.body).not.toContain('<video');
  });

  it('passes the URL to the app when Safari\'s banner opens it', async () => {
    const res = await render('riya', [ARTIST]);
    expect(res.body).toContain(
      '<meta name="apple-itunes-app" content="app-id=6809119164, app-argument=https://livil-music.com/@riya">',
    );
  });

  it('caches at the edge', async () => {
    const res = await render('riya', [ARTIST]);
    expect(res.headers['Cache-Control']).toBe('public, s-maxage=300, stale-while-revalidate=86400');
  });

  it('emits an inline script that actually parses', async () => {
    const res = await render('riya', [ARTIST]);
    const block = res.body.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/);
    expect(block).not.toBeNull();
    // Compiles without running. See the same test in share.test.ts.
    // eslint-disable-next-line no-new-func
    expect(() => new Function(block![1]!)).not.toThrow();
  });
});

describe('profile page — a listener', () => {
  it('works for sharing but is kept out of search results', async () => {
    const res = await render('sam_k', [LISTENER]);
    expect(res.code).toBe(200);
    expect(res.body).toContain('<meta name="robots" content="noindex">');
    expect(res.body).toContain('<meta property="og:title" content="@sam_k on Livil">');
  });

  it('falls back to the handle and an initial when there is no name or photo', async () => {
    const res = await render('sam_k', [LISTENER]);
    expect(res.body).toContain('<h1 class="name">sam_k</h1>');
    expect(res.body).not.toContain('class="handle"');
    expect(res.body).toContain('avatar--initial');
  });
});

describe('profile page — hostile input', () => {
  it('escapes a display name everywhere it lands', async () => {
    const evil = {
      ...ARTIST,
      display_name: '</title><script>alert(1)</script>"><img src=x onerror=alert(2)>',
    };
    const res = await render('riya', [evil]);
    expect(res.body).not.toContain('<script>alert(1)</script>');
    expect(res.body).not.toContain('<img src=x');
    // The JSON-LD block is a script element: a raw `</script>` inside it would end it.
    const ld = res.body.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    expect(ld![1]).not.toContain('</');
    expect(JSON.parse(ld![1]!).mainEntity.name).toBe(evil.display_name);
  });

  it('never emits a non-https avatar URL', async () => {
    const res = await render('riya', [{ ...ARTIST, avatar_url: 'javascript:alert(1)' }]);
    expect(res.body).not.toContain('javascript:');
    expect(res.body).toContain('avatar--initial');
  });

  it('rejects something that cannot be a handle without asking the database', async () => {
    const res = await render('../../etc', [ARTIST]);
    expect(res.code).toBe(404);
    expect(lastRequestBody).toBeNull();
  });
});

describe('profile page — not found, case, and outages', () => {
  it('a missing profile is a real 404, with a page and no index', async () => {
    const res = await render('nobody', []);
    expect(res.code).toBe(404);
    expect(res.body).toContain("This profile isn't available");
    expect(res.body).toContain('<meta name="robots" content="noindex">');
  });

  it('redirects a capitalised handle to the one canonical URL', async () => {
    const res = await render('Riya', [ARTIST]);
    expect(res.code).toBe(301);
    expect(res.headers.Location).toBe('/@riya');
    expect(lastRequestBody).toBeNull();
  });

  it('accepts the handle with its @ and sends it to the database without one', async () => {
    const res = await render('@riya', [ARTIST]);
    expect(res.code).toBe(200);
    expect(JSON.parse(lastRequestBody!)).toEqual({ p_username: 'riya' });
  });

  it('an outage is a 503 — never a 404 that would de-list the artist', async () => {
    const res = await render('riya', null);
    expect(res.code).toBe(503);
    expect(res.headers['Cache-Control']).toBe('no-store');
  });
});
