/**
 * Plain text → Atlassian Document Format.
 *
 * Jira Cloud's v3 API will not accept a string for a description or a comment; it wants ADF,
 * a JSON document tree. Something has to bridge that, and the shape of that something is a
 * decision worth making deliberately rather than reaching for a Markdown library.
 *
 * THIS IS A LINE CLASSIFIER, NOT A PARSER, and that is the whole design.
 *
 * Every line falls into exactly one of four cases, decided by its first characters and
 * nothing else. There is no lookahead, no backtracking, no nesting, and no inline scanning —
 * so there is no input it can be wrong about, and no way for it to disagree with itself as
 * it grows. That matters more here than fidelity: this repository has already been bitten by
 * a heuristic that reads text and quietly produces the wrong thing (see the lyrics-format
 * note in CLAUDE.md, and the `--`-inside-a-string-literal hazard argued in LIV-94).
 *
 * What it does NOT do, deliberately:
 *   · inline marks — no bold, italic, code spans or links. A `**word**` stays `**word**`.
 *   · tables, nested lists, block quotes, numbered lists.
 *   · anything requiring a decision about ambiguous input.
 *
 * If you need richer structure, pass a ready-made ADF document instead of a string; every
 * function in this adapter accepts either. That escape hatch is why the classifier is allowed
 * to stay this small — the ceiling is not a limit on what can be filed, only on what this
 * module will infer.
 */

/** True when the value is already an ADF document and should be passed through untouched. */
export function isAdf(value) {
  return Boolean(value) && typeof value === 'object' && value.type === 'doc';
}

const text = value => ({ type: 'text', text: value });

/**
 * Heading, `## ` through `###### `.
 *
 * `#` alone is not accepted: a single hash is how people write "issue #153", and promoting
 * that to a title would be the classifier guessing. Two or more is unambiguous enough.
 */
const HEADING = /^(#{2,6})\s+(.*)$/;

/** Bullet, `- ` or `* `. Flat: a leading indent is not read as nesting, it is just text. */
const BULLET = /^[-*]\s+(.+)$/;

/**
 * Convert to an ADF document.
 *
 * Total by construction: every string produces a valid document, including the empty one —
 * Jira rejects a doc with no content, so an empty body becomes an empty paragraph rather
 * than an error thrown at the caller from three layers down.
 */
export function toAdf(body) {
  if (isAdf(body)) return body;

  const source = typeof body === 'string' ? body : String(body ?? '');
  const content = [];
  // Collected across consecutive lines and flushed on a break, so that a wrapped sentence
  // stays one paragraph instead of becoming one paragraph per line.
  let paragraph = [];
  let bullets = [];

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    content.push({ type: 'paragraph', content: [text(paragraph.join('\n'))] });
    paragraph = [];
  };

  const flushBullets = () => {
    if (bullets.length === 0) return;
    content.push({
      type: 'bulletList',
      content: bullets.map(item => ({
        type: 'listItem',
        content: [{ type: 'paragraph', content: [text(item)] }],
      })),
    });
    bullets = [];
  };

  const flush = () => {
    flushParagraph();
    flushBullets();
  };

  for (const line of source.split('\n')) {
    const trimmed = line.trim();

    if (trimmed === '') {
      flush();
      continue;
    }

    const heading = HEADING.exec(trimmed);
    if (heading) {
      flush();
      content.push({
        type: 'heading',
        attrs: { level: heading[1].length },
        content: [text(heading[2])],
      });
      continue;
    }

    const bullet = BULLET.exec(trimmed);
    if (bullet) {
      // A bullet ends a paragraph but joins any run of bullets already open.
      flushParagraph();
      bullets.push(bullet[1]);
      continue;
    }

    // Ordinary prose. Ends a bullet run, because a non-bullet line after bullets is a new
    // block rather than a continuation of the last item.
    flushBullets();
    paragraph.push(trimmed);
  }

  flush();

  if (content.length === 0) {
    content.push({ type: 'paragraph', content: [] });
  }

  return { type: 'doc', version: 1, content };
}
