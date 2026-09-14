---
tier: 4
owner: principal-client
consumers: [CA, TR, ALL]
last_verified: 2026-07-30
verify_every: 9999d
verified_by: manual
visibility: public
supersedes: []
related_adrs: []
---

# PROP-0007 — A Settings screen on the Profile tab, so the published deletion path has a container to live in

| | |
|---|---|
| **Status** | **Draft** · Ratified · Rejected · Deferred · Implemented |
| **Date** | 2026-07-30 |
| **Domain** | client |
| **Addresses** | [PROP-0003](0003-in-app-account-deletion.md) §2 / plan step 2 (Ratified 2026-07-23) |
| **Jira** | LIV-73 (LIV-74 adds Delete Account to this screen) |

---

## Why this is a proposal and not a commit

Both paths this change touches are `propose_only` in
[`.claude/autonomy-config.yml`](../../../.claude/autonomy-config.yml):

| Path | Line | Stated reason |
|---|---|---|
| `src/screens/**` | :65 | 25 files, zero tests |
| `src/navigation/**` | :74 | the session gate — security-relevant and untested |
| `src/components/**` | :67 | 44 files, one tested |

The change touches nothing outside those three. `scripts/enforce-agent-scope.mjs` rejects it in
CI, and correctly.

**The tests below are also not committed**, with one exception noted in *Tests* — they assert
behaviour of a screen that does not exist, so committing them turns `main` red. Apply them with
the implementation.

---

## Corrections to the ticket

Every claim was re-read at `058ad90`. **Three of the four are correct as stated. One is wrong.**

| Ticket claim | Verdict |
|---|---|
| `src/screens/main/SettingsScreen.tsx` does not exist | **Correct.** 25 files in `src/screens/main/`, no `Settings*`. |
| No `Settings` route in `src/navigation/types.ts`, no registration | **Correct.** `grep -rin settings src/navigation/` returns nothing. `RootStackParamList` (`types.ts:15-82`) has 23 keys; none is `Settings`. |
| `ProfileScreen.tsx` has no Settings entry | **Correct.** Same grep returns nothing in that file. |
| `docs/delete-account.html:311-314` documents Profile → Settings → Delete Account → Confirm | **Correct**, exactly those four lines. |
| *(implied)* ProfileScreen carries "notification preferences" that could move | **Wrong — there is nothing to move.** No notification preference exists anywhere in the app. See below. |

### The notification-preferences claim, in full

`grep -rln "notificationPref\|NotificationPref\|push_enabled\|pushEnabled\|notification_settings" src/ supabase/migrations/` returns **nothing**.

Push is not a preference. It is a **one-shot permission prompt** owned by the navigator:
`RootNavigator.tsx:176-207` shows `NotificationPermissionModal` once, gated on
`shouldShowPushPrompt()`, and records the outcome via `requestPushPermissionInteractive` /
`deferPushPrompt` (`src/services/pushNotifications.ts:110, :401, :422`). There is no stored user
preference, no toggle, and no screen that reads one.

A "Notifications" row on Settings would therefore be **new product surface**, not a relocation —
either a toggle backed by a column that does not exist, or a deep link to OS settings. Both are
out of scope here, and per Constitution P63 (`kb/product/` is empty) inventing either is not
mine to do.

---

## Problem

[PROP-0003](0003-in-app-account-deletion.md) was ratified on 2026-07-23. Its §2 is one paragraph:

> New `src/screens/main/SettingsScreen.tsx`, reached from the Profile tab, registered in
> `src/navigation/types.ts`. Deletion is one row; the screen is the container the published page
> names, so it needs to exist even if it starts nearly empty.

`docs/delete-account.html` has been live since 28 June 2026 and instructs users to tap
**Settings** on the Profile tab. **There is no Settings entry on the Profile tab and no Settings
screen.** A user following the published instructions reaches a dead end; the page is the
artefact Google Play's in-app-deletion requirement is measured against.

This ticket is the container only. LIV-74 puts the deletion row in it.

## Why now

It unblocks LIV-74, and it is the cheapest step in PROP-0003's plan — a screen, a route, and one
entry point, with no service and no schema change. Doing it separately means LIV-74 is a
single-row diff against a screen that already exists and has been exercised, rather than a
destructive, irreversible flow landing simultaneously with the surface that hosts it. That
separation is worth more than the round trip costs (P4: rigour scales with irreversibility).

---

## What is already on the Profile tab

