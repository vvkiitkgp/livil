#!/usr/bin/env node
/**
 * Command-line entry point for the tracker.
 *
 * The adapter exists so agents stop calling the tracker API directly, and an agent reaches
 * for a shell before it reaches for a module import — so without this file the rule stays
 * theoretical no matter how good `index.mjs` is. This is the thing that makes the standard
 * followable.
 *
 *   node scripts/tracker/cli.mjs create --type Task --summary "..." --body-file ./body.md
 *   node scripts/tracker/cli.mjs comment LIV-93 --body-file ./comment.md
 *   node scripts/tracker/cli.mjs start LIV-93
 *   node scripts/tracker/cli.mjs handoff LIV-93 --lane "Apply to Prod"
 *   node scripts/tracker/cli.mjs show LIV-93
 *   node scripts/tracker/cli.mjs ready LIV-93
 *
 * `--body-file` rather than `--body` for anything long, on purpose: a ticket body written as
 * a shell argument gets mangled by quoting, and the failure is silent — the ticket is filed,
 * just wrong. Every command accepts `--dry-run`, which prints exactly what would be sent and
 * calls nothing, so a body can be checked before it is public.
 *
 * There is no `close`, no `done` and no `delete` command. Not because they are guarded here,
 * but because the module underneath does not expose them.
 */
import { readFileSync } from 'node:fs';
import { createTracker, checkReadiness, TrackerPermissionError, HANDOFF_STATUSES } from './index.mjs';
import { toAdf } from './adf.mjs';

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const name = arg.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        flags[name] = true;
      } else {
        flags[name] = next;
        i++;
      }
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

function bodyFrom(flags) {
  if (flags['body-file']) return readFileSync(flags['body-file'], 'utf8');
  if (typeof flags.body === 'string') return flags.body;
  return null;
}

const USAGE = `tracker — the only supported way to touch the issue tracker

  create   --type <Epic|Story|Task|Bug|Subtask> --summary <text> [--body-file <path>]
           [--label <name>]... [--parent LIV-N]
  comment  <KEY> --body-file <path> | --body <text>
  show     <KEY>
  ready    <KEY>              score a ticket against the definition of ready
  start    <KEY>              move to In Progress
  handoff  <KEY> --lane <${HANDOFF_STATUSES.join('|')}>
  search   --jql <query> [--max 25]

Global: --dry-run    print what would be sent; call nothing.

Credentials come from JIRA_EMAIL and JIRA_API_TOKEN. Never commit them.

Not available by design: close, done, delete, and applying the '${'ai-ready'}' label.
Those are human actions — see kb/standards/work-tracking.md.`;

async function main(argv) {
  const { positional, flags } = parseArgs(argv);
  const [command, key] = positional;

  if (!command || flags.help) {
    console.log(USAGE);
    return 0;
  }

  const dryRun = Boolean(flags['dry-run']);
  // Built only when a call is actually going to happen, so `--dry-run` works with no
  // credential configured — which is the state somebody drafting a ticket body is in.
  const tracker = () => createTracker();

  const labels = []
    .concat(flags.label ?? [])
    .filter(l => typeof l === 'string');

  switch (command) {
    case 'create': {
      const body = bodyFrom(flags) ?? '';
      const payload = { type: flags.type, summary: flags.summary, body, labels };
      if (flags.parent) payload.parent = flags.parent;
      if (dryRun) {
        console.log(JSON.stringify({ ...payload, description: toAdf(body) }, null, 2));
        return 0;
      }
      const created = await tracker().create(payload);
      console.log(`${created.key}  ${created.url}`);
      return 0;
    }

    case 'comment': {
      const body = bodyFrom(flags);
      if (!key || !body) {
        console.error('comment needs a KEY and --body-file/--body');
        return 2;
      }
      if (dryRun) {
        console.log(JSON.stringify(toAdf(body), null, 2));
        return 0;
      }
      await tracker().comment(key, body);
      console.log(`commented on ${key}`);
      return 0;
    }

    case 'show': {
      const item = await tracker().get(key);
      console.log(`${item.key}  [${item.status}]  ${item.title}`);
      console.log(item.url);
      if (item.labels.length > 0) console.log(`labels: ${item.labels.join(', ')}`);
      return 0;
    }

    case 'ready': {
      const item = await tracker().get(key);
      const results = checkReadiness(item);
      const unmet = results.filter(r => !r.met);
      console.log(`${item.key}  ${item.title}\n`);
      for (const r of results) console.log(`  ${r.met ? 'ok  ' : 'MISS'}  ${r.id}`);
      if (unmet.length > 0) {
        // The standard: an unready ticket is sent back with SPECIFIC questions, not guessed
        // at. So print the questions, not a score.
        console.log('\nSend back with these questions:');
        for (const r of unmet) console.log(`\n  ${r.question}\n    ${r.hint}`);
      }
      // Advisory only — these are textual heuristics over a human-written description, and
      // exiting non-zero would make a rough signal look like a gate.
      return 0;
    }

    case 'start': {
      const item = await tracker().moveTo(key, 'In Progress');
      console.log(`${item.key} → ${item.status}`);
      return 0;
    }

    case 'handoff': {
      const item = await tracker().handOff(key, flags.lane);
      console.log(`${item.key} → ${item.status}`);
      console.log('A human moves it to Done once it is actually live.');
      return 0;
    }

    case 'search': {
      const items = await tracker().search(flags.jql, { maxResults: Number(flags.max ?? 25) });
      for (const item of items) console.log(`${item.key}  [${item.status}]  ${item.title}`);
      return 0;
    }

    default:
      console.error(`Unknown command '${command}'.\n\n${USAGE}`);
      return 2;
  }
}

main(process.argv.slice(2))
  .then(code => process.exit(code))
  .catch(error => {
    // A refused action is not a crash — it is the adapter working. Say which it was, so
    // nobody reads a permission boundary as a bug and goes looking for a workaround.
    if (error instanceof TrackerPermissionError) {
      console.error(`refused: ${error.message}`);
      process.exit(3);
    }
    console.error(error.message);
    process.exit(1);
  });
