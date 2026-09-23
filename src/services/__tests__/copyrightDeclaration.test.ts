/**
 * The rights declaration — shaping and completeness.
 *
 * These two functions decide what reaches `track_copyright_scans`, and both of their
 * failure modes are quiet. `rowForDeclaration` writing a field from a path the uploader
 * did not take produces a row the database refuses, which the creator sees as an opaque
 * failure after filling a form. `isDeclarationComplete` disagreeing with the database
 * constraint produces the same thing one step earlier.
 *
 * So the property under test is agreement with `track_copyright_scans_claim_shape` and
 * `track_copyright_scans_claim_fields_match_path` in
 * supabase/migrations/20260923000000_copyright_claim_details.sql. If that constraint
 * changes and this file does not, these tests are the thing that should go red.
 */
import {
  isDeclarationComplete,
  rowForDeclaration,
  type RightsDeclaration,
} from '../../../shared/services/copyrightScan';

/** Both boxes ticked — the baseline every non-cancelled claim now needs. */
const CONSENT = { acceptedResponsibility: true, grantedStreamingLicence: true } as const;

describe('consent', () => {
  it('refuses a claim with neither box ticked', () => {
    expect(isDeclarationComplete({ acknowledgement: 'self_recorded' })).toBe(false);
  });

  it('refuses a claim with only one box ticked', () => {
    expect(
      isDeclarationComplete({ acknowledgement: 'self_recorded', acceptedResponsibility: true }),
    ).toBe(false);
    expect(
      isDeclarationComplete({ acknowledgement: 'self_recorded', grantedStreamingLicence: true }),
    ).toBe(false);
  });

  it('exempts a cancellation — nobody backing out is granting anything', () => {
    expect(isDeclarationComplete({ acknowledgement: 'cancelled' })).toBe(true);
  });

  it('records a cancellation as null, not false', () => {
    // A stored `false` would read as a refusal the person never actually made.
    const row = rowForDeclaration({ acknowledgement: 'cancelled' });
    expect(row.accepted_responsibility).toBeNull();
    expect(row.granted_streaming_licence).toBeNull();
  });

  it('writes both boxes on every real answer', () => {
    const row = rowForDeclaration({ acknowledgement: 'self_recorded', ...CONSENT });
    expect(row.accepted_responsibility).toBe(true);
    expect(row.granted_streaming_licence).toBe(true);
  });

  it('never writes true for a box that was not ticked', () => {
    const row = rowForDeclaration({ acknowledgement: 'self_recorded' });
    expect(row.accepted_responsibility).toBe(false);
    expect(row.granted_streaming_licence).toBe(false);
  });
});

describe('isDeclarationComplete', () => {
  it('requires a basis for an ownership claim', () => {
    expect(isDeclarationComplete({ acknowledgement: 'owner', ...CONSENT })).toBe(false);
    expect(
      isDeclarationComplete({ acknowledgement: 'owner', basis: 'assigned', ...CONSENT }),
    ).toBe(true);
  });

  it('requires a grantor AND at least one scope for a permission claim', () => {
    expect(isDeclarationComplete({ acknowledgement: 'permission', ...CONSENT })).toBe(false);
    expect(
      isDeclarationComplete({ acknowledgement: 'permission', grantor: 'Saregama', ...CONSENT }),
    ).toBe(false);
    expect(
      isDeclarationComplete({ acknowledgement: 'permission', scope: ['streaming'], ...CONSENT }),
    ).toBe(false);
    expect(
      isDeclarationComplete({
        acknowledgement: 'permission',
        grantor: 'Saregama',
        scope: ['streaming'],
        ...CONSENT,
      }),
    ).toBe(true);
  });

  it('treats a whitespace-only grantor as absent', () => {
    expect(
      isDeclarationComplete({
        acknowledgement: 'permission',
        grantor: '   ',
        scope: ['ugc'],
        ...CONSENT,
      }),
    ).toBe(false);
  });

  it('asks nothing of a self-recorded or disputed claim', () => {
    // A bedroom artist has no label, no registration, no distributor and no ISRC, and can
    // still legitimately own their recording. Demanding paperwork here would block the
    // people Livil exists for while stopping nobody determined.
    expect(isDeclarationComplete({ acknowledgement: 'self_recorded', ...CONSENT })).toBe(true);
    expect(isDeclarationComplete({ acknowledgement: 'disputed', ...CONSENT })).toBe(true);
    expect(isDeclarationComplete({ acknowledgement: 'cancelled' })).toBe(true);
  });
});

