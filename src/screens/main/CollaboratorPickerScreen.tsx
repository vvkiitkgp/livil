import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Keyboard,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import FormInput from '../../components/FormInput';
import AddBadge from '../../components/AddBadge';
import { COLORS } from '../../theme/colors';
import type { RootStackParamList } from '../../navigation/types';
import { AI_ROLES, ROLES, isPresetRole, type PendingCollaborator } from '../../constants/roles';
import { searchProfiles, type ProfileSearchResult } from '../../services/tracks';
import { emitCollaboratorPicked } from '../../services/uploadEvents';
import { Icon } from '../../components/Icon';
import { Button } from '../../components/Button';
import { GradientBorder } from '../../components/GradientBorder';

type PickerRoute = RouteProp<RootStackParamList, 'CollaboratorPicker'>;
type PickerNavigation = NativeStackNavigationProp<RootStackParamList, 'CollaboratorPicker'>;

type Mode = 'user' | 'custom';

/** Results shown before asking the artist to narrow the search — see the page ScrollView. */
const RESULT_LIMIT = 6;

function clientIdFor(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) {return '?';}
  if (parts.length === 1) {return parts[0].slice(0, 2).toUpperCase();}
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default function CollaboratorPickerScreen() {
  const navigation = useNavigation<PickerNavigation>();
  const route = useRoute<PickerRoute>();
  const takenRoleKeys = useMemo(
    () => new Set(route.params?.takenRoleKeys ?? []),
    [route.params?.takenRoleKeys],
  );

  const [mode, setMode] = useState<Mode>('user');
  const [query, setQuery] = useState('');
  const [customName, setCustomName] = useState('');
  const [selectedUser, setSelectedUser] = useState<ProfileSearchResult | null>(null);
  const [role, setRole] = useState<string>('');

  const pageRef = useRef<ScrollView>(null);
  /** Ref, not state: the keyboard listener must not resubscribe on every focus change. */
  const customRoleFocused = useRef(false);
  const [results, setResults] = useState<ProfileSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (mode !== 'user') {return;}
    let cancelled = false;
    setSearching(true);
    setError('');
    const t = setTimeout(async () => {
      try {
        const data = await searchProfiles(query);
        if (!cancelled) {setResults(data);}
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Search failed.');
        }
      } finally {
        if (!cancelled) {setSearching(false);}
      }
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query, mode]);

  /** Key for the person currently being credited, matching what UploadScreen sent. */
  const subjectKey = useMemo(() => {
    if (mode === 'user') {return selectedUser ? selectedUser.id : null;}
    const typed = customName.trim().toLowerCase();
    return typed ? `custom:${typed}` : null;
  }, [mode, selectedUser, customName]);

  /** Roles this person already holds on the track — greyed out, not hidden. */
  const isRoleTaken = useCallback(
    (r: string) => (subjectKey ? takenRoleKeys.has(`${subjectKey}|${r}`) : false),
    [subjectKey, takenRoleKeys],
  );

  /*
   * Lift the custom-role field clear of the keyboard.
   *
   * It sits at the very bottom of a long page, so the keyboard opens straight over it and
   * you cannot see what you are typing. Driven by `keyboardDidShow` rather than the
   * field's own `onFocus`: `adjustResize` re-lays-out the page when the keyboard appears,
   * and a scroll issued on focus is computed against the PRE-keyboard height and then
   * clamped, which is why the timed version still left the field hidden. `didShow` fires
   * after the resize, so the scroll target is real.
   */
  useEffect(() => {
    const sub = Keyboard.addListener('keyboardDidShow', () => {
      if (customRoleFocused.current) {
        pageRef.current?.scrollToEnd({ animated: true });
      }
    });
    return () => sub.remove();
  }, []);

  const canConfirm = useMemo(() => {
    const hasTarget =
      (mode === 'user' && !!selectedUser) ||
      (mode === 'custom' && customName.trim().length > 0);
    return hasTarget && role.trim().length > 0 && !isRoleTaken(role.trim());
  }, [mode, selectedUser, customName, role, isRoleTaken]);

  const handleConfirm = useCallback(() => {
    if (!canConfirm) {return;}
    let collaborator: PendingCollaborator;
    if (mode === 'user' && selectedUser) {
      collaborator = {
        clientId: clientIdFor(),
        kind: 'user',
        userId: selectedUser.id,
        name: selectedUser.displayName ?? selectedUser.username,
        username: selectedUser.username,
        avatarUrl: selectedUser.avatarUrl ?? undefined,
        role: role.trim(),
      };
    } else {
      collaborator = {
        clientId: clientIdFor(),
        kind: 'custom',
        name: customName.trim(),
        role: role.trim(),
      };
    }
    emitCollaboratorPicked(collaborator);
    navigation.goBack();
  }, [canConfirm, mode, selectedUser, customName, role, navigation]);

  const switchMode = useCallback((next: Mode) => {
    setMode(next);
    setSelectedUser(null);
    setCustomName('');
  }, []);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          activeOpacity={0.7}
          style={styles.headerSide}
        >
          <Text style={styles.headerCancel}>Cancel</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Add collaborator</Text>
        <View style={styles.headerSide} />
      </View>

      {/*
        * One scroll surface for the whole page.
        *
        * The results used to be their own ScrollView inside a flex:1 column, which worked
        * only while the role picker was short. Adding the AI group pushed the role section
        * past the fold and squeezed the results down to a single half-visible row — a list
        * you cannot see is a picker you cannot use. Nesting a second vertical ScrollView
        * would fight this one for the gesture, so the results are plain rows now and the
        * page scrolls as a whole.
        */}
      <ScrollView
        ref={pageRef}
        style={styles.flex}
        contentContainerStyle={styles.pageContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.modeToggle}>
          <TouchableOpacity
            style={styles.modePill}
            activeOpacity={0.85}
            onPress={() => switchMode('user')}
          >
            {mode === 'user' ? <GradientBorder borderRadius={999} /> : null}
            <Text style={[styles.modePillText, mode === 'user' && styles.modePillTextActive]}>
              Find on Livil
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.modePill}
            activeOpacity={0.85}
            onPress={() => switchMode('custom')}
          >
            {mode === 'custom' ? <GradientBorder borderRadius={999} /> : null}
            <Text style={[styles.modePillText, mode === 'custom' && styles.modePillTextActive]}>
              Custom name
            </Text>
          </TouchableOpacity>
        </View>

        {mode === 'user' ? (
          <View style={styles.searchSection}>
            <FormInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search by username or name"
              autoCapitalize="none"
              autoCorrect={false}
            />
            {error ? <Text style={styles.errorText}>{error}</Text> : null}
            <View style={styles.resultsContent}>
              {searching ? (
                <View style={styles.resultsLoading}>
                  <ActivityIndicator color={COLORS.purpleLight} />
                </View>
              ) : results.length === 0 ? (
                <Text style={styles.emptyText}>
                  {query.trim().length > 0
                    ? `No one matches "${query.trim()}". Try a different name or switch to Custom name.`
                    : 'No matching users yet — try searching above.'}
                </Text>
              ) : (
                // Capped: the page scrolls, so an unbounded list would bury the role
                // picker again. Narrowing the search is the way to reach someone further
                // down, which is what the search box is for.
                results.slice(0, RESULT_LIMIT).map(p => {
                  const selected = selectedUser?.id === p.id;
                  return (
                    <TouchableOpacity
                      key={p.id}
                      activeOpacity={0.85}
                      onPress={() => setSelectedUser(p)}
                      style={[styles.resultRow, selected && styles.resultRowSelected]}
                    >
                      <View style={styles.resultAvatar}>
                        <Text style={styles.resultAvatarText}>
                          {initialsFor(p.displayName ?? p.username)}
                        </Text>
                      </View>
                      <View style={styles.resultText}>
                        <View style={styles.resultNameRow}>
                          <Text style={styles.resultName} numberOfLines={1}>
                            {p.displayName ?? p.username}
                          </Text>
                          <AddBadge userId={p.id} size="sm" />
                        </View>
                        <Text style={styles.resultUsername} numberOfLines={1}>
                          @{p.username}
                        </Text>
                      </View>
                      {selected ? (
                        <View style={styles.resultCheck}>
                          <Icon name="check" size={13} color={COLORS.white} />
                        </View>
                      ) : null}
                    </TouchableOpacity>
                  );
                })
              )}
              {!searching && results.length > RESULT_LIMIT ? (
                <Text style={styles.emptyText}>
                  {results.length - RESULT_LIMIT} more — keep typing to narrow it down.
                </Text>
              ) : null}
            </View>
          </View>
        ) : (
          <View style={styles.customSection}>
            <Text style={styles.label}>Name</Text>
            <FormInput
              value={customName}
              onChangeText={setCustomName}
              placeholder="e.g. Alex Rivera"
              maxLength={60}
              autoCapitalize="words"
            />
            <Text style={styles.helperText}>
              Use this for people who aren't on Livil yet. They'll show up with a different chip
              color on the post.
            </Text>
          </View>
        )}

        <View style={styles.roleSection}>
          <Text style={styles.label}>Role</Text>
          <View style={styles.roleWrap}>
            {ROLES.map(r => {
              const active = role === r;
              const taken = isRoleTaken(r);
              return (
                <TouchableOpacity
                  key={r}
                  activeOpacity={0.85}
                  disabled={taken}
                  onPress={() => setRole(r)}
                  style={[styles.roleChip, active && styles.roleChipActive, taken && styles.roleChipTaken]}
                >
                  {active ? <GradientBorder borderRadius={999} /> : null}
                  <Text style={[styles.roleChipText, active && styles.roleChipTextActive]}>
                    {r}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
          {/* A separate group from the instruments above, not six more chips in the same
              wrap. A generated vocal is not "Vocals", and somebody picking their instrument
              should not scroll past the AI entries to reach "Bass". */}
          <Text style={styles.aiLabel}>Made with AI</Text>
          <View style={styles.roleWrap}>
            {AI_ROLES.map(r => {
              const active = role === r;
              const taken = isRoleTaken(r);
              return (
                <TouchableOpacity
                  key={r}
                  activeOpacity={0.85}
                  disabled={taken}
                  onPress={() => setRole(r)}
                  style={[styles.roleChip, styles.aiChip, active && styles.aiChipActive, taken && styles.roleChipTaken]}
                >
                  <Text style={[styles.roleChipText, active && styles.aiChipTextActive]}>
                    {r}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <View style={styles.customRoleRow}>
            <Text style={styles.label}>Or custom role</Text>
            <FormInput
              // `isPresetRole`, not `ROLES.includes` — with the AI list added, checking only
              // the human roles would echo "AI vocals" into the custom-role box the moment
              // it was picked, so the credit would read as typed-in rather than chosen.
              value={isPresetRole(role) ? '' : role}
              onChangeText={t => setRole(t)}
              placeholder="e.g. Tabla, Saxophone"
              maxLength={40}
              autoCapitalize="words"
              onFocus={() => { customRoleFocused.current = true; }}
              onBlur={() => { customRoleFocused.current = false; }}
            />
          </View>
        </View>

      </ScrollView>

      <View style={styles.footer}>
        <Button
          label="Add to track"
          onPress={handleConfirm}
          variant="primary"
          size="lg"
          fullWidth
          disabled={!canConfirm}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  headerSide: {
    minWidth: 64,
  },
  headerCancel: {
    color: COLORS.textSecondary,
    fontSize: 15,
    fontWeight: '600',
  },
  headerTitle: {
    color: COLORS.white,
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  modeToggle: {
    flexDirection: 'row',
    marginHorizontal: 20,
    marginTop: 16,
    padding: 4,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 999,
    gap: 4,
  },
  modePill: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 999,
  },
  modePillText: {
    color: COLORS.textSecondary,
    fontSize: 13,
    fontWeight: '700',
  },
  modePillTextActive: {
    color: COLORS.purpleNeon,
  },
  /*
   * Deliberately taller than a keyboard.
   *
   * The custom-role field is the last thing on the page, so without slack beneath it there
   * is simply nowhere to scroll TO — the content ends where the field ends, and both the
   * automatic scroll and a manual drag stop with it still behind the keys. ~340dp clears a
   * tall Android keyboard, so the field can always be lifted into the open, by the
   * keyboardDidShow handler or by hand.
   */
  pageContent: { paddingBottom: 340 },
  searchSection: {
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  resultsContent: {
    marginTop: 12,
    paddingBottom: 12,
    gap: 8,
  },
  resultsLoading: {
    paddingVertical: 24,
    alignItems: 'center',
  },
  errorText: {
    color: COLORS.error,
    fontSize: 13,
    marginTop: 8,
  },
  emptyText: {
    color: COLORS.textMuted,
    fontSize: 13,
    lineHeight: 19,
    paddingVertical: 20,
    paddingHorizontal: 4,
  },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 14,
    padding: 12,
  },
  resultRowSelected: {
    borderColor: COLORS.purple,
    backgroundColor: COLORS.purpleDim,
  },
  resultAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: COLORS.purple,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resultAvatarText: {
    color: COLORS.white,
    fontSize: 13,
    fontWeight: '800',
  },
  resultText: {
    flex: 1,
  },
  resultNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  resultName: {
    color: COLORS.white,
    fontSize: 15,
    fontWeight: '700',
  },
  resultUsername: {
    color: COLORS.textSecondary,
    fontSize: 12,
    marginTop: 2,
  },
  resultCheck: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: COLORS.purple,
    alignItems: 'center',
    justifyContent: 'center',
  },
  customSection: {
    paddingHorizontal: 20,
    paddingTop: 20,
    gap: 8,
  },
  helperText: {
    color: COLORS.textMuted,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 6,
  },
  label: {
    color: COLORS.textSecondary,
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  roleSection: {
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 8,
    gap: 8,
  },
  roleWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
  },
  roleChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
  // Selected state is the gradient outline; no fill.
  roleChipActive: {
    borderColor: 'transparent',
  },
  roleChipText: {
    color: COLORS.textSecondary,
    fontSize: 13,
    fontWeight: '600',
  },
  // Already credited in this role. Dimmed rather than removed, so it reads as "you already
  // did this" rather than as a role that does not exist.
  roleChipTaken: { opacity: 0.35 },
  roleChipTextActive: {
    color: COLORS.purpleNeon,
    fontWeight: '700',
  },
  aiLabel: {
    color: COLORS.textMuted,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginTop: 8,
  },
  // Info blue, the same tone a typed-in credit already carries — so an AI role is never
  // picked by accident in place of the human role directly above it. A flat outline rather
  // than the gradient the human chips use, for the same reason: they must not look alike.
  aiChip: {
    borderColor: COLORS.infoBorder,
  },
  aiChipActive: {
    borderColor: COLORS.info,
    backgroundColor: COLORS.infoBg,
  },
  aiChipTextActive: {
    color: COLORS.info,
    fontWeight: '700',
  },
  customRoleRow: {
    marginTop: 14,
    gap: 7,
  },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
    backgroundColor: COLORS.bg,
  },
});
