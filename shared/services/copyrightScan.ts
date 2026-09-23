/**
 * Copyright scan — ask the server whether an upload matches a known recording, and
 * record what the uploader says when told.
 *
 * Lives in `shared/` because BOTH clients upload. Mobile's `createTrack` and the web
 * dashboard's `publishTrack` are separate implementations of the same choreography, and
 * a check written into only one of them is a check the other route walks past.
 *
 * ── WHY THE CLIENT IS A PARAMETER AND NOT `livil()` ─────────────────────────
 *
 * Every other service in this directory resolves its client through
 * `configureLivilClient()`. THE MOBILE APP HAS NEVER CALLED THAT AT RUNTIME — only
 * `web/src/supabase.ts:42` does — so a `livil()` call here would throw on the phone the
 * first time a creator uploaded. `src/services/teamMessages.ts` hit the same wall and
 * resolved it by duplicating the logic into mobile.
 *
 * Duplication is the wrong answer HERE specifically, because the entire purpose of this
 * file is that the two upload paths cannot diverge — a second copy would reintroduce the
 * exact drift it exists to prevent. Taking the client as an argument keeps one
 * implementation, needs no process-wide startup wiring, and makes every function
 * trivially testable with a stub.
 *
 * ── WHAT A MATCH MEANS, AND WHAT IT DOES NOT ────────────────────────────────
 *
 * A match means the audio resembles a registered commercial recording. It does NOT mean
 * the uploader lacks the right to post it — no recognition provider can answer that,
 * because authorisation is a contract between an artist and a rights holder and lives in
 * nobody's database. So nothing here blocks a publish. It asks a question and stores the
 * answer.
 *
 * COVERS DO NOT MATCH, and that is the point. Fingerprinting identifies one specific
 * master recording; a cover is a different recording. Livil supports covers as
 * first-class uploads, so a creator covering a song sails straight through while
 * somebody posting a downloaded commercial track does not.
 *
 * ── FAIL-SAFE, AND WHY THAT IS NOT FAIL-SILENT ──────────────────────────────
 *
 * Every function here resolves rather than throwing. A provider outage, a timeout, or an
 * undeployed edge function must never cost a legitimate creator their upload.
 *
 * What it must NOT do is look clean. A failure resolves to `status: 'failed'`, never to
 * "no match", and the server records the same distinction. If those ever collapse, an
 * outage silently issues a clean bill of health to every upload made during it. That is
 * the one property in this file worth protecting.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Any Supabase client. Deliberately not `LivilClient`: mobile's client is typed against
 * its own generated `Database` and web's against `shared/types/database`, and pinning
 * one here would make the other a type error at the call site for no behavioural gain.
 */
// deno-lint-ignore no-explicit-any
export type ScanClient = SupabaseClient<any, any, any>;

/** Nothing matched, we could not tell, or we did not ask. */
export type ScanStatus = 'complete' | 'failed' | 'skipped';

export type ScanResult = {
  status: ScanStatus;
  /** `null` whenever status is not 'complete' — we do not know, and must not guess. */
  matchFound: boolean | null;
  title?: string | null;
  artist?: string | null;
  isrc?: string | null;
};

/**
 * What the uploader said when shown a match.
 *
 * `disputed` is the one that is easy to leave out and expensive to omit. Fingerprinting
 * produces false positives — covers, remixes, live takes, sampled material, thin regional
 * catalogue coverage — and without this option a creator whose OWN work was wrongly
 * matched must either abandon a legitimate upload or click a claim that is not quite
 * true. The second poisons every other row in the table.
 */
export type Acknowledgement =
  /** I made this recording myself. A cover counts — the RECORDING is mine. */
  | 'self_recorded'
  /** I hold the rights but did not make it. */
  | 'owner'
  /** Somebody else owns it and licensed or authorised me. */
  | 'permission'
  /** I think this match is wrong. */
  | 'disputed'
  /** Backed out of the upload. */
  | 'cancelled';

/**
 * How the rights reached someone who did NOT make the recording.
 *
 * No 'created' value on purpose: "I made it" is its own top-level answer, and offering it
 * here as well made two paths mean the same thing.
 */
export type ClaimBasis = 'assigned' | 'company' | 'other';

/**
 * What a claimed licence covers.
 *
 * Asked because a grant that excludes streaming, or excludes user-generated-content
 * platforms, does not authorise the upload — and that is invisible unless you ask.
 */