Enumerated by reading `src/screens/main/ProfileScreen.tsx` end to end (1,079 lines). Every
interactive element:

| # | Action | Where | Belongs on Settings? |
|---|---|---|---|
| 1 | **Sign out** — hand-rolled `TouchableOpacity` pill in the brand top bar, opens `ConfirmActionModal` | `:550-557` trigger · `:395-406` handlers · `:745-761` modal · `:815-826` styles | **Yes** — see below |
| 2 | Edit profile — `Button variant="primary"` → `navigate('EditProfile')` | `:664-670` | No |
| 3 | Invite friends — `Button variant="secondary"` → `Share.share` | `:671-681` | No |
| 4 | Story ring — opens own stories when a cluster exists | `:561-584` | No |
| 5 | Link chips → `Linking.openURL`; "+N more" opens an all-links modal | `:601-630` | No |
| 6 | Fans / Friends / Stars pills | `:635-648` | No — and see the defect below |
| 7 | Tab bar, post cards, comments sheet, pull-to-refresh | `:718-743` | No — content, not settings |

**Sign out is the only account-level action on the screen**, and `grep -rn "signOut" src/`
confirms `ProfileScreen.tsx:403` is the **only** sign-out in the signed-in app — the other two
(`ChooseUsernameScreen.tsx:114`, `ResetPasswordScreen.tsx:51`) are escapes from auth gates.

### Incidental finding, not fixed here

The three social pills at `ProfileScreen.tsx:635-648` are `TouchableOpacity` with
`activeOpacity={0.85}` and **no `onPress`**. They look tappable and do nothing. Unrelated to this
ticket; recorded so it is not lost.

---

## The content question — recommendation, and what it rests on

The ticket says "no settings content beyond what is needed to make the screen non-empty and
navigable," which leaves the content undefined. Three honest options:

| | Content | Diff |
|---|---|---|
| **A** | Header only. Nothing in the body. | 1 new file + 3 one-line edits |
| **B** | Header + **Sign out, moved off ProfileScreen** | A, plus ~40 lines removed from ProfileScreen |
| **C** | Header + Sign out **duplicated**, kept in both places | A, plus a second copy of the flow |

**Recommended: B.**

1. It makes the screen non-empty **without inventing product content.** Sign out already exists,
   already has ratified copy, and is being relocated rather than designed. That is the strictest
   possible reading of "no content beyond what is needed."
2. Option A ships a screen that does nothing. P41: *"a feature that is technically present and
   practically unusable has not shipped — it has only been written."* A gear icon leading to an
   empty page is arguably worse than no gear.
3. It repairs a live standards violation rather than leaving it. The current trigger is exactly
   the pattern [design-system.md](../../standards/design-system.md) names as the cause of ~40
   divergent button styles: a `TouchableOpacity` plus a local `StyleSheet` where `Button` is
   mandated.
4. **One owner per responsibility (P12).** C gives sign-out two homes, which is how two copies of
   a confirm flow drift apart.
5. It makes LIV-74 genuinely one row: `Sign out` / `Delete Account` is the conventional
   account-actions pair, and the destructive row lands next to a sibling instead of alone on a
   blank screen.

**The cost, stated plainly.** Closed testers lose a one-tap sign-out from the profile header; it
becomes two taps. That is a real regression for existing muscle memory, traded for the standard
location. **Whether that trade is right is a product decision and the maintainer may overrule
it** — `kb/product/` is empty, so there is no ratified principle to appeal to and I am not going
to invent one (P63). If overruled, **A is the fallback and needs no ProfileScreen change at
all**: drop §3 below and keep the existing pill alongside the new gear.

C is not recommended in either case.

---

## Proposal

Four files. §1 and §2 are the same under options A and B; §3 is B only.

### 1. `src/components/Icon.tsx` — one new registry entry

There is no gear in the registry today (all 60 entries read; `settings` / `gear` absent).
Phosphor ships one — verified at
`node_modules/phosphor-react-native/lib/typescript/index.d.ts:677`. Pure-JS SVG, **no native
rebuild** ([design-system.md](../../standards/design-system.md) → *Iconography*).

```diff
   Faders,
   Flag,
+  Gear,
   Globe,
```

```diff
   // navigation & chrome
   | 'back' | 'backArrow' | 'forward' | 'send' | 'arrowRight' | 'arrowUp'
   | 'collapse' | 'close' | 'clear' | 'add' | 'compose' | 'edit' | 'dragHandle'
-  | 'clipStart' | 'clipEnd' | 'minusCircle'
+  | 'clipStart' | 'clipEnd' | 'minusCircle' | 'settings'
```

