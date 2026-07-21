/**
 * Enforces the single-engine invariant: exactly one <Video> may declare
 * `showNotificationControls`.
 *
 * WHY (INC-0001, ADR-0001):
 * A second component declaring notification controls means a second OS media
 * session. Every audio↔video boundary in the queue then tears one session down and
 * builds another, which the operating system renders as a swipeable carousel of
 * duplicate media notifications — and drops skip events during the churn.
 *
 * This was expensive to diagnose because each engine worked correctly in isolation;
 * only mixed queues failed. Nothing about the code looks wrong at either site.
 *
 * The allowed owner is GlobalAudioPlayer. Any other file is an error.
 *
 * This rule is deliberately simple: it does not try to prove there is exactly one
 * across the tree (a lint rule sees one file at a time). It enforces the stronger,
 * checkable property — only the designated owner may declare it at all.
 */

const ALLOWED_FILE = 'GlobalAudioPlayer';
const PROP = 'showNotificationControls';

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Only GlobalAudioPlayer may declare showNotificationControls — a second ' +
        'media session produces duplicate notifications (INC-0001)',
    },
    schema: [],
    messages: {
      secondSession:
        'Only GlobalAudioPlayer may set `{{prop}}`. A second media session causes ' +
        'duplicate, swipeable media notifications and dropped skip events ' +
        '(INC-0001, ADR-0001). Player surfaces must be followers: read position ' +
        'from PlaybackContext refs and produce no audio. ' +
        'See kb/architecture/playback.md.',
    },
  },

  create(context) {
    const filename = context.filename ?? context.getFilename();
    if (filename.includes(ALLOWED_FILE)) {
      return {};
    }

    const report = node =>
      context.report({ node, messageId: 'secondSession', data: { prop: PROP } });

    return {
      // <Video showNotificationControls />  and  showNotificationControls={...}
      JSXAttribute(node) {
        if (node.name && node.name.name === PROP) {
          report(node);
        }
      },
      // Spread-built props: { showNotificationControls: true }
      Property(node) {
        const key = node.key;
        const name = key && (key.name || key.value);
        if (name === PROP) {
          report(node);
        }
      },
    };
  },
};
