/**
 * Tracker abstraction.
 *
 * WHY AN ADAPTER RATHER THAN CALLING JIRA DIRECTLY
 *
 * Tracker APIs are the kind of dependency that leaks into dozens of call sites and then
 * cannot be changed. Everything agent-facing goes through this shape, so swapping
 * trackers touches one module (Constitution P13: every dependency is a future
 * obligation; know the exit path).
 *
 * It also concentrates the PERMISSION BOUNDARY in one place. Agents may create and
 * comment; they may not close, may not edit tickets they did not create, and may not
 * apply the `ai-ready` label. Scattering the tracker client would scatter that rule too.
 *
 * @typedef {Object} WorkItem
 * @property {string}   key          Tracker-native id, e.g. "LIV-12"
 * @property {string}   title
 * @property {string}   body
 * @property {ItemType} type
 * @property {string}   status
 * @property {string[]} labels
 * @property {string}   url
 *
 * @typedef {'epic'|'story'|'task'|'bug'|'subtask'} ItemType
 */

/**
 * The label that marks an item an agent may pick up.
 *
 * HUMAN-APPLIED ONLY. An agent labelling its own ticket ai-ready is a gate that opens
 * itself, which is not a gate. Enforced socially today and by a scoped credential later
 * — see the honest note in kb/standards/work-tracking.md.
 */
export const READY_LABEL = 'ai-ready';

/** Applied by the board to proposals awaiting human ratification. */
export const NEEDS_RATIFICATION = 'needs-ratification';

/**
 * Definition of ready. A ticket failing any of these is sent back with specific
 * questions rather than guessed at — guessing on an underspecified request where
 * guessing wrong is expensive is a refusal condition (Constitution, Part XVI).
 */
export const READINESS_CHECKS = [
  {
    id: 'outcome',
    question: 'Does it state what is TRUE when this is done, observably?',
    hint: 'Not "improve the feed" — "the feed loads a second page when scrolled to 80%".',
  },
  {
    id: 'scope',
    question: 'Does it say what is explicitly NOT included?',
    hint: 'Silent scope growth during implementation is the most common failure.',
  },
  {
    id: 'domain',
    question: 'Is the affected domain identifiable, so it routes to a reviewer?',
    hint: 'One of the six principal domains. See kb/ai-org/board-routing.yml.',
  },
  {
    id: 'acceptance',
    question: 'Can the acceptance criteria be CHECKED rather than judged?',
    hint: '"Feels faster" is judged. "p95 under 1s on the reference device" is checked.',
  },
  {
    id: 'provenance',
    question: 'Does it link the ADR, proposal, or incident that motivated it?',
    hint: 'Work with no recorded why becomes work nobody can evaluate later.',
  },
];

/**
 * Whether an agent may write to the paths a ticket implies.
 *
 * Returns the advisory verdict only. `scripts/enforce-agent-scope.mjs` is what actually
 * enforces it in CI — this exists so triage can tell an agent up front that a ticket
 * will end in a proposal, rather than letting it discover that at push time.
 */
export function expectedOutcome(paths, config) {
  const writable = paths.filter(p => config.writable.some(re => re.test(p)));
  const blocked = paths.filter(p => !config.writable.some(re => re.test(p)));
  if (blocked.length === 0) return { outcome: 'implement', blocked };
  if (writable.length === 0) return { outcome: 'propose', blocked };
  return { outcome: 'partial', blocked };
}