```diff
   minusCircle: [MinusCircle, 'regular'],
+  settings: [Gear, 'regular'],
```

Named `settings`, not `gear` — the registry is a semantic layer, so the glyph can be swapped
without touching call sites.

### 2. The route

`src/navigation/types.ts`, in `RootStackParamList`:

```diff
   Following: undefined;
   RecentlyPlayed: undefined;
   EditProfile: undefined;
+  Settings: undefined;
```

`src/navigation/RootNavigator.tsx` — import beside the other screen imports, and register inside
the `session ?` branch next to `EditProfile`:

```diff
 import EditProfileScreen from '../screens/main/EditProfileScreen';
+import SettingsScreen from '../screens/main/SettingsScreen';
```

```diff
             <Stack.Screen
               name="EditProfile"
               component={EditProfileScreen}
               options={{
                 animation: 'slide_from_right',
               }}
             />
+            <Stack.Screen
+              name="Settings"
+              component={SettingsScreen}
+              options={{
+                animation: 'slide_from_right',
+              }}
+            />
```

`RootNavigator` already uses `createNativeStackNavigator` (`:4`, `:56`) — nothing to change, and
the contract test in *Tests* pins it.

Registering inside the `session` branch is deliberate: Settings must be unreachable when signed
out, which is the branch the navigator already uses as the session gate.

### 3. `src/screens/main/ProfileScreen.tsx` — the gear replaces the pill *(option B only)*

The top bar is `brand` + one right-hand control (`:548-558`). The pill becomes the gear, so the
layout is unchanged.

```diff
         <View style={styles.topBar}>
           <Text style={styles.brand}>livil</Text>
           <TouchableOpacity
-            style={styles.signOutInline}
-            onPress={handleSignOut}
+            style={styles.headerIconBtn}
+            onPress={() => navigation.navigate('Settings')}
             activeOpacity={0.8}
-            accessibilityLabel="Sign out"
+            accessibilityRole="button"
+            accessibilityLabel="Settings"
+            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
           >
-            <Text style={styles.signOutInlineText}>Sign out</Text>
+            <Icon name="settings" size={24} color={COLORS.white} />
           </TouchableOpacity>
         </View>
```

Then delete what has moved:

```diff
-  const [signOutOpen, setSignOutOpen] = useState(false);
-  const [signOutBusy, setSignOutBusy] = useState(false);
   const [allLinksOpen, setAllLinksOpen] = useState(false);
```
```diff
-  const handleSignOut = useCallback(() => {
-    setSignOutOpen(true);
-  }, []);
-
-  const confirmSignOut = useCallback(async () => {
-    if (signOutBusy) { return; }
-    setSignOutBusy(true);
-    playback.pauseAll();
-    await supabase.auth.signOut();
-    setSignOutBusy(false);
-    setSignOutOpen(false);
-  }, [playback, signOutBusy]);
```
```diff
-  }, [profile, stats, followCounts, error, loading, handleSignOut, navigation]);
+  }, [profile, stats, followCounts, error, loading, navigation]);
```
```diff
-      <ConfirmActionModal
-        visible={signOutOpen}
-        title="Sign out of Livil?"
-        …
-      />
-
       <ConfirmActionModal
         visible={allLinksOpen}
```
*(delete `:745-761` in full; the all-links modal below it stays, so the `ConfirmActionModal`
import remains used)*

```diff
-  signOutInline: {
-    paddingHorizontal: 12,
-    paddingVertical: 6,
-    borderRadius: 999,
-    borderWidth: 1,
-    borderColor: COLORS.border,
-  },
-  signOutInlineText: {
-    color: COLORS.textSecondary,
-    fontSize: 12,
-    fontWeight: '700',
-  },
+  headerIconBtn: {
+    width: 40,
+    height: 40,
+    alignItems: 'center',
+    justifyContent: 'center',
+  },
```

`TouchableOpacity`, `supabase` and `playback` all remain used elsewhere in the file, so no import
is orphaned — `npm run lint` (`no-unused-vars`, error) is the check for that, not this sentence.

**No `android_ripple`.** `TouchableOpacity` gives press opacity and is the idiom every other
header control in the app uses (`RecentlyPlayedScreen.tsx:94-100`). The design-system rule bans
`android_ripple` on rounded controls because the ripple ignores `borderRadius`; nothing here
introduces one.

### 4. `src/screens/main/SettingsScreen.tsx` *(new)*

