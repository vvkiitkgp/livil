/**
 * Design tokens, re-exported for both clients.
 *
 * `src/theme/colors.ts` remains the single source of truth — it is a plain object with no
 * React Native imports, so the web bundle can consume it directly. It is re-exported here
 * rather than imported across the app boundary so that `web/` never reaches into `src/`,
 * and so that relocating the tokens later touches only this file.
 *
 * `src/theme/**` is not an agent-writable path, which is the other reason this is a shim
 * and not a move.
 */
export { COLORS } from '../../src/theme/colors';
