/**
 * Tracker adapter tests.
 *
 * Run with `npm run test:tracker` (node's built-in runner — these are `.mjs` modules outside
 * the React Native jest project, and adding an ESM transform to that config to reach four
 * files would be a worse trade than one extra script).
 *
 * `fetch` is injected everywhere, so nothing here touches the network or needs a credential.
 * That is not only for speed: the paths worth pinning are the REFUSALS, and a test against a
 * live Jira could only prove them by attempting the very actions the adapter exists to
 * prevent.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { toAdf, isAdf } from './adf.mjs';
import { createTracker, checkReadiness, TrackerPermissionError, HANDOFF_STATUSES } from './index.mjs';
import { configFromEnv, createJiraClient } from './jira.mjs';
import { READY_LABEL, READINESS_CHECKS } from './types.mjs';

/** A client stub. Records calls; returns whatever the test needs. */
function stubClient(overrides = {}) {
  const calls = [];
  const record = name => (...args) => {
    calls.push({ name, args });
    return overrides[name] ? overrides[name](...args) : undefined;
  };
  return {
    calls,
    whoAmI: overrides.whoAmI ?? (async () => ({ accountId: 'me', displayName: 'Agent' })),
    get: overrides.get ?? (async key => ({ key, reporterId: 'me', labels: [], status: 'To Do' })),
    create: overrides.create ?? (async () => ({ key: 'LIV-1', url: 'u' })),
    comment: record('comment'),
    update: record('update'),
    transitions: overrides.transitions ?? (async () => []),
    transition: record('transition'),
    search: overrides.search ?? (async () => []),
  };
}

describe('toAdf', () => {
  test('wraps prose in a paragraph', () => {
    const doc = toAdf('hello');
    assert.equal(doc.type, 'doc');
    assert.deepEqual(doc.content, [
      { type: 'paragraph', content: [{ type: 'text', text: 'hello' }] },
    ]);
  });

  test('keeps a wrapped sentence as ONE paragraph', () => {
    // Line-per-paragraph would make every wrapped ticket body unreadable in Jira.
    const doc = toAdf('one\ntwo');
    assert.equal(doc.content.length, 1);
    assert.equal(doc.content[0].content[0].text, 'one\ntwo');
  });

  test('splits paragraphs on a blank line', () => {
    assert.equal(toAdf('one\n\ntwo').content.length, 2);
  });

  test('promotes ## to a heading, but leaves a lone # as text', () => {
    // `#` alone is how people write "issue #153" — promoting that would be guessing.
    const doc = toAdf('## Title\n\n# not a heading');
    assert.equal(doc.content[0].type, 'heading');
    assert.equal(doc.content[0].attrs.level, 2);
    assert.equal(doc.content[1].type, 'paragraph');
  });

  test('groups a run of bullets into one list', () => {
    const doc = toAdf('- one\n- two\n- three');
    assert.equal(doc.content.length, 1);
    assert.equal(doc.content[0].type, 'bulletList');
    assert.equal(doc.content[0].content.length, 3);
  });

  test('ends a bullet run when prose follows', () => {
    const doc = toAdf('- one\nprose');
    assert.deepEqual(doc.content.map(n => n.type), ['bulletList', 'paragraph']);
  });

  test('leaves inline markup alone rather than half-parsing it', () => {
    assert.equal(toAdf('**bold**').content[0].content[0].text, '**bold**');
  });

  test('is total — empty input still produces a valid document', () => {
    // Jira rejects a doc with no content, so this must not be an empty array.
    const doc = toAdf('');
    assert.equal(doc.content.length, 1);
    assert.equal(doc.content[0].type, 'paragraph');
  });

  test('passes an existing ADF document through untouched', () => {
    const adf = { type: 'doc', version: 1, content: [] };
    assert.equal(toAdf(adf), adf);
    assert.equal(isAdf(adf), true);
    assert.equal(isAdf('text'), false);
  });
});

