import React from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, TextInput } from 'react-native';
import { COLORS } from '../theme/colors';
import EmojiCoverArt from './EmojiCoverArt';

/**
 * Compose-your-own playlist cover: free-form emoji from the keyboard + a curated
 * mix of solid colors and gradients. No image upload — the picker is the only
 * way to set a cover (the unset state falls back to the first post's art at
 * the call sites).
 *
 * Emoji is the ONE place we intentionally keep an emoji glyph in UI per
 * CLAUDE.md (the "stay as text/emoji" exception list).
 */

export type CoverColorOption =
  | { kind: 'solid'; color: string }
  | { kind: 'gradient'; color: string; color2: string };

// Mix of solids and gradients. Solids cover the Livil accent palette; gradients
// give playlists a personality (Sunset, Ocean, Berry, etc.) without a
// color-picker UI.
export const COVER_COLOR_OPTIONS: CoverColorOption[] = [
  { kind: 'solid', color: '#8B3DFF' },                       // purple
  { kind: 'solid', color: '#C9B6FF' },                       // purple light
  { kind: 'solid', color: '#EC4899' },                       // pink
  { kind: 'solid', color: '#00BFFF' },                       // blue
  { kind: 'solid', color: '#22D3EE' },                       // teal
  { kind: 'solid', color: '#00C853' },                       // green
  { kind: 'solid', color: '#F59E0B' },                       // amber
  { kind: 'solid', color: '#FF4D6D' },                       // red-pink
  { kind: 'solid', color: '#1A1A2E' },                       // dark
  // Gradients (top-left → bottom-right).
  { kind: 'gradient', color: '#F59E0B', color2: '#FF4D6D' }, // Sunset
  { kind: 'gradient', color: '#00BFFF', color2: '#8B3DFF' }, // Ocean
  { kind: 'gradient', color: '#00C853', color2: '#22D3EE' }, // Forest
  { kind: 'gradient', color: '#EC4899', color2: '#8B3DFF' }, // Berry
  { kind: 'gradient', color: '#FF4D6D', color2: '#3B1E6E' }, // Lava
  { kind: 'gradient', color: '#22D3EE', color2: '#00C853' }, // Mint
  { kind: 'gradient', color: '#8B3DFF', color2: '#C9B6FF' }, // Royal
  { kind: 'gradient', color: '#1A1A2E', color2: '#8B3DFF' }, // Twilight
  { kind: 'gradient', color: '#F59E0B', color2: '#8B3DFF' }, // Dusk
];

type Value = { emoji: string | null; color: string | null; color2: string | null };

function isSameOption(value: Value, opt: CoverColorOption): boolean {
  if (opt.kind === 'solid') {
    return value.color === opt.color && !value.color2;
  }
  return value.color === opt.color && value.color2 === opt.color2;
}

export default function PlaylistCoverPicker({
  emoji,
  color,
  color2,
  onChange,
}: {
  emoji: string | null;
  color: string | null;
  color2: string | null;
  onChange: (next: Value) => void;
}) {
  const hasCover = emoji !== null && color !== null;
  const [emojiInput, setEmojiInput] = React.useState(emoji ?? '');
  // Keep TextInput in sync if parent resets (e.g. user taps Clear).
  React.useEffect(() => { setEmojiInput(emoji ?? ''); }, [emoji]);

  const setEmoji = (next: string) => {
    setEmojiInput(next);
    // Trim whitespace; pass null when empty so the picker can show its
    // "no custom cover" state. Auto-pick a default color when the user
    // starts an emoji so the cover renders immediately.
    const trimmed = next.trim();
    if (trimmed.length === 0) {
      onChange({ emoji: null, color: null, color2: null });
    } else {
      const defaultOpt = COVER_COLOR_OPTIONS[0]!;
      onChange({
        emoji: trimmed,
        color: color ?? defaultOpt.color,
        color2: color2 ?? (defaultOpt.kind === 'gradient' ? defaultOpt.color2 : null),
      });
    }
  };

  const pickColor = (opt: CoverColorOption) => {
    // If the user picks a color before picking an emoji, default emoji to 🎵
    // so the cover is non-empty (they can change it after).
    const e = emoji ?? '🎵';
    if (emojiInput.length === 0) { setEmojiInput(e); }
    onChange({
      emoji: e,
      color: opt.color,
      color2: opt.kind === 'gradient' ? opt.color2 : null,
    });
  };

  const value: Value = { emoji, color, color2 };

  return (
    <View>
      <View style={styles.previewRow}>
        {hasCover ? (
          <EmojiCoverArt emoji={emoji} color={color} color2={color2} size={96} borderRadius={14} />
        ) : (
          <View style={[styles.previewTile, styles.previewEmpty]}>
            <Text style={styles.previewEmptyText}>No custom cover</Text>
          </View>
        )}
        {hasCover ? (
          <Pressable
            onPress={() => { setEmojiInput(''); onChange({ emoji: null, color: null, color2: null }); }}
            hitSlop={6}
          >
            <Text style={styles.clearBtn}>Clear</Text>
          </Pressable>
        ) : null}
      </View>

      <Text style={styles.label}>Emoji</Text>
      <TextInput
        style={styles.emojiInput}
        value={emojiInput}
        onChangeText={setEmoji}
        placeholder="🎵  Tap to type or paste"
        placeholderTextColor={COLORS.textMuted}
        autoCorrect={false}
        autoCapitalize="none"
        maxLength={16}
      />
      <Text style={styles.helper}>Open your emoji keyboard and pick any one — even custom ones like 💪 or 🌶️.</Text>

      <Text style={[styles.label, { marginTop: 16 }]}>Background</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.swatchRow}>
        {COVER_COLOR_OPTIONS.map((opt, i) => {
          const selected = isSameOption(value, opt);
          return (
            <Pressable
              key={`${opt.kind}-${i}`}
              onPress={() => pickColor(opt)}
              style={[styles.swatchOuter, selected && styles.swatchOuterActive]}
            >
              <EmojiCoverArt
                emoji={null}
                color={opt.color}
                color2={opt.kind === 'gradient' ? opt.color2 : null}
                size={36}
                borderRadius={18}
                gradientId={`picker_${i}`}
              />
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  previewRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 14 },
  previewTile: { width: 96, height: 96, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  previewEmpty: { backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border },
  previewEmptyText: { color: COLORS.textMuted, fontSize: 11, textAlign: 'center', paddingHorizontal: 8 },
  clearBtn: { color: COLORS.error, fontSize: 12, fontWeight: '700', paddingHorizontal: 4 },

  label: { color: COLORS.textSecondary, fontSize: 11, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 },
  helper: { color: COLORS.textMuted, fontSize: 11, marginTop: 6, lineHeight: 16 },

  emojiInput: {
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border,
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12,
    color: COLORS.white, fontSize: 22,
  },

  swatchRow: { gap: 10, paddingVertical: 4, paddingRight: 8 },
  swatchOuter: {
    width: 44, height: 44, borderRadius: 22,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: 'transparent',
  },
  swatchOuterActive: { borderColor: COLORS.white },
});