describe('rowForDeclaration', () => {
  it('keeps ownership fields off a permission claim, and vice versa', () => {
    // The database refuses a row carrying both, so a form that switched paths and kept a
    // stale value would have its write rejected outright.
    const owner = rowForDeclaration({
      acknowledgement: 'owner',
      basis: 'assigned',
      grantor: 'left over from the other path',
      scope: ['streaming'],
      territory: 'India',
      term: '2 years',
    });
    expect(owner.claim_basis).toBe('assigned');
    expect(owner.claim_grantor).toBeNull();
    expect(owner.claim_scope).toBeNull();
    expect(owner.claim_territory).toBeNull();
    expect(owner.claim_term).toBeNull();

    const permission = rowForDeclaration({
      acknowledgement: 'permission',
      basis: 'assigned',
      grantor: 'Saregama',
      scope: ['streaming', 'ugc'],
    });
    expect(permission.claim_basis).toBeNull();
    expect(permission.claim_grantor).toBe('Saregama');
    expect(permission.claim_scope).toEqual(['streaming', 'ugc']);
  });

  it('accepts a reference on every path, because identification is not a claim type', () => {
    // A disputed match is usually argued with "here is the reference for MY recording".
    for (const ack of ['owner', 'permission', 'self_recorded', 'disputed'] as const) {
      const row = rowForDeclaration({
        acknowledgement: ack,
        basis: 'assigned',
        grantor: 'x',
        scope: ['streaming'],
        reference: 'INH102506955',
      });
      expect(row.claim_reference).toBe('INH102506955');
    }
  });

  it('turns blank optional fields into null rather than empty strings', () => {
    const row = rowForDeclaration({
      acknowledgement: 'self_recorded',
      reference: '   ',
      note: '',
    });
    expect(row.claim_reference).toBeNull();
    expect(row.claim_note).toBeNull();
  });

  it('drops an empty scope array to null so the constraint sees "absent"', () => {
    // `array_length(claim_scope, 1) >= 1` is the database's test; an empty array would
    // satisfy "not null" and fail the length check, which is a worse error to debug.
    const row = rowForDeclaration({ acknowledgement: 'permission', grantor: 'x', scope: [] });
    expect(row.claim_scope).toBeNull();
  });

  it('writes every claim column on every path, so no stale value survives', () => {
    // The row is an UPDATE. A column omitted here keeps whatever was there before.
    const row = rowForDeclaration({ acknowledgement: 'disputed' });
    for (const col of [
      'claim_basis',
      'claim_grantor',
      'claim_scope',
      'claim_territory',
      'claim_term',
      'claim_reference',
      'claim_note',
    ]) {
      expect(Object.prototype.hasOwnProperty.call(row, col)).toBe(true);
    }
  });

  it('agrees with the database on what a complete claim looks like', () => {
    // Belt and braces: anything this says is complete must also produce a row the
    // constraint would accept.
    const complete: RightsDeclaration[] = [
      { acknowledgement: 'owner', basis: 'assigned', ...CONSENT },
      { acknowledgement: 'permission', grantor: 'Saregama', scope: ['ugc'], ...CONSENT },
      { acknowledgement: 'self_recorded', ...CONSENT },
      { acknowledgement: 'disputed', ...CONSENT },
    ];
    for (const d of complete) {
      expect(isDeclarationComplete(d)).toBe(true);
      const row = rowForDeclaration(d);
      if (d.acknowledgement === 'owner') expect(row.claim_basis).not.toBeNull();
      if (d.acknowledgement === 'permission') {
        expect(row.claim_grantor).not.toBeNull();
        expect(row.claim_scope).not.toBeNull();
      }
    }
  });
});