describe('configFromEnv', () => {
  test('fails loudly when the credential is absent', () => {
    // A tracker that no-ops when unconfigured reports success on work it never did.
    assert.throws(() => configFromEnv({}), /JIRA_EMAIL, JIRA_API_TOKEN/);
  });

  test('defaults the site and project, never the secret', () => {
    const config = configFromEnv({ JIRA_EMAIL: 'a@b.c', JIRA_API_TOKEN: 't' });
    assert.equal(config.site, 'vvkiitkgp.atlassian.net');
    assert.equal(config.project, 'LIV');
    assert.equal(config.token, 't');
  });
});

describe('the permission boundary', () => {
  test('refuses to apply ai-ready on create', async () => {
    const tracker = createTracker({ client: stubClient() });
    await assert.rejects(
      () => tracker.create({ type: 'Task', summary: 's', body: 'b', labels: [READY_LABEL] }),
      TrackerPermissionError,
    );
  });

  test('refuses to apply ai-ready on update', async () => {
    const tracker = createTracker({ client: stubClient() });
    await assert.rejects(
      () => tracker.updateOwn('LIV-1', { labels: [READY_LABEL] }),
      TrackerPermissionError,
    );
  });

  test('refuses to move a ticket to Done', async () => {
    const tracker = createTracker({ client: stubClient() });
    await assert.rejects(() => tracker.moveTo('LIV-1', 'Done'), TrackerPermissionError);
    await assert.rejects(() => tracker.moveTo('LIV-1', 'Closed'), TrackerPermissionError);
  });

  test('refuses any status outside the agent-settable set', async () => {
    const tracker = createTracker({ client: stubClient() });
    await assert.rejects(() => tracker.moveTo('LIV-1', 'To Do'), TrackerPermissionError);
  });

  test('refuses to edit a ticket somebody else filed', async () => {
    const client = stubClient({
      get: async key => ({ key, reporterId: 'someone-else', labels: [] }),
    });
    const tracker = createTracker({ client });
    await assert.rejects(
      () => tracker.updateOwn('LIV-1', { summary: 'rewritten' }),
      TrackerPermissionError,
    );
    assert.equal(client.calls.filter(c => c.name === 'update').length, 0);
  });

  test('allows editing a ticket it filed itself', async () => {
    const client = stubClient();
    const tracker = createTracker({ client });
    await tracker.updateOwn('LIV-1', { summary: 'fixed' });
    assert.equal(client.calls.filter(c => c.name === 'update').length, 1);
  });

  test('exposes no way to delete anything', () => {
    const tracker = createTracker({ client: stubClient() });
    for (const forbidden of ['delete', 'remove', 'close', 'done']) {
      assert.equal(tracker[forbidden], undefined, `tracker must not expose ${forbidden}()`);
    }
  });
});

describe('transitions', () => {
  test('resolves by target status name, not by a hard-coded id', async () => {
    // Ids are per-workflow and change when the board is edited.
    const client = stubClient({
      transitions: async () => [{ id: '31', to: 'In Progress' }, { id: '41', to: 'Done' }],
    });
    const tracker = createTracker({ client });
    await tracker.moveTo('LIV-1', 'In Progress');
    const call = client.calls.find(c => c.name === 'transition');
    assert.deepEqual(call.args, ['LIV-1', '31']);
  });

  test('explains itself when the handoff status does not exist on the board yet', async () => {
    const client = stubClient({ transitions: async () => [{ id: '31', to: 'In Progress' }] });
    const tracker = createTracker({ client });
    await assert.rejects(
      () => tracker.handOff('LIV-1', 'Apply to Prod'),
      /must be created in Jira board settings/,
    );
  });

  test('handOff accepts only the two lanes', async () => {
    const tracker = createTracker({ client: stubClient() });
    await assert.rejects(() => tracker.handOff('LIV-1', 'Done'), /Unknown lane/);
    assert.deepEqual(HANDOFF_STATUSES, ['ToDo Deploy', 'Apply to Prod']);
  });
});

