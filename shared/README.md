# `shared/` — code consumed by both clients

Per [ADR-0015](../kb/decisions/0015-web-creator-dashboard.md), Livil has two clients on one
Supabase project: the React Native app in `src/` and the web creator dashboard in `web/`.
This directory is the only code they share.

## Rules

**1. No React Native imports. No DOM imports.** Anything here is compiled by *both* Metro
and Vite. An `import { Platform } from 'react-native'` breaks the web build; a `window`
reference breaks the mobile one. If a thing needs either, it belongs in `src/` or `web/`,
not here.

**2. The Supabase client is injected, never imported.** Modules here call `livil()` from
[`client.ts`](client.ts). They must not import `lib/supabase.ts` — that file is the mobile
client (AsyncStorage-backed session storage, `react-native-url-polyfill`) and is closed to
agents by `.claude/autonomy-config.yml`. Each app constructs its own client and calls
`configureLivilClient()` once at startup.

**3. This is source, not a package.** There is no build step and no `package.json`. Both
bundlers compile these files directly — Vite through the `@shared` alias, Metro through a
relative import. That is deliberate: a published package would need versioning, and version
skew between two clients writing to one database is the exact failure ADR-0015 chose a
single repository to avoid.

**4. Re-export rather than move, where the source is closed.** `types/database.ts` and
`theme/colors.ts` re-export from `lib/` and `src/theme/` instead of relocating them, so
neither the mobile client nor any closed path has to change. If those files later move here
for real, only these two re-export shims change.

## Blast radius

Code here is loaded by the Play Store build. A defect is not confined to the web app. That
is recorded against `shared/**` in `.claude/autonomy-config.yml`, and it is the reason that
entry says to graduate the path properly before the extraction grows beyond
`tracks` / `posts` / `albums`.
