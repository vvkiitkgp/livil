/**
 * Forbids `cond ? { …, x: (await f()) ?? y } : …` — an await (or yield) on the left of `??`
 * inside a branch of a conditional expression.
 *
 * WHY (2026-11-02): Hermes in React Native 0.85.3 miscompiles it. The branch's whole value
 * becomes the awaited value — the object around it is lost. Verified on an iPhone:
 *   true ? { ...d, k: (yield 1) ?? '' } : null   →  "V"   (the resumed value, not the object)
 *   true ? { id: 1, k: (yield 1) ?? '' } : null  →  "V"
 * The Editor's Create post built `{ ...draft, userId: (await owner()) ?? '' }` this way, got a
 * user-id string instead of the draft, and stopped silently on every tap. Nothing looks wrong
 * in the source, Jest (Node/V8) passes, and it only fails on the phone.
 *
 * Fix: await into a variable first, then build the value with an if/else.
 */

const isAwaitLike = node => node && (node.type === 'AwaitExpression' || node.type === 'YieldExpression');

/** Is there an await/yield inside `node` (not crossing into a nested function)? */
function containsAwait(node) {
  if (!node || typeof node !== 'object') return false;
  if (isAwaitLike(node)) return true;
  if (/Function/.test(node.type)) return false;
  for (const key of Object.keys(node)) {
    if (key === 'parent') continue;
    const v = node[key];
    if (Array.isArray(v)) { if (v.some(containsAwait)) return true; } else if (v && typeof v.type === 'string' && containsAwait(v)) return true;
  }
  return false;
}

function findAwaitNullish(node) {
  if (!node || typeof node !== 'object' || /Function/.test(node.type)) return null;
  if (node.type === 'LogicalExpression' && node.operator === '??' && containsAwait(node.left)) return node;
  for (const key of Object.keys(node)) {
    if (key === 'parent') continue;
    const v = node[key];
    const kids = Array.isArray(v) ? v : v && typeof v.type === 'string' ? [v] : [];
    for (const k of kids) { const hit = findAwaitNullish(k); if (hit) return hit; }
  }
  return null;
}

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'No `(await x) ?? y` inside a `? :` branch — Hermes (RN 0.85) loses the surrounding value',
    },
    schema: [],
    messages: {
      miscompiled:
        'Hermes miscompiles `(await …) ?? …` inside a `? :` branch: the branch becomes the awaited value. Await into a variable first and use if/else (see eslint-rules/no-hermes-conditional-await-nullish.js).',
    },
  },
  create(context) {
    return {
      ConditionalExpression(node) {
        for (const branch of [node.consequent, node.alternate]) {
          const hit = findAwaitNullish(branch);
          if (hit) context.report({ node: hit, messageId: 'miscompiled' });
        }
      },
    };
  },
};
