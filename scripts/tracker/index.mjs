/**
 * The tracker port — the only way anything in this repository touches the issue tracker.
 *
 * `kb/standards/work-tracking.md` has said "agents never call the tracker API directly" since
 * it was written, and until now there was nothing to call instead: `types.mjs` held the
 * shapes and the constants, and no client existed. A standard that describes a module which
 * does not exist is not a standard, it is a hope — so the rule was being followed by nobody,
 * including the agents that read the document saying so.
 *
 * Two jobs, and they are separable on purpose:
 *
 *   1. CONCENTRATE THE DEPENDENCY. Everything Jira-shaped lives in `jira.mjs`. Swapping
 *      trackers is a new file with the same seven methods, plus one line here.
 *
 *   2. CONCENTRATE THE PERMISSION BOUNDARY. The rules in the standard's "What agents may and
 *      may not do" table are enforced HERE, above the implementation, so a second tracker
 *      cannot forget to reimplement them.
 *
 * ── What this is honest about ────────────────────────────────────────────────
 *
 * The standard's enforcement table already says the transition limits are "not enforced —
 * the integration grants write access; this is currently a rule, not a control". That is
 * still true and this module does not change it. A credential that can write can write
 * anything, and anybody who bypasses this file has full access.
 *
 * What this module does is remove every *accidental* path to a forbidden action: there is no
 * `close()`, no `delete()`, no way to reach an arbitrary transition, and `ai-ready` is
 * rejected wherever labels are accepted. It converts "an agent must remember not to" into
 * "an agent would have to go around the adapter to", which is a real improvement and is not
 * the same thing as a control. The scoped credential named in the standard is still the fix.
 */
import { createJiraClient, configFromEnv, TERMINAL_STATUSES } from './jira.mjs';
import { READY_LABEL, READINESS_CHECKS } from './types.mjs';

/** Issue types the standard uses. `Feature` and `Request` exist in Jira and are deliberately unused. */
export const ITEM_TYPES = ['Epic', 'Story', 'Task', 'Bug', 'Subtask'];

/**
 * The two lanes a merged change waits in, and why an agent may set them but not `Done`.
 *
 * Reaching users is a human ship step — a Play Store build, or a migration applied to the
 * live database. An agent that could mark work Done would be reporting an outcome it did not
 * produce and cannot observe.
 */
export const HANDOFF_STATUSES = ['ToDo Deploy', 'Apply to Prod'];

/** Statuses an agent may move a ticket INTO. Everything else is a human's to set. */
const AGENT_SETTABLE = ['In Progress', ...HANDOFF_STATUSES];

export class TrackerPermissionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TrackerPermissionError';
  }
}

/**
 * `ai-ready` is the gate that says an agent may pick a ticket up. An agent applying it to its
 * own ticket is a gate that opens itself, which is not a gate — so it is refused at the one
 * place labels can be set, rather than trusted to fifteen call sites.
 */
function assertLabelsAllowed(labels) {
  if (labels.includes(READY_LABEL)) {
    throw new TrackerPermissionError(
      `Refusing to apply '${READY_LABEL}'. It is the gate that says an agent may pick a ticket ` +
        'up, and a gate that can be self-opened is not a gate. A human applies it.',
    );
  }
}