export type ClaimScope =
  | 'streaming'
  | 'ugc'
  | 'online_distribution'
  | 'commercial'
  | 'other';

/**
 * The declaration, as the uploader gives it.
 *
 * Every field beyond `acknowledgement` is optional HERE and constrained in the DATABASE:
 * `owner` needs a basis, `permission` needs a grantor and at least one scope, and
 * `self_recorded` and `disputed` need nothing at all. Two clients write this table, so a
 * rule enforced only in a form is enforced on one of them at best.
 *
 * `reference` is IDENTIFICATION, never proof. An ISRC names a recording and says nothing
 * about who may distribute it, and for any charting track it is public. It is friction —
 * a real licensee has it on their paperwork — and a cross-check against what the provider
 * matched. Nothing more.
 */
export type RightsDeclaration = {
  acknowledgement: Acknowledgement;
  /**
   * Both REQUIRED (and enforced by a database constraint) on every answer but
   * `cancelled`. They are ticked, not merely displayed: a sentence the reader cannot
   * decline is not a sentence they accepted, and nothing recorded that they had even
   * seen it.
   *
   * The streaming grant is a per-upload reaffirmation of the licence Terms §2 already
   * takes at signup — asked again here because this particular track matched a
   * commercial recording, and "they confirmed it on this track, on this date" is a
   * different strength of evidence from "they accepted the terms two years ago".
   */
  acceptedResponsibility?: boolean;
  grantedStreamingLicence?: boolean;
  basis?: ClaimBasis | null;
  grantor?: string | null;
  scope?: ClaimScope[] | null;
  territory?: string | null;
  term?: string | null;
  reference?: string | null;
  note?: string | null;
};

/** How long we wait before letting the upload proceed unchecked. */
export const SCAN_TIMEOUT_MS = 20_000;

const FAILED: ScanResult = { status: 'failed', matchFound: null };

/**
 * Scan a finished upload.
 *
 * Call AFTER the media is at its final URL — the server hands the provider that URL, so
 * a track still holding its `pending://` placeholder has nothing to scan.
 *
 * Never throws. A caller that wants to know something went wrong reads `status`.
 */
export async function scanUpload(db: ScanClient, trackId: string): Promise<ScanResult> {
  if (!trackId) return FAILED;

  try {
    const settled = await withTimeout(
      db.functions.invoke('scan-upload', { body: { trackId } }),
      SCAN_TIMEOUT_MS,
    );
    if (!settled) return FAILED;

    // `functions.invoke` RETURNS `{ data, error }` rather than throwing — the trap
    // ADR-0008 found had left push dispatch silently dead for months. The `error` must
    // be checked explicitly; a try/catch around this call alone would never fire.
    const { data, error } = settled as { data: unknown; error: unknown };
    if (error || !data) return FAILED;

    return normalize(data);
  } catch {
    return FAILED;
  }
}

/**
 * Record what the uploader said when shown a match.
 *
 * Writes only the acknowledgement: a database trigger refuses any attempt to touch the
 * provider's half of the row, and refuses to overwrite an answer already given. It also
 * pins `acknowledged_at` and `acknowledged_by` server-side, so the "when" and the "who"
 * are not asserted by the device.
 *
 * Returns whether it landed. A caller must NOT block the upload on `false` — but it is
 * worth logging, because this is the half of the feature with evidential value.
 */
export async function acknowledgeScan(
  db: ScanClient,
  trackId: string,
  declaration: Acknowledgement | RightsDeclaration,
): Promise<boolean> {
  if (!trackId) return false;
  const d: RightsDeclaration =
    typeof declaration === 'string' ? { acknowledgement: declaration } : declaration;
  try {
    const { error } = await db
      .from('track_copyright_scans')
      .update(rowForDeclaration(d))
      .eq('track_id', trackId);
    return !error;
  } catch {
    return false;
  }
}

/**
 * Declaration → column payload.
 *
 * Fields from a path the uploader did NOT take are written as null rather than omitted.
 * A database constraint refuses a grantor on an ownership claim, so a form that switched
 * paths and kept a stale value would have its write rejected outright — and the uploader
 * would see an opaque failure instead of their answer landing.
 */
