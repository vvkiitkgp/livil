---
tier: 3
owner: principal-client
consumers: [P-CL, FE, RF, CR]
last_verified: 2026-07-21
verify_every: 90d
verified_by: manual
visibility: public
supersedes: []
related_adrs: []
---

# Client Architecture

How state, rendering, and navigation are organised in the React Native app. The parts that
surprise people are the state layering and the size of `PlaybackContext`.

---

## Provider tree

Order matters and is not accidental.

```
GestureHandlerRootView
└ SafeAreaProvider
  └ KeyboardProvider
    └ PlaybackProvider          ← ABOVE NavigationContainer, deliberately
      └ NavigationContainer
        └ ToastProvider
          └ RootNavigator
            └ (authenticated) JamProvider ▸ JamRealtimeProvider
                               ▸ RelationshipProvider ▸ StoriesProvider
                               ▸ ChromeVisibilityProvider
```

**`PlaybackProvider` sits outside `NavigationContainer`** so playback survives every
navigation. The five authenticated-only providers are pushed down into `RootNavigator`'s
signed-in branch so they never mount for signed-out users.

Two initialisation details that exist because of specific crashes:

- A no-op Reanimated mapper is started on mount so `global.__mapperRun` exists before the
  keyboard provider's handlers fire.
- The native splash is handed to a JavaScript splash inside a `requestAnimationFrame`, so
  there is no blank frame between them.

---

## State is layered by update frequency

This is the most important thing to understand before touching playback state.

| Layer | Mechanism | Re-renders? | Used for |
|---|---|:--:|---|
| **High-frequency** | `useRef` | **no** | position, duration, clip window, handlers, queue |
| **Opt-in signal** | version counters | yes, deliberately | "the ref changed, please re-render" |
| **Ordinary** | `useState` | yes | everything else |
| **UI-thread** | Reanimated shared values | no JS render | gestures, animations |

Playback position updates several times a second. If it lived in React state, every consumer
would re-render at that rate. It lives in `positionRef`, and surfaces **poll** it — the
full-screen player at roughly 10 Hz, the waveform at roughly 30 Hz.

**Adding ordinary React state to the playback context for a high-frequency value is a
performance defect, not a style preference.**

Version counters (`queueVersion`, `seekNonce`, `clipVersion`) are the escape hatch: mutate the
ref, then bump the counter to notify. The cost is that mutation and notification are separate
steps, so **bumping must not be forgotten** — a mutated ref with no bump is an invisible
change.

---

## `PlaybackContext` is a god context

Measured, not estimated:

| | |
|---|---:|
| Lines | 788 |
| `useState` slots | 17 |
| `useRef` slots | 15 |
| **Entries in the value `useMemo` dependency array** | **55** |

Any one of those 55 changing re-renders **every** `usePlayback()` consumer — and consumers
include the feed, every player surface, and most screens.

The refs are correct and well-designed. The problem is what shares the context with them:
`isFullScreenOpen`, `isImmersive`, `isStoryViewerOpen`, `isRepostOpen`, `jamLocked` are **pure
UI-visibility booleans**. They have no relationship to audio, and they invalidate the playback
context for every consumer when a sheet opens.

**A split into playback core / player UI / queue would cut the re-render fan-out
substantially.** This is recorded debt, not a decision — see the debt register.

`engineDriving` is a live context field that is now permanently `false`: it guarded a second
engine implementation that has been deleted. Its remaining consumers always take one branch.

---

## Navigation

`createNativeStackNavigator` throughout — **never `createStackNavigator`**. On Android 15 the
JS stack produces touch and gesture problems that the native stack does not.

```
RootNavigator (native stack)
├ session === null  → AuthNavigator        (6 screens)
└ session !== null  → 23 routes, first is AppNavigator (4 bottom tabs)
                      + global player overlays as siblings
```

The player surfaces are rendered as **siblings of the navigator**, not inside a screen, which
is why they float above everything and survive navigation.

Related rules: `gestureEnabled: false` on auth screens; predictive back is disabled in the
Android manifest; `index.js` must import `react-native-gesture-handler` first.

Route parameters are typed in `src/navigation/types.ts`. **Adding a route means updating that
file** — it is the only place route params are declared.

There is **no `linking` config**. Deep links are handled manually; see [auth.md](auth.md).

---

## Component conventions

These are enforced, not advisory — lint rules exist for them.

| Rule | Why |
|---|---|
| Use `FormInput`, never a raw `TextInput` with focus state lifted to a parent | On Android 15 + Fabric, lifting focus state remounts the input and dismisses the keyboard |
| Use `Icon`, never a unicode glyph as an icon | Single import surface; consistent sizing and weight |
| Never nest `<Icon>` inside `<Text>` | It is an SVG, not inline text |
| Never `Alert.alert` | The OS dialog clashes with the dark theme. Use `ConfirmActionModal` or the toast |
| Import `COLORS`; do not hard-code hex | One source of truth for the palette |

**Exceptions that stay as text:** chat reaction emoji and the picker, emoji inside copy
strings, single-character initials fallbacks, and the decorative glyph prop on
`ConfirmActionModal`.

---

## Styling

`StyleSheet.create` per file. No styled-components, no utility CSS framework. Colours come
from a single flat `COLORS` object; the theme is dark-only by design and there is no light mode.

Two honest gaps:

- **The theme has no non-colour tokens.** Every padding, radius, and font size is a bare
  literal across 100+ style blocks. There is no spacing or typography scale.
- **Colour discipline is imperfect.** A significant number of hex and `rgba()` literals exist
  outside the theme. Some are legitimate (a user-facing colour-swatch palette); most are
  accumulated drift, including several unnamed accent colours that were never promoted into
  the theme. Current counts are in [inventory.md](inventory.md).

---

## Known structural issues

Recorded so nobody rediscovers them as novel:

1. **Large screens, almost no extracted logic.** Several screens are well over 600 lines
   against a very small number of custom hooks. The *ratio* is the signal, not any one file
   (Constitution P28).
2. **Two profile screens duplicate heavily.** Own-profile and other-profile share most of their
   structure and differ mainly in ownership affordances. `DetailView`'s `kind` prop is the
   in-repo pattern that already solves this shape for albums and playlists.
3. **Formatting helpers are reimplemented repeatedly** — time, counts, relative dates, avatar
   initials. They diverged because they take different argument shapes. `src/utils/` exists and
   is the obvious home.
4. **No error boundary.** A render-phase throw takes down the app. There is no crash reporting,
   so production failures are invisible.

Duplication is not automatically wrong (P26) — but duplication we have *chosen* must be
acknowledged, and this was accumulated rather than chosen.

## Related

- [playback.md](playback.md) — what the refs feed
- [backend.md](backend.md) — what screens call
- [inventory.md](inventory.md) — current sizes, generated
