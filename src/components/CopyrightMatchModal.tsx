import React, { useCallback, useMemo, useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { COLORS } from '../theme/colors';
import { Button } from './Button';
import { Icon } from './Icon';
import FormInput from './FormInput';
import { Choice } from './Choice';
import {
  isDeclarationComplete,
  type Acknowledgement,
  type ClaimBasis,
  type ClaimScope,
  type RightsDeclaration,
} from '../../shared/services/copyrightScan';

type Props = {
  visible: boolean;
  /** What was matched, already formatted — see `describeMatch`. */
  matchDescription: string;
  busy?: boolean;
  onAnswer: (declaration: RightsDeclaration) => void;
};

/**
 * Shown when an upload matches a known commercial recording.
 *
 * NOT `ConfirmActionModal`, which offers one action and a dismiss. This is a question
 * with four real answers and, on two of them, a follow-up — collapsing that would throw
 * away the distinction the stored record exists to hold. Built in the same visual
 * language, per CLAUDE.md's rule that a bespoke modal match the house template.
 *
 * ── THE FOURTH OPTION IS THE ONE THAT MATTERS ───────────────────────────────
 *
 * "I think this match is wrong" exists because fingerprinting produces false positives —
 * covers, remixes, live takes, sampled material, thin regional catalogue coverage.
 * Without it, a creator whose OWN work was wrongly matched must either abandon a
 * legitimate upload or click a claim that is not quite true. The second is worse: it
 * quietly devalues every honest row in the table.
 *
 * ── THE COPY IS DELIBERATELY NOT ACCUSATORY ─────────────────────────────────
 *
 * A fingerprint match is NOT evidence of infringement. It says the audio resembles a
 * registered recording, and the uploader may own it, hold a licence, or be the artist.
 * Livil is built for small local creators, and telling one of them they look like a thief
 * because a machine matched a waveform is how you lose the people the platform is for.
 *
 * So: "we found a possible match", not "this is copyrighted". The one firm sentence is
 * about responsibility, which is true whatever the answer.
 *
 * ── NOTHING HERE IS PROOF, AND NOTHING HERE BLOCKS ──────────────────────────
 *
 * The reference field takes an ISRC or catalogue number. That IDENTIFIES a recording; it
 * says nothing about who may distribute it, and for any charting track it is public. It
 * is friction — a real licensee has it on their paperwork — and a cross-check. Never a
 * credential, and the label must never imply otherwise.
 *
 * The declaration is recorded and the track publishes either way. Livil cannot hold an
 * upload pending review (ADR-0017 §D), and pretending otherwise in this UI would promise
 * something the architecture cannot deliver.
 */
export default function CopyrightMatchModal({
  visible,
  matchDescription,
  busy = false,
  onAnswer,
}: Props) {
  const [choice, setChoice] = useState<Acknowledgement | null>(null);
  const [basis, setBasis] = useState<ClaimBasis | null>(null);
  const [grantor, setGrantor] = useState('');
  const [scope, setScope] = useState<ClaimScope[]>([]);
  const [territory, setTerritory] = useState('');
  const [term, setTerm] = useState('');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [responsible, setResponsible] = useState(false);
  const [licence, setLicence] = useState(false);

  const declaration = useMemo<RightsDeclaration | null>(
    () =>
      choice
        ? {
            acknowledgement: choice,
            acceptedResponsibility: responsible,
            grantedStreamingLicence: licence,
            basis, grantor, scope, territory, term, reference, note,
          }
        : null,
    [choice, responsible, licence, basis, grantor, scope, territory, term, reference, note],
  );

  const toggleScope = useCallback((s: ClaimScope) => {
    setScope(prev => (prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]));
  }, []);

  const reset = useCallback(() => {
    setChoice(null);
    setBasis(null);
    setGrantor('');
    setScope([]);
    setTerritory('');
    setTerm('');
    setReference('');
    setNote('');
    setResponsible(false);
    setLicence(false);
  }, []);

  const submit = useCallback(() => {
    if (declaration) { onAnswer(declaration); }
  }, [declaration, onAnswer]);

  const cancel = useCallback(() => {
    reset();
    onAnswer({ acknowledgement: 'cancelled' });
  }, [onAnswer, reset]);

  const ready = declaration !== null && isDeclarationComplete(declaration);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      // No dismiss-by-back. Every route out of this modal is an answer that gets
      // recorded; a silent dismissal would publish with no record of the question ever
      // having been asked, which is the one outcome worth preventing.
      onRequestClose={undefined}
    >
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.iconWrap}>
            <View style={styles.iconCircle}>
              <Icon name="warningTriangle" size={26} color={COLORS.purpleLight} weight="fill" />
            </View>
          </View>

          <Text style={styles.title}>We found a possible match</Text>
          <Text style={styles.subtitle}>
            This sounds like {matchDescription}. That does not always mean there is a
            problem. What is your right to upload this recording?
          </Text>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollBody}
            keyboardShouldPersistTaps="handled"
          >
            {/* Most common legitimate case first, and it asks for nothing — a local
                creator posting their own song or cover taps once and is done. */}
            <Choice
              label="I made this recording myself"
              hint="I performed and recorded it, including a cover of someone else's song"
              selected={choice === 'self_recorded'}
              onPress={() => setChoice('self_recorded')}
            />
            <Choice
              label="I hold the rights another way"
              hint="I did not make it, but the rights are mine"
              selected={choice === 'owner'}
              onPress={() => setChoice('owner')}
            />
            <Choice
              label="I have permission or a licence"
              hint="Someone else owns it and authorised me"
              selected={choice === 'permission'}
              onPress={() => setChoice('permission')}
            />
            <Choice
              label="I think this match is wrong"
              hint="This is not the recording it says it is"
              selected={choice === 'disputed'}
              onPress={() => setChoice('disputed')}
            />

            {choice === 'owner' ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>How did you get the rights?</Text>
                <Choice label="They were assigned or transferred to me" selected={basis === 'assigned'} onPress={() => setBasis('assigned')} compact />
                <Choice label="My company or label owns them" selected={basis === 'company'} onPress={() => setBasis('company')} compact />
                <Choice label="Something else" selected={basis === 'other'} onPress={() => setBasis('other')} compact />
              </View>
            ) : null}

            {choice === 'permission' ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Who gave you permission?</Text>
                <FormInput
                  value={grantor}
                  onChangeText={setGrantor}
                  placeholder="Label, artist or distributor"
                  placeholderTextColor={COLORS.textSecondary}
                />

                <Text style={[styles.sectionTitle, styles.sectionGap]}>What does it cover?</Text>
                {/* A licence that excludes streaming, or excludes user-generated-content
                    platforms, does not authorise this upload — and that stays invisible
                    unless somebody asks. */}
                <Choice label="Streaming" selected={scope.includes('streaming')} onPress={() => toggleScope('streaming')} compact shape="checkbox" />
                <Choice label="User-generated-content platforms" selected={scope.includes('ugc')} onPress={() => toggleScope('ugc')} compact shape="checkbox" />
                <Choice label="Online distribution" selected={scope.includes('online_distribution')} onPress={() => toggleScope('online_distribution')} compact shape="checkbox" />
                <Choice label="Commercial use" selected={scope.includes('commercial')} onPress={() => toggleScope('commercial')} compact shape="checkbox" />
                <Choice label="Something else" selected={scope.includes('other')} onPress={() => toggleScope('other')} compact shape="checkbox" />

                <Text style={[styles.sectionTitle, styles.sectionGap]}>Territory (optional)</Text>
                <FormInput
                  value={territory}
                  onChangeText={setTerritory}
                  placeholder="Worldwide, India, …"
                  placeholderTextColor={COLORS.textSecondary}
                />

                <Text style={[styles.sectionTitle, styles.sectionGap]}>Dates (optional)</Text>
                <FormInput
                  value={term}
                  onChangeText={setTerm}
                  placeholder="From / until, or how long it runs"
                  placeholderTextColor={COLORS.textSecondary}
                />
              </View>
            ) : null}

            {choice !== null ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Reference number (optional)</Text>
                <FormInput
                  value={reference}
                  onChangeText={setReference}
                  placeholder="ISRC, UPC or catalogue number"
                  placeholderTextColor={COLORS.textSecondary}
                  autoCapitalize="characters"
                />
                <Text style={styles.help}>
                  This identifies the recording. It does not prove who may distribute it —
                  it just helps us check we are talking about the same track.
                </Text>

                <Text style={[styles.sectionTitle, styles.sectionGap]}>
                  Anything else we should know? (optional)
                </Text>
                <FormInput
                  value={note}
                  onChangeText={setNote}
                  placeholder="Restrictions, context, or why you think the match is wrong"
                  placeholderTextColor={COLORS.textSecondary}
                  multiline
                />
              </View>
            ) : null}
          </ScrollView>

          {/* Ticked, not merely shown. The previous version displayed the responsibility
              line as text nobody could decline, and recorded nothing about whether they
              had even seen it. */}
          {choice !== null && choice !== 'cancelled' ? (
            <View style={styles.consent}>
              <Choice
                label="I am responsible for what I upload to Livil"
                selected={responsible}
                onPress={() => setResponsible(v => !v)}
                compact
                shape="checkbox"
              />
              <Choice
                label="I grant Livil permission to stream this recording in the app"
                selected={licence}
                onPress={() => setLicence(v => !v)}
                compact
                shape="checkbox"
              />
            </View>
          ) : null}

          <Button
            label="Submit and publish"
            onPress={submit}
            variant="primary"
            size="md"
            busy={busy}
            disabled={!ready}
            fullWidth
          />
          <Button
            label="Cancel this upload"
            onPress={cancel}
            variant="ghost"
            size="md"
            disabled={busy}
            fullWidth
            style={styles.stacked}
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 32,
  },
  card: {
    width: '100%',
    maxWidth: 380,
    maxHeight: '100%',
    backgroundColor: COLORS.surface,
    borderRadius: 20,
    paddingHorizontal: 22,
    paddingTop: 24,
    paddingBottom: 18,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  iconWrap: { alignItems: 'center', marginBottom: 14 },
  iconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.purpleDim,
    borderColor: COLORS.purple,
  },
  title: {
    color: COLORS.white,
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 6,
  },
  subtitle: {
    color: COLORS.textSecondary,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    paddingHorizontal: 4,
  },
  // Bounded so a long permission form scrolls inside the card instead of pushing the
  // buttons off a small screen.
  scroll: { marginTop: 16, maxHeight: 340 },
  scrollBody: { paddingBottom: 4, gap: 8 },
  section: { marginTop: 8, gap: 8 },
  sectionTitle: { color: COLORS.white, fontSize: 13, fontWeight: '700' },
  sectionGap: { marginTop: 8 },
  help: { color: COLORS.textSecondary, fontSize: 12, lineHeight: 16 },
  consent: { marginTop: 14, marginBottom: 14, gap: 6 },
  notice: {
    marginTop: 16,
    marginBottom: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  noticeText: {
    color: COLORS.white,
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
    fontWeight: '600',
  },
  stacked: { marginTop: 10 },
});