export function createTracker({
  client,
  config = null,
  fetch: fetchImpl = globalThis.fetch,
} = {}) {
  // Injected client in tests; a real one built from the environment otherwise. Constructing
  // it lazily would move the "not configured" failure to the first call, which is exactly
  // the late, confusing failure `configFromEnv` exists to prevent.
  const jira = client ?? createJiraClient({ config: config ?? configFromEnv(), fetch: fetchImpl });

  let identity = null;
  const whoAmI = async () => (identity ??= await jira.whoAmI());

  return {
    /** Readiness checks, for triage. Re-exported so callers need only this module. */
    readinessChecks: READINESS_CHECKS,

    async get(key) {
      return jira.get(key);
    },

    async search(jql, options) {
      return jira.search(jql, options);
    },

    /**
     * File a work item.
     *
     * Does NOT validate readiness. Filing what you found the moment you find it is the
     * behaviour worth having — an adapter that refuses an under-specified ticket produces
     * no ticket, and a finding nobody recorded is worse than one recorded badly. Use
     * `checkReadiness` when deciding whether an agent may PICK UP a ticket, which is the
     * decision the checks were written for.
     */
    async create({ type, summary, body, labels = [], parent = null }) {
      if (!ITEM_TYPES.includes(type)) {
        throw new Error(`Unknown item type '${type}'. Expected one of: ${ITEM_TYPES.join(', ')}.`);
      }
      if (!summary || !summary.trim()) {
        throw new Error('A work item needs a summary.');
      }
      assertLabelsAllowed(labels);
      return jira.create({ type, summary: summary.trim(), body, labels, parent });
    },

    async comment(key, body) {
      if (!body || (typeof body === 'string' && !body.trim())) {
        throw new Error('Refusing to post an empty comment.');
      }
      return jira.comment(key, body);
    },

    /**
     * Edit a ticket this credential created, and only such a ticket.
     *
     * The standard forbids editing a ticket an agent did not create: rewriting somebody
     * else's description silently changes what the team agreed to build. Checked against the
     * reporter rather than assumed, which costs one extra read and makes the rule real
     * instead of advisory.
     */
    async updateOwn(key, fields) {
      if (Object.prototype.hasOwnProperty.call(fields, 'labels')) {
        assertLabelsAllowed(fields.labels ?? []);
      }

      const [item, me] = await Promise.all([jira.get(key), whoAmI()]);
      if (item.reporterId && item.reporterId !== me.accountId) {
        throw new TrackerPermissionError(
          `${key} was filed by somebody else. Editing a ticket you did not create rewrites ` +
            'what the team agreed to build. Comment on it instead.',
        );
      }
      await jira.update(key, fields);
      return jira.get(key);
    },

    /**
     * Move a ticket to a status an agent is allowed to set.
     *
     * Transitions are resolved by TARGET STATUS NAME, never by id: ids are per-workflow and
     * change when the board is edited, so a hard-coded one breaks silently the day somebody
     * renames a column. The lookup also gives a real error when `Apply to Prod` has not been
     * created in Jira settings yet — a case the standard explicitly flags.
     */
    async moveTo(key, status) {
      if (TERMINAL_STATUSES.includes(status)) {
        throw new TrackerPermissionError(
          `Refusing to move ${key} to '${status}'. Reaching production is a human ship step — ` +
            'a Play Store build, or a migration applied to the live database — and an agent ' +
            `cannot observe it. Leave the ticket in ${HANDOFF_STATUSES.join(' or ')} and say so.`,
        );
      }
      if (!AGENT_SETTABLE.includes(status)) {
        throw new TrackerPermissionError(
          `Refusing to move ${key} to '${status}'. An agent may set: ${AGENT_SETTABLE.join(', ')}.`,
        );
      }

      const available = await jira.transitions(key);
      const match = available.find(t => t.to === status);
      if (!match) {
        throw new Error(
          `${key} has no transition to '${status}'. Available: ` +
            `${available.map(t => t.to).join(', ') || '(none)'}. ` +
            (HANDOFF_STATUSES.includes(status)
              ? 'Note that this status must be created in Jira board settings; the API cannot create it.'
              : ''),
        );
      }
      await jira.transition(key, match.id);
      return jira.get(key);
    },

    /** Convenience for the two lanes, so callers do not retype the status strings. */
    async handOff(key, lane) {
      if (!HANDOFF_STATUSES.includes(lane)) {
        throw new Error(`Unknown lane '${lane}'. Expected one of: ${HANDOFF_STATUSES.join(', ')}.`);
      }
      return this.moveTo(key, lane);
    },
  };
}

/**
 * Score a ticket against the definition of ready.
 *
 * Returns findings rather than a verdict, and deliberately does not decide anything: the
 * standard says an unready ticket is "sent back with specific questions, not guessed at", and
 * a specific question needs the check that failed and its hint, not a boolean.
 *
 * These are TEXTUAL heuristics over a human-written description — they can only tell you a
 * section appears to be missing, never that a present one is any good. Treat a pass as
 * "nothing obviously absent", not as "ready".
 */
export function checkReadiness(item) {
  const body = `${item.title ?? ''}\n${typeof item.body === 'string' ? item.body : ''}`.toLowerCase();

  const evidence = {
    concern: !/\band\b.*\balso\b/.test(item.title?.toLowerCase() ?? ''),
    outcome: /outcome|what is true when|observable/.test(body),
    scope: /not in scope|out of scope|explicitly not|does not include/.test(body),
    domain: /principal-(playback|data|client|security|realtime|platform)/.test(body),
    acceptance: /acceptance|criteria|verified by|checkable/.test(body),
    provenance: /(liv-\d+|adr-\d+|d-\d+|pr #\d+|#\d{2,})/.test(body),
  };

  return READINESS_CHECKS.map(check => ({
    id: check.id,
    question: check.question,
    hint: check.hint,
    // Unknown ids default to unmet rather than met: a check this function has not learned to
    // look for must not be reported as satisfied.
    met: evidence[check.id] ?? false,
  }));
}