describe('create', () => {
  test('rejects an unknown item type', async () => {
    const tracker = createTracker({ client: stubClient() });
    // `Feature` and `Request` exist in Jira and are deliberately unused by the standard.
    await assert.rejects(() => tracker.create({ type: 'Feature', summary: 's' }), /Unknown item type/);
  });

  test('rejects an empty summary', async () => {
    const tracker = createTracker({ client: stubClient() });
    await assert.rejects(() => tracker.create({ type: 'Task', summary: '   ' }), /needs a summary/);
  });

  test('refuses an empty comment', async () => {
    const tracker = createTracker({ client: stubClient() });
    await assert.rejects(() => tracker.comment('LIV-1', '  '), /empty comment/);
  });
});

describe('the Jira client', () => {
  test('surfaces field-level errors, not just the status code', async () => {
    // Jira puts "you cannot set this field on this issue type" in a field-keyed map; losing
    // it turns a precise 400 into a mystery.
    const fetchImpl = async () => ({
      ok: false,
      status: 400,
      text: async () => JSON.stringify({ errors: { parent: 'not valid for this type' } }),
    });
    const client = createJiraClient({
      config: { site: 's', email: 'e', token: 't', project: 'LIV' },
      fetch: fetchImpl,
    });
    await assert.rejects(() => client.get('LIV-1'), /parent: not valid for this type/);
  });

  test('sends Basic auth and asks for JSON', async () => {
    let seen = null;
    const fetchImpl = async (url, init) => {
      seen = { url, init };
      return { ok: true, status: 200, text: async () => JSON.stringify({ key: 'LIV-1', fields: {} }) };
    };
    const client = createJiraClient({
      config: { site: 'example.atlassian.net', email: 'e@x.com', token: 'secret', project: 'LIV' },
      fetch: fetchImpl,
    });
    await client.get('LIV-1');
    assert.match(seen.url, /^https:\/\/example\.atlassian\.net\/rest\/api\/3\/issue\/LIV-1/);
    assert.equal(seen.init.headers.Authorization, `Basic ${Buffer.from('e@x.com:secret').toString('base64')}`);
  });

  test('handles 204 with no body', async () => {
    const fetchImpl = async () => ({ ok: true, status: 204, text: async () => '' });
    const client = createJiraClient({
      config: { site: 's', email: 'e', token: 't', project: 'LIV' },
      fetch: fetchImpl,
    });
    await client.comment('LIV-1', 'body');
  });
});

describe('checkReadiness', () => {
  test('covers every check the standard lists, including "one concern"', () => {
    // This list drives triage. A check missing here is a check triage silently passes.
    assert.deepEqual(
      READINESS_CHECKS.map(c => c.id),
      ['concern', 'outcome', 'scope', 'domain', 'acceptance', 'provenance'],
    );
    assert.equal(checkReadiness({ title: 't', body: '' }).length, 6);
  });

  test('recognises a well-formed ticket', () => {
    const item = {
      title: 'The SQL suite stops at the first failing file',
      body: `## Outcome
what is true when this is done.
## Explicitly NOT in scope
parallelising.
## Acceptance criteria
verified by running it.
## Domain
principal-platform
## Provenance
LIV-12`,
    };
    const unmet = checkReadiness(item).filter(c => !c.met);
    assert.deepEqual(unmet, []);
  });

  test('reports an empty ticket as unready without deciding anything', () => {
    const results = checkReadiness({ title: 'fix stuff', body: '' });
    assert.ok(results.every(c => typeof c.met === 'boolean'));
    assert.ok(results.filter(c => !c.met).length >= 5);
    // Findings, not a verdict: the standard says send it back with specific questions.
    assert.ok(results.every(c => c.question && c.hint));
  });
});