Header follows `RecentlyPlayedScreen.tsx:93-108` verbatim in structure — back button, centred
title, a spacer of equal width so the title stays optically centred.

```tsx
import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../navigation/types';
import { COLORS } from '../../theme/colors';
import { Icon } from '../../components/Icon';
import { Button } from '../../components/Button';
import ConfirmActionModal from '../../components/ConfirmActionModal';
import { usePlayback } from '../../contexts/PlaybackContext';
import { supabase } from '../../../lib/supabase';

export default function SettingsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const playback = usePlayback();
  const [signOutOpen, setSignOutOpen] = useState(false);
  const [signOutBusy, setSignOutBusy] = useState(false);

  // No navigation reset after signOut: RootNavigator swaps the whole signed-in
  // stack for AuthNavigator on SIGNED_OUT, so this screen unmounts itself.
  const confirmSignOut = useCallback(async () => {
    if (signOutBusy) { return; }
    setSignOutBusy(true);
    playback.pauseAll();
    await supabase.auth.signOut();
    setSignOutBusy(false);
    setSignOutOpen(false);
  }, [playback, signOutBusy]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.headerBtn}
          onPress={() => navigation.goBack()}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Icon name="back" size={32} color={COLORS.white} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>Settings</Text>
        </View>
        <View style={styles.headerBtn} />
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.sectionLabel}>Account</Text>
        <Button
          label="Sign out"
          variant="secondary"
          size="md"
          fullWidth
          onPress={() => setSignOutOpen(true)}
        />
      </ScrollView>

      <ConfirmActionModal
        visible={signOutOpen}
        title="Sign out of Livil?"
        message="You'll need your password to sign back in."
        bullets={[
          'Playback stops on this device',
          'Push notifications pause until you sign in again',
          'Your music and friends stay safe',
        ]}
        glyph="↪"
        tone="destructive"
        confirmLabel="Sign out"
        cancelLabel="Stay signed in"
        busy={signOutBusy}
        onConfirm={confirmSignOut}
        onCancel={() => setSignOutOpen(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  headerBtn: { width: 44, alignItems: 'center', justifyContent: 'center' },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerTitle: { color: COLORS.white, fontSize: 16, fontWeight: '800', letterSpacing: -0.2 },
  body: { paddingHorizontal: 16, paddingTop: 20, paddingBottom: 40 },
  sectionLabel: {
    color: COLORS.textMuted,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 10,
  },
});
```

Under **option A**, delete the `Button`, the modal, both `useState`s, `confirmSignOut`,
`usePlayback` and `supabase` — leaving header, `sectionLabel` and an empty section.

### Decisions inside §4 worth naming

- **`Button`, not a hand-rolled row.** Sign out is an action, so it takes the shared `Button`.
  `variant="secondary"` (neutral border, white label) is the closest match to the pill it
  replaces; `destructive` is reserved for irreversible actions, and signing out is not one. The
  `ConfirmActionModal` keeps `tone="destructive"` exactly as today.
- **No `SettingsRow` component.** The screen has zero navigation rows, so building a row
  abstraction for none of them is the generality P25 warns against. LIV-74 adds one more
  `Button`. If a third row appears, *then* extract.
- **Copy is byte-identical to today's modal** (`ProfileScreen.tsx:747-757`). Rewording it here
  would be an unreviewed product change smuggled into a container ticket.
- **No `FLOATING_PLAYER_HEIGHT` padding.** Content is top-anchored and one screen tall, so the
  floating player occludes nothing. If the screen ever scrolls, add it to
  `body.paddingBottom` the way `FollowingScreen.tsx:136` does.
- **`Alert.alert` appears nowhere.** The repo is at 0 occurrences and this keeps it there.
- **Every colour is a `COLORS` token.** No hex literal is introduced.

---

## Tests

### 1. `src/__tests__/contracts/navigation-routes.test.ts` — the one genuinely valuable test

**This is the test worth writing, and it is not a test of the screen.** The failure this ticket
can actually produce is a *seam* failure, and it is silent to the compiler: `tsc` accepts
`navigation.navigate('Settings')` the instant `Settings` exists in `RootStackParamList`, whether
or not any `<Stack.Screen>` renders it. Half the change compiles. It fails on the tap.

That is the same shape as the highest-value existing test in the repository
(`src/__tests__/contracts/native-prop-seam.test.ts` — a declaration mirrored in several places
where a missed mirror is silent), and it is modelled on it deliberately.

