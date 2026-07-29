---
tier: 2
owner: principal-client
consumers: [ALL, CR, RF, FE, BE]
last_verified: 2026-07-21
verify_every: 90d
verified_by: manual
visibility: public
supersedes: []
related_adrs: []
---

# Coding Standards

Every rule below states **how it is enforced**. A rule with no enforcement is marked
`ADVISORY` — that is not a softer rule, it is an honest label for a rule that will drift
(Constitution P1: an invariant that is not enforced is a wish).

---

## ⚠️ Enforcement is currently weak

| Mechanism | Exists? | State |
|---|:--:|---|
| ESLint (`npm run lint`) | yes | **failing — 24 errors, 200 warnings** |
| TypeScript strict | yes | on, but **there is no `typecheck` script** and nothing runs it |
| Tests (`npm test`) | yes | **failing** — one boilerplate test, no assertions |
| KB validator | yes | passing |
| **CI** | **no** | nothing runs on any commit |

**No rule in this document is enforced at merge time**, because nothing runs at merge time.
Until CI exists, every rule below is effectively advisory regardless of its label — the labels
describe what *would* catch a violation locally.

Five of the 24 lint errors are in a file that is dead code and should be deleted. Fixing lint
starts with deletion, not repair.

---

## Language and types

| Rule | Enforcement |
|---|---|
| TypeScript `strict` stays on | `tsc` — **no script; run `npx tsc --noEmit`** |
| No `@ts-ignore` / `@ts-expect-error` | `ADVISORY` — currently 0 in the codebase; keep it there |
| Avoid `any`; prefer `unknown` at boundaries | `ADVISORY` — 29 occurrences today |
| No unused variables | ESLint (error) |
| Exhaustive hook dependencies | ESLint (error) — **do not silence with a disable comment without a written reason** |

The `any` count is low and the `@ts-ignore` count is zero. That is genuinely good discipline
worth protecting; both are the kind of thing that goes from 0 to 40 in a quarter once the first
one lands unchallenged.

---

## Components

| Rule | Why | Enforcement |
|---|---|---|
| Use `FormInput`, never a raw `TextInput` with focus state lifted to a parent | Lifting focus state remounts the input on Android 15 + Fabric and dismisses the keyboard | `ADVISORY` — needs a lint rule |
| Use `Icon`, never a unicode glyph or emoji as an icon | One import surface; consistent sizing and weight | `ADVISORY` |
| Never nest `<Icon>` inside `<Text>` | It is an SVG, not inline text — wrap in a `View` row | `ADVISORY` |
| Never `Alert.alert` | The OS dialog breaks the dark theme | `ADVISORY` — currently **0 violations** |
| Use `createNativeStackNavigator` | The JS stack has touch and gesture problems on Android 15 | `ADVISORY` — currently **0 violations** |
| Import `COLORS`; never hard-code a colour | One palette source | `ADVISORY` — **widely violated**, see [design-system.md](design-system.md) |

**Emoji exceptions** (these stay as text): chat reactions and the emoji picker, emoji inside
copy strings, single-character initials fallbacks, and the decorative glyph prop on
`ConfirmActionModal`.

### User feedback

| Situation | Use |
|---|---|
| Confirmation, destructive action, a decision | `ConfirmActionModal` |
| Error, warning, short status | `useToast()` with `kind: 'error' \| 'success' \| 'info'` |
| Neither fits | Build a modal matching the existing visual template |

**Never let a save fail silently.** There are known sites where an upload or edit failure
dismisses the screen with no message. That is a defect, not a style issue.

---

## State

Covered in depth in [../architecture/client.md](../architecture/client.md). The rules that
matter most:

- **High-frequency values belong in refs**, not state. Adding a value that updates several
  times a second to `PlaybackContext` state is a performance defect.
- **After mutating a ref that others read, bump its version counter.** A mutated ref with no
  bump is an invisible change.
- **Do not add UI-visibility booleans to the playback context.** It already carries several,
  and each one re-renders every consumer when a sheet opens.

---

## Playback and native

**Read [../architecture/playback.md](../architecture/playback.md) before touching any of this.**

