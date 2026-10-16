import React, { useRef, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View, type TextInput } from 'react-native';
import { COLORS } from '../theme/colors';
import FormInput from './FormInput';
import { GradientBorder } from './GradientBorder';
import { Icon } from './Icon';
import RoundTickButton from './RoundTickButton';

/** The credit role column's limit (`track_collaborators_role_check`). */
const ROLE_MAX_LENGTH = 40;

const sameRole = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * What the uploader did on their own track — several at once, like tags.
 *
 * Preset roles are chips that toggle; a role of their own goes in behind a "+ Something else"
 * chip (the same pattern as the tag field), and shows as a chip with × once added. Each role
 * is saved as its own credit (`createTrack`), the way a collaborator with two jobs already is.
 * At `max` the unpicked presets dim and "+ Something else" goes away.
 *
 * The draft is held here, not lifted — lifting it re-renders the screen per keystroke and
 * remounts the TextInput on Android 15 + Fabric (the bug FormInput exists to prevent).
 */
export default function RolePicker({
  roles,
  onChange,
  presets,
  max,
  editable = true,
  onFieldFocus,
}: {
  roles: string[];
  onChange: (roles: string[]) => void;
  presets: readonly string[];
  max: number;
  editable?: boolean;
  /** The "+ Something else" box just took the keyboard — the screen scrolls it into view. */
  onFieldFocus?: (field: TextInput | null) => void;
}) {
  const [typing, setTyping] = useState(false);
  const inputRef = useRef<TextInput>(null);
  const [draft, setDraft] = useState('');
  const full = roles.length >= max;
  const custom = roles.filter(r => !presets.some(p => sameRole(p, r)));

  const toggle = (role: string) => {
    const on = roles.some(r => sameRole(r, role));
    if (on) { onChange(roles.filter(r => !sameRole(r, role))); return; }
    if (full) { return; }
    onChange([...roles, role]);
  };

  const commit = () => {
    const role = draft.trim().slice(0, ROLE_MAX_LENGTH);
    setDraft('');
    if (!role || full || roles.some(r => sameRole(r, role))) { return; }
    // A typed role that matches a preset selects the preset, so it reads the same everywhere.
    onChange([...roles, presets.find(p => sameRole(p, role)) ?? role]);
  };

  return (
    <View>
      <View style={styles.wrap}>
        {presets.map(r => {
          const active = roles.some(x => sameRole(x, r));
          const dim = !active && full;
          return (
            <TouchableOpacity
              key={r}
              activeOpacity={0.85}
              disabled={!editable || dim}
              onPress={() => toggle(r)}
              style={[styles.chip, active && styles.chipActive, dim && styles.chipDim]}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: active, disabled: !editable || dim }}
            >
              {active ? <GradientBorder borderRadius={999} /> : null}
              <Text style={[styles.chipText, active && styles.chipTextActive]}>{r}</Text>
            </TouchableOpacity>
          );
        })}
        {custom.map(r => (
          <View key={r} style={[styles.chip, styles.chipActive, styles.customChip]}>
            <GradientBorder borderRadius={999} />
            <Text style={[styles.chipText, styles.chipTextActive]} numberOfLines={1}>{r}</Text>
            {editable ? (
              <TouchableOpacity
                onPress={() => toggle(r)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityLabel={`Remove ${r}`}
              >
                <Icon name="close" size={14} color={COLORS.purpleLight} />
              </TouchableOpacity>
            ) : null}
          </View>
        ))}
        {editable && !full && !typing ? (
          <TouchableOpacity
            onPress={() => setTyping(true)}
            activeOpacity={0.7}
            style={[styles.chip, styles.somethingElse]}
            accessibilityRole="button"
            accessibilityLabel="Add a role of your own"
          >
            <Icon name="add" size={12} color={COLORS.purpleNeon} />
            <Text style={[styles.chipText, styles.somethingElseText]}>Something else</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {typing && !full ? (
        <FormInput
          ref={inputRef}
          value={draft}
          onChangeText={setDraft}
          onSubmitEditing={commit}
          // Saves what was typed when they tap away, and tucks the box back away.
          onBlur={() => {
            commit();
            setTyping(false);
          }}
          autoFocus
          onFocus={() => onFieldFocus?.(inputRef.current)}
          placeholder="e.g. Tabla, Additional production"
          maxLength={ROLE_MAX_LENGTH}
          autoCapitalize="words"
          returnKeyType="done"
          blurOnSubmit={false}
          editable={editable}
          wrapperStyle={styles.field}
          trailing={
            <RoundTickButton
              enabled={draft.trim().length > 0}
              onPress={commit}
              accessibilityLabel="Add this role"
            />
          }
        />
      ) : null}

      {full ? <Text style={styles.note}>That's {max} — remove one to add another.</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
    maxWidth: '100%',
  },
  // Selected: the gradient outline carries it; no fill — the same as the collaborator picker.
  chipActive: { borderColor: 'transparent', backgroundColor: COLORS.bg },
  chipDim: { opacity: 0.4 },
  customChip: { paddingRight: 10 },
  chipText: { color: COLORS.textSecondary, fontSize: 13, fontWeight: '600', flexShrink: 1 },
  chipTextActive: { color: COLORS.purpleNeon, fontWeight: '700' },
  somethingElse: { borderColor: COLORS.purple, backgroundColor: 'transparent' },
  somethingElseText: { color: COLORS.purpleNeon },
  field: { marginTop: 12 },
  note: { color: COLORS.textSecondary, fontSize: 12, marginTop: 10 },
});