```ts
/**
 * Route seam: a route declared in navigation/types.ts must be registered in a
 * navigator, and vice versa.
 *
 * `tsc` accepts navigate('X') as soon as X is a key of the param list, whether or
 * not any <Stack.Screen> renders it — so half the change compiles and fails on the tap.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const NAV = join(__dirname, '../../navigation');

function read(file: string): string {
  return readFileSync(join(NAV, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

/** Top-level keys of a param-list type; nested param objects are indented deeper. */
function routesIn(source: string, typeName: string): string[] {
  const start = source.indexOf(`export type ${typeName} = {`);
  const body = source.slice(start, source.indexOf('\n};', start));
  return [...body.matchAll(/^ {2}([A-Za-z_]\w*)\??\s*:/gm)].map(m => m[1]!);
}

function screensIn(source: string, tag: string): string[] {
  return [
    ...source.matchAll(new RegExp(`<${tag}\\.Screen[\\s\\S]{0,160}?name="(\\w+)"`, 'g')),
  ].map(m => m[1]!);
}

const types = read('types.ts');

const CASES = [
  { list: 'RootStackParamList', file: 'RootNavigator.tsx', tag: 'Stack', anchor: 'App' },
  { list: 'AppTabParamList', file: 'AppNavigator.tsx', tag: 'Tab', anchor: 'Profile' },
  { list: 'AuthStackParamList', file: 'AuthNavigator.tsx', tag: 'Stack', anchor: 'SignIn' },
] as const;

describe('navigation route seam', () => {
  describe.each(CASES)('$list ↔ $file', ({ list, file, tag, anchor }) => {
    const declared = routesIn(types, list);
    const registered = screensIn(read(file), tag);

    it('parses both sides', () => {
      // Without this, two empty sets would compare equal and the suite would pass vacuously.
      expect(declared).toContain(anchor);
      expect(registered).toContain(anchor);
    });

    it('registers every declared route in a navigator', () => {
      expect(declared.filter(r => !registered.includes(r))).toEqual([]);
    });

    it('declares route params for every registered screen', () => {
      expect(registered.filter(r => !declared.includes(r))).toEqual([]);
    });
  });

  it('uses the native stack, never the JS stack', () => {
    for (const file of ['RootNavigator.tsx', 'AuthNavigator.tsx']) {
      const source = read(file);
      expect(source).toContain('createNativeStackNavigator');
      expect(source).not.toContain('createStackNavigator(');
    }
  });
});
```

**This one file could land ahead of the screen.** Unlike everything else here it **passes on
`main` today** — all three param lists are at exact parity (23/23, 4/4, 4/4, verified) — so it
would not redden `main`. `src/**/__tests__/**` is `writable` (`:41`). It is left uncommitted only
because this task was scoped to a proposal; if the maintainer wants the guard early, it is
independently mergeable.

### 2. `src/screens/main/__tests__/SettingsScreen.test.tsx` — feasible, and narrower than it looks

[PROP-0006](0006-null-author-rendering.md) concluded screens are untestable here. **That
conclusion does not survive contact with this particular screen**, and the difference is worth
stating precisely: `ConversationScreen`'s `MessageBubble` needs navigation, Supabase, the
keyboard controller and four contexts. `SettingsScreen` needs **two mocks and one provider**, and
`PlaybackProvider` already mounts under `react-test-renderer` with no native mocks
(`src/contexts/__tests__/PlaybackContext.clipSession.test.tsx`).

```tsx
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';

const mockSignOut = jest.fn().mockResolvedValue({ error: null });
const mockGoBack = jest.fn();

// The arrow indirection is load-bearing — see the note below this block.
jest.mock('../../../../lib/supabase', () => ({
  supabase: { auth: { signOut: (...a: unknown[]) => mockSignOut(...(a as [])) } },
}));
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ goBack: mockGoBack }) }));

import { PlaybackProvider, usePlayback } from '../../../contexts/PlaybackContext';
import SettingsScreen from '../SettingsScreen';

type Ctx = ReturnType<typeof usePlayback>;

function mount() {
  const ctx: { current: Ctx | null } = { current: null };
  function Capture() { ctx.current = usePlayback(); return <SettingsScreen />; }
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => { tree = TestRenderer.create(<PlaybackProvider><Capture /></PlaybackProvider>); });
  return { tree, ctx: ctx.current! };
}

const texts = (t: TestRenderer.ReactTestRenderer) =>
  t.root.findAllByType(Text).map(n => n.props.children)
    .filter((c): c is string => typeof c === 'string');

const trigger = (t: TestRenderer.ReactTestRenderer) =>
  t.root.findAll(n => typeof n.props?.onPress === 'function'
    && n.props?.accessibilityLabel === 'Sign out')[0]!;

const confirm = (t: TestRenderer.ReactTestRenderer) =>
  t.root.findAll(n => typeof n.props?.onConfirm === 'function')[0]!;

describe('SettingsScreen', () => {
  beforeEach(() => { mockSignOut.mockClear(); mockGoBack.mockClear(); });

  it('mounts under the Settings title', () => {
    expect(texts(mount().tree)).toContain('Settings');
  });

  it('does not sign out when the trigger is pressed', () => {
    const { tree } = mount();
    act(() => { trigger(tree).props.onPress(); });
    expect(mockSignOut).not.toHaveBeenCalled();
  });

  it('signs out only once the confirmation is accepted', async () => {
    const { tree } = mount();
    act(() => { trigger(tree).props.onPress(); });
    await act(async () => { await confirm(tree).props.onConfirm(); });
    expect(mockSignOut).toHaveBeenCalledTimes(1);
  });

  it('stops playback before signing out', async () => {
    const { tree, ctx } = mount();
    const pause = jest.spyOn(ctx, 'pauseAll');
    act(() => { trigger(tree).props.onPress(); });
    await act(async () => { await confirm(tree).props.onConfirm(); });
    expect(pause).toHaveBeenCalled();
    expect(pause.mock.invocationCallOrder[0]!)
      .toBeLessThan(mockSignOut.mock.invocationCallOrder[0]!);
  });
});
```

Option A drops tests 2–4 and keeps only the mount test.

> **The arrow indirection in the `jest.mock` factory is not style.** The first draft of this test
> wrote `signOut: mockSignOut` directly. Babel hoists `jest.mock` above the `const`, so the
> factory captured `undefined`, the screen received `supabase.auth.signOut === undefined`, and
> *"does not sign out when the trigger is pressed"* **passed for the wrong reason** — it could
> never have failed. Mutation-testing caught it: the mutation crashed with
> `signOut is not a function` instead of failing an assertion. This is exactly the decoration
> failure P29 describes, in a test that was well-named and looked correct.

### What was actually run

The screen and both test files were reproduced **outside the repository** (nothing was written
under `src/`) and executed with the project's Jest transform, importing the **real**
`src/contexts/PlaybackContext`, `src/components/Button`, `src/components/Icon`,
`src/components/ConfirmActionModal`, `src/theme/colors`, and the real
`src/navigation/{types,RootNavigator,AppNavigator,AuthNavigator}`.

**Route-seam test: 10 of 10 pass against `main` at `058ad90`.** Then mutated:

| Mutation | Caught? |
|---|---|
| `Settings` added to `RootStackParamList`, never registered — *the exact half-done LIV-73* | **Yes** — *registers every declared route* |
| `<Stack.Screen name="Settings">` registered, never declared | **Yes** — *declares route params for every registered screen* |
| `createNativeStackNavigator` → `createStackNavigator` | **Yes** — *uses the native stack* |
| `RootStackParamList` emptied (vacuous-pass probe) | **Yes** — 2 failures, incl. *parses both sides* |
| **Both halves applied correctly** | **Passes** — the change is not merely forbidden, it is recognised |

**Screen test: 4 of 4 pass.** Then mutated:

| Mutation | Caught? |
|---|---|
| Trigger calls `confirmSignOut` directly, bypassing the modal | **Yes** |
| `onConfirm` wired so it never signs out | **Yes** — 2 failures |
| `playback.pauseAll()` deleted | **Yes** — *stops playback before signing out* |
| `pauseAll()` moved after `signOut()` | **Yes** — the ordering assertion, not just the call |
| **`if (signOutBusy) { return; }` guard deleted** | **No** — see below |

### Honest limits

- **The busy guard is not covered.** Deleting it leaves all four tests green. It only matters on
  a double-tap inside the in-flight `await`, which these tests do not simulate. Real impact is
  small — `signOut()` twice is idempotent — but it is uncovered, and saying "4 passed" without
  this line would overstate the suite (P32).
- **The route-seam test reads source text, not a mounted navigator.** It cannot prove the screen
  renders, and it cannot distinguish the signed-in branch from the signed-out one — a route
  registered in a branch no user reaches would still count as registered.
- **It also has parsing logic in it**, which [testing.md](../../standards/testing.md) →
  *Conventions* discourages. The mitigation is the *parses both sides* anchor: a formatting change
  that defeats the regex makes the suite fail loudly rather than pass vacuously, which is the safe
  failure direction. `native-prop-seam.test.ts` carries the same tension for the same reason.
- **The screen test costs ~3.4 s** against ~0.7 s for the entire current 113-test suite, because
  it transforms Phosphor, `react-native-safe-area-context` and the component tree. That is a real
  price for four assertions and the reviewer should weigh it.
- **Nothing here tests the gear on `ProfileScreen`.** That file needs six mocked contexts and two
  services; it is out of reach, and the entry point is verified by hand.

---

## Implementation plan

Each step is independently reviewable. Step 5 is only needed under option B.

1. `Icon.tsx` — `Gear` import, `'settings'` in `IconName`, registry entry.
2. `types.ts` — `Settings: undefined`.
3. `SettingsScreen.tsx` — new file.
4. `RootNavigator.tsx` — import + `<Stack.Screen name="Settings">` in the `session` branch.
5. *(B only)* `ProfileScreen.tsx` — gear replaces the pill; delete the sign-out state, handlers,
   modal and styles.
6. Both test files.
7. `npm run typecheck && npm run lint && npm test`.

Steps 1–4 are option A in full and are worth reviewing as one unit; step 5 is the part carrying a
product decision and should be reviewed on its own.

---

## Scope boundaries

**Explicitly not included:**

- **The Delete Account row and the deletion flow — that is LIV-74.** This screen ships with no
  destructive action on it. LIV-74 then adds **one `Button`** to a screen that already exists,
  is registered, is reachable and has been exercised by hand. Nothing in this proposal calls
  `delete_my_account()`, touches storage, or resets navigation.
- **Any notification preference.** None exists (see *Corrections*). Adding one is new product
  surface plus, probably, a new column.
- **Any service, RPC, migration or RLS change.** Zero files under `src/services/` or
  `supabase/`.
- **Any change to `docs/`.** `docs/delete-account.html:311-314` becomes *more* accurate after
  this, not less — steps 1 and 2 start working; steps 3 and 4 wait for LIV-74. Re-checking that
  page is PROP-0003 plan step 5's job, once the whole flow exists.
- **Moving Edit profile or Invite friends.** They are profile actions and stay on the profile.
- **The dead Fans/Friends/Stars pills** (`ProfileScreen.tsx:635-648`). Recorded above; a
  different ticket.
- **Any `SettingsRow` abstraction, section component, or theme/appearance toggle.** Dark theme
  only, by standing decision.
- **Migrating the seven copies of `avatarInitials`.** Untouched here; still open from PROP-0006.

---

## Risk

**Blast radius is small and every part is reversible by revert.** Nothing here touches playback
internals, the native patch, authorization, or the schema.

Ranked by what a wrong change looks like to a user:

1. **A user cannot sign out.** Only reachable under option B, and only if step 5 lands while
   step 3 does not. The mitigation is ordering — ship the screen before removing the pill — and
   the screen test's *"signs out only once the confirmation is accepted"* is what pins the
   replacement. This is the one outcome worth a deliberate check.
2. **The gear leads nowhere.** The route-seam test is exactly this failure, and it fails on the
   declared-but-unregistered mutation.
3. **A signed-out user reaching Settings.** Prevented structurally: the screen is registered
   inside the `session ?` branch, so it is not in the navigator at all when signed out. This is
   the reason `src/navigation/**` is `propose_only` — it is the session gate — and the reason
   step 4 deserves a careful read rather than a skim.
4. **Sign-out leaves audio playing.** Covered by the ordering assertion. Low impact regardless:
   `GlobalAudioPlayer` is rendered inside the same `session &&` guard, so it unmounts anyway.
5. **A cosmetic top-bar regression on Profile.** The gear occupies a 40×40 box where a
   ~90×28 pill was; `topBar` is `justifyContent: 'space-between'`, so the brand stays left and
   the control stays right. Visual only, and only visible by looking.

**Not a risk:** navigation state after sign-out. `RootNavigator` swaps the entire signed-in stack
for `AuthNavigator` on `SIGNED_OUT` (`RootNavigator.tsx`, auth listener), so `SettingsScreen`
unmounts itself and no reset is needed. React 19 does not warn on the trailing `setState` after
unmount, and today's `ProfileScreen` has the identical shape.

---

## Verification

- `npm run typecheck`, `npm run lint`, `npm test` clean. Baseline recorded below.
- The route-seam suite passes, and the *declared-but-unregistered* mutation fails it.
- The screen suite passes, and the four mutations in the table fail it.
- **By hand, on a device — the assertions no test here can make:**
  1. Profile tab shows a gear where the pill was; tapping it slides Settings in from the right;
     back returns to Profile with the feed and scroll position intact.
  2. Sign out → confirm → the app returns to the auth stack, and audio has stopped.
  3. **Cancel the confirmation** and confirm nothing happened — the negative case, and the one a
     mis-wired modal breaks.
  4. Sign back in and reach Settings again; confirm nothing on Profile changed besides the gear.
  5. Rotate / open Settings with the floating player visible; confirm the player does not cover
     the Sign out button.
- **After LIV-74 only:** re-read `docs/delete-account.html:311-314` against the shipped flow.

---

## Alternatives

| Alternative | Why set aside |
|---|---|
| **A — empty container** | Honest and the smallest diff, but ships a screen that does nothing (P41), and leaves the hand-rolled sign-out pill in place. Kept as the fallback if the maintainer rejects moving sign out. |
| **C — sign out in both places** | Two homes for one action (P12). The two confirm flows drift; we have already paid for that pattern with ~40 divergent button styles. |
| Invent a settings menu (theme, language, privacy, about) | Product surface with no ratified direction; `kb/product/` is empty. P63 — not mine to decide. |
| A "Notifications" row deep-linking to OS settings | Plausible and conventional, but it is new product surface, not a relocation. Propose separately. |
| Put Settings in the bottom tab bar | Five tabs for a screen with one row; the tab bar is a navigation spine, not a settings drawer. Profile-header gear is the platform convention. |
| Reuse `EditProfileScreen` as the Settings container | The published page names two different destinations, and profile *editing* and *account* actions are different responsibilities. Merging them makes LIV-74 land inside a form. |
| Build a `SettingsRow` component now | Zero rows to render. P25 — the third occurrence justifies the abstraction; the first does not. |
| Ship LIV-73 and LIV-74 as one change | Couples a reversible container to an irreversible deletion flow in one review (P4). The separation is the point. |
| Register Settings outside the `session` branch | Would make it reachable signed out. The branch is the session gate. |

---

## Graduation — does this move anything to `writable`?

**No.** And widening `.claude/autonomy-config.yml` is a human edit (`never_agent`, :102); this
section only reports what the evidence would support.

| Path | Would this qualify it? |
|---|---|
| `src/navigation/**` | **No.** The route-seam test pins *route declaration parity* — three files, one property. It says nothing about the session gate itself, which is the stated reason the path is `propose_only` (:74): that `<Stack.Screen name="App">` is inside `session ?` and `Auth` inside the `else`, that `passwordRecoveryPending` and `needsUsername` gate ahead of both, that `SIGNED_OUT` clears the message cache and unregisters the device. **None of that is covered.** Granting write access on the strength of a parity test would be precisely the false assurance the config exists to prevent. |
| `src/screens/**` | **No**, and the qualifier matters. One screen out of 25 turns out to be testable, because it has almost no dependencies. That is an argument about `SettingsScreen.tsx`, not about the directory. The other 24 are 8k–56k each with Supabase, playback, stories, jam and chat contexts. |
| `src/components/Icon.tsx` | **No.** A registry entry with no test. It would qualify on a trivial "every `IconName` resolves to a component" test — cheap, and worth someone's twenty minutes — but that is not in this change. |

**What would actually move the needle**, in increasing order of cost:

1. **A `Icon.tsx` registry-completeness test.** One `it.each` over `IconName`. It would catch a
   name added to the union but not the registry — today a runtime `undefined` component.
2. **A real navigator test** that mounts `RootNavigator` with a null session and asserts no
   signed-in route is reachable, then with a session and asserts the inverse. That is a test of
   the *gate*, and it is the only thing that could honestly move `src/navigation/**`. Materially
   harder — Supabase, push, presence and five providers all mount in that tree.
3. **Extracting screen bodies into dependency-injected components**, the route PROP-0006 already
   named for `MessageBubble`. `SettingsScreen` is the counter-example that shows the target
   shape, not a step toward it.

Until then the honest position is: this screen is testable; the directory it lives in is not.

---

> **Proposals require human ratification before becoming work.** The board proposes; it does not
> schedule. A ratified proposal becomes a Jira Epic linked back to this document.
