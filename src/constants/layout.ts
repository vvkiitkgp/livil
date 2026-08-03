/**
 * Layout constants that screens need for content insets.
 *
 * These live here rather than on the components that own them so a screen can
 * reserve space for the floating player without importing the player itself —
 * `FloatingPlayer` pulls in AsyncStorage, Reanimated, gesture-handler and the
 * playback context, which is a lot of module graph to drag into a screen (and
 * into that screen's tests) for one number.
 *
 * `FloatingPlayer` re-exports FLOATING_PLAYER_HEIGHT from here, so existing
 * importers keep working and there is still exactly one definition.
 */

/** Diameter of the floating player's circle. */
export const FLOATING_PLAYER_HEIGHT = 60;