export function rowForDeclaration(d: RightsDeclaration): Record<string, unknown> {
  const owner = d.acknowledgement === 'owner';
  const permission = d.acknowledgement === 'permission';
  const cancelled = d.acknowledgement === 'cancelled';
  return {
    acknowledgement: d.acknowledgement,
    // Null rather than false when cancelling: nobody backing out of an upload is being
    // asked to grant anything, and a stored `false` would read as a refusal they never
    // made.
    accepted_responsibility: cancelled ? null : d.acceptedResponsibility === true,
    granted_streaming_licence: cancelled ? null : d.grantedStreamingLicence === true,
    claim_basis: owner ? d.basis ?? null : null,
    claim_grantor: permission ? trim(d.grantor) : null,
    claim_scope: permission && d.scope && d.scope.length > 0 ? d.scope : null,
    claim_territory: permission ? trim(d.territory) : null,
    claim_term: permission ? trim(d.term) : null,
    // Identification is accepted on every path — a disputed match is often argued with
    // "here is the reference for MY recording".
    claim_reference: trim(d.reference),
    claim_note: trim(d.note),
  };
}

/** Empty strings become null: a blank optional field is absent, not present-and-empty. */
function trim(v: string | null | undefined): string | null {
  const t = (v ?? '').trim();
  return t.length > 0 ? t : null;
}

/**
 * Is this declaration complete enough for the database to accept it?
 *
 * Mirrors `track_copyright_scans_claim_shape`. Duplicated deliberately: the constraint is
 * the enforcement, this is only so the form can disable its own submit button rather than
 * letting someone fill a page and meet a rejection.
 */
export function isDeclarationComplete(d: RightsDeclaration): boolean {
  if (d.acknowledgement === 'cancelled') return true;

  // Both boxes, on every path. Checked before the path-specific rules so a form can say
  // "tick these" rather than leaving someone hunting for what is missing.
  if (d.acceptedResponsibility !== true || d.grantedStreamingLicence !== true) return false;

  if (d.acknowledgement === 'owner') return !!d.basis;
  if (d.acknowledgement === 'permission') {
    return !!(d.grantor ?? '').trim() && !!d.scope && d.scope.length > 0;
  }
  return true;
}

/**
 * The stored result for a track, if there is one.
 *
 * Row level security scopes this to the uploader, so a caller can only read their own.
 */
export async function getScan(db: ScanClient, trackId: string): Promise<ScanResult | null> {
  if (!trackId) return null;
  try {
    const { data, error } = await db
      .from('track_copyright_scans')
      .select('status, match_found, matched_title, matched_artist, matched_isrc')
      .eq('track_id', trackId)
      .maybeSingle();
    if (error || !data) return null;
    const row = data as Record<string, unknown>;
    return {
      status: asStatus(row.status),
      matchFound: typeof row.match_found === 'boolean' ? row.match_found : null,
      title: str(row.matched_title),
      artist: str(row.matched_artist),
      isrc: str(row.matched_isrc),
    };
  } catch {
    return null;
  }
}

/** True when the uploader must be asked a question before this upload is done. */
export function needsAcknowledgement(result: ScanResult | null): boolean {
  return result?.status === 'complete' && result.matchFound === true;
}

/**
 * Human-readable subject of a match, for the warning copy.
 *
 * Both fields are provider-supplied and either can be missing, so this never assembles a
 * half-empty string like `“” by Arijit Singh`.
 */
export function describeMatch(result: ScanResult | null): string {
  const title = result?.title?.trim();
  const artist = result?.artist?.trim();
  if (title && artist) return `“${title}” by ${artist}`;
  if (title) return `“${title}”`;
  if (artist) return `a recording by ${artist}`;
  return 'an existing commercial recording';
}

// ── internals ───────────────────────────────────────────────────────────────

function normalize(data: unknown): ScanResult {
  const d = (data ?? {}) as Record<string, unknown>;
  const status = asStatus(d.status);
  if (status !== 'complete') return { status, matchFound: null };
  return {
    status,
    matchFound: d.matchFound === true,
    title: str(d.title),
    artist: str(d.artist),
    isrc: str(d.isrc),
  };
}

/** Anything unrecognised degrades to 'failed' — never to a clean 'complete'. */
function asStatus(v: unknown): ScanStatus {
  return v === 'complete' || v === 'skipped' ? v : 'failed';
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/**
 * Resolve to null rather than hanging forever.
 *
 * The upload is blocked on this call, and a provider that never answers would otherwise
 * leave a creator staring at a spinner with no way out.
 */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve(null), ms);
    Promise.resolve(p)
      .then(v => {
        clearTimeout(timer);
        resolve(v);
      })
      .catch(() => {
        clearTimeout(timer);
        resolve(null);
      });
  });
}
