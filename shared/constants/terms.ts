/**
 * The published Terms version, shared by both clients.
 *
 * Generated into `src/constants/termsContent.ts` by `scripts/generate-terms.mjs`, which
 * hashes `docs/terms.html` — that file stays the source of truth. This re-export exists
 * so the web studio records the SAME version string as the phone without either app
 * reaching into the other's constants, and without the value being typed twice.
 *
 * When the generator bumps the version, this follows automatically.
 */
export { TERMS_VERSION } from '../../src/constants/termsContent';