| Rule | Enforcement |
|---|---|
| Exactly one `<Video>` with `showNotificationControls` | `ADVISORY` — a lint rule is planned and would be cheap |
| Never `ClippingConfiguration` / `cropStart` / `cropEnd` | `ADVISORY` |
| Never analyse video for waveform data | `ADVISORY` — violating this kills the process with no JS error |
| Re-capture the patch after any `node_modules/react-native-video` edit | `ADVISORY` |
| Full native rebuild after native changes — a Metro reload is not enough | `ADVISORY` |
| Mirror new native props in **all three** type locations | `ADVISORY` — a missed mirror silently drops the prop |

Several of these have failure modes that are silent or look like something else. They are the
best candidates for automation, because a human reviewer will not catch them either.

---

## Files and structure

- New screens go under `src/screens/`, following the existing layout
- **Adding a route means updating `src/navigation/types.ts`** — the only place route params live
- Extract logic into `src/hooks/` and `src/utils/` rather than growing a screen
- Shared formatting belongs in `src/utils/`, not reimplemented per screen

**Screens over ~600 lines are treated as hotspots.** The generated
[inventory](../architecture/inventory.md) lists current offenders. The concern is not any single
file — it is the ratio of very large units to extracted logic (Constitution P28).

---

## Logging

112 `console.log` calls ship in release builds today, including on realtime hot paths.

| Rule | Enforcement |
|---|---|
| No logging on a per-message or per-frame path | `ADVISORY` |
| **Never log credentials, tokens, or full deep-link URLs** | `ADVISORY` — this is a security rule |
| Prefer removing a log over commenting it out | `ADVISORY` |

---

## Comments

**The default is no comment.** Readable code needs none, and a comment restating what the code
plainly does is noise that has to be read, maintained, and kept true. Write a comment when there
is something the code genuinely cannot say.

Comment **why**, not what (Constitution P37).

| Rule | |
|---|---|
| Default to none | If the code is clear, leave it alone. Renaming a variable beats explaining it. |
| **Two or three lines** | That is the normal size. A comment longer than the code it describes is a smell. |
| Non-obvious code must carry its reason | Undocumented cleverness is a defect regardless of correctness (P27). Name the platform behaviour, the bug, the constraint. |
| One place, not many | A rule that belongs in `kb/` goes in `kb/`, with a link. Do not restate a decision at every call site. |
| No narration | Not `-- now we check membership`. Not section banners around three lines. Not a comment per statement. |
| No history | `git log` and the ADRs hold that. Do not leave "changed from X because Y" in the source. |

**Length is not thoroughness.** The longer a comment is, the less likely it is to be read and the
more likely it is to drift out of true — and a confidently wrong comment is worse than none,
because it is believed. This is not hypothetical: the `msg_update` fix (LIV-78) shipped a
paragraph explicitly labelled load-bearing that taught a **wrong rule** about SQL qualification,
and stated the failure direction backwards. The code was correct; the essay next to it was not.

Where a long explanation genuinely is needed — the native patch, the playback engine, a migration
that encodes an authorization boundary — the right size is still a few lines plus **a link to the
ADR or kb document that holds the reasoning**. That is what keeps the reasoning reviewable and in
one place. `kb/` is the source of truth; source files point at it.

> **Agents especially.** Verbose commenting is the most common failure in agent-authored code
> here. Do not explain your own reasoning to the reader, do not justify the change in the file,
> and do not restate the ticket. The PR body is where that goes. Assume the reader is a competent
> engineer who has the ticket open.

---

## Making a rule real

To promote a rule from `ADVISORY` to enforced:

1. Write the check — a lint rule in `eslint-rules/`, a test, or a script
2. Wire it into `npm run lint` or `npm run verify`
3. Update this document's enforcement column in the same change

**Adding enforcement is always preferable to adding prose** (P39). A rule that has been
advisory for a long time and never violated should be automated cheaply; one that is
routinely violated is either wrong or needs enforcement urgently.

## Related

- [design-system.md](design-system.md) · [data-access.md](data-access.md) · [testing.md](testing.md)
- [../architecture/client.md](../architecture/client.md) · [../architecture/playback.md](../architecture/playback.md)
