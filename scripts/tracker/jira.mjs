/**
 * The Jira Cloud implementation of the tracker port.
 *
 * EVERYTHING JIRA-SPECIFIC LIVES HERE. Endpoint shapes, ADF, issue-type names, transition
 * lookup, the `/rest/api/3` prefix, the Basic-auth header — none of it appears anywhere else
 * in the repository. That is the entire point of the adapter (Constitution P13: every
 * dependency is a future obligation; know the exit path). Swapping to Linear or GitHub
 * Issues means writing a second file with these seven methods and changing one line in
 * `index.mjs`.
 *
 * The permission boundary is NOT enforced here — it lives in `index.mjs`, above this file,
 * so that a second tracker implementation cannot forget to reimplement it. This module is
 * deliberately dumb about policy; it knows how to talk to Jira and nothing about what an
 * agent is allowed to ask for.
 *
 * `fetch` is injected rather than imported so the tests can exercise every path — including
 * the error paths, which are the ones that matter and the ones a live-API test would never
 * reach on purpose.
 */
import { toAdf } from './adf.mjs';

/** Statuses that mean "this reached users", which only a human may set. Mirrored in index.mjs. */
export const TERMINAL_STATUSES = ['Done', 'Closed', 'Resolved'];

/**
 * Read configuration from the environment.
 *
 * Credentials are never read from a file and never defaulted. A missing token fails loudly
 * at construction rather than producing a 401 at the first write — the same reasoning as
 * `schema-parity.sh` refusing to run without `PRODUCTION_DATABASE_URL` rather than silently
 * skipping: a check that no-ops when unconfigured reports success on work it never did.
 */
export function configFromEnv(env = process.env) {
  const missing = [];
  const site = env.JIRA_SITE ?? 'vvkiitkgp.atlassian.net';
  const email = env.JIRA_EMAIL;
  const token = env.JIRA_API_TOKEN;
  const project = env.JIRA_PROJECT ?? 'LIV';

  if (!email) missing.push('JIRA_EMAIL');
  if (!token) missing.push('JIRA_API_TOKEN');

  if (missing.length > 0) {
    throw new Error(
      `Tracker is not configured: ${missing.join(', ')} not set.\n` +
        'Create a token at https://id.atlassian.com/manage-profile/security/api-tokens and ' +
        'export JIRA_EMAIL and JIRA_API_TOKEN. Never commit them.',
    );
  }

  return { site, email, token, project };
}

export function createJiraClient({ config, fetch: fetchImpl = globalThis.fetch }) {
  const base = `https://${config.site}/rest/api/3`;
  const auth = Buffer.from(`${config.email}:${config.token}`).toString('base64');

  async function call(method, path, body) {
    const response = await fetchImpl(`${base}${path}`, {
      method,
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

    if (response.status === 204) return null;

    const raw = await response.text();
    const parsed = raw ? safeJson(raw) : null;

    if (!response.ok) {
      // Jira answers with `errorMessages` and/or a field-keyed `errors` object. Both are
      // surfaced: the field map is where "you cannot set this field on this issue type"
      // lives, and losing it turns a precise 400 into a mystery.
      const messages = [
        ...(parsed?.errorMessages ?? []),
        ...Object.entries(parsed?.errors ?? {}).map(([field, message]) => `${field}: ${message}`),
      ];
      throw new Error(
        `Jira ${method} ${path} failed (${response.status})` +
          (messages.length > 0 ? `: ${messages.join('; ')}` : `: ${raw.slice(0, 300)}`),
      );
    }

    return parsed;
  }

  function safeJson(raw) {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  const urlFor = key => `https://${config.site}/browse/${key}`;

  /** Jira's issue JSON → the tracker-neutral `WorkItem` in types.mjs. */
  function toWorkItem(issue) {
    return {
      key: issue.key,
      title: issue.fields?.summary ?? '',
      body: issue.fields?.description ?? null,
      type: (issue.fields?.issuetype?.name ?? '').toLowerCase(),
      status: issue.fields?.status?.name ?? '',
      labels: issue.fields?.labels ?? [],
      reporterId: issue.fields?.reporter?.accountId ?? null,
      url: urlFor(issue.key),
    };
  }

  return {
    /** The account the credential belongs to. Used to answer "did I create this?". */
    async whoAmI() {
      const me = await call('GET', '/myself');
      return { accountId: me.accountId, displayName: me.displayName };
    },

    async get(key) {
      const issue = await call(
        'GET',
        `/issue/${encodeURIComponent(key)}?fields=summary,description,issuetype,status,labels,reporter`,
      );
      return toWorkItem(issue);
    },

    async create({ type, summary, body, labels = [], parent }) {
      const fields = {
        project: { key: config.project },
        issuetype: { name: type },
        summary,
        description: toAdf(body),
        ...(labels.length > 0 ? { labels } : {}),
        ...(parent ? { parent: { key: parent } } : {}),
      };
      const created = await call('POST', '/issue', { fields });
      return { key: created.key, url: urlFor(created.key) };
    },

    async comment(key, body) {
      await call('POST', `/issue/${encodeURIComponent(key)}/comment`, { body: toAdf(body) });
    },

    async update(key, fields) {
      await call('PUT', `/issue/${encodeURIComponent(key)}`, { fields });
    },

    /**
     * Available transitions, by target status name.
     *
     * Looked up rather than hard-coded: transition ids are per-workflow and change when the
     * board is edited. A hard-coded id is a silent break the day somebody renames a column
     * — and `Apply to Prod` is a status the standard notes has to be created by hand in Jira
     * settings, so it may legitimately not exist yet.
     */
    async transitions(key) {
      const found = await call('GET', `/issue/${encodeURIComponent(key)}/transitions`);
      return (found.transitions ?? []).map(t => ({ id: t.id, to: t.to?.name ?? '' }));
    },

    async transition(key, transitionId) {
      await call('POST', `/issue/${encodeURIComponent(key)}/transitions`, {
        transition: { id: transitionId },
      });
    },

    async search(jql, { maxResults = 25 } = {}) {
      const found = await call(
        'GET',
        `/search/jql?jql=${encodeURIComponent(jql)}&maxResults=${maxResults}` +
          '&fields=summary,description,issuetype,status,labels,reporter',
      );
      return (found.issues ?? []).map(toWorkItem);
    },
  };
}
