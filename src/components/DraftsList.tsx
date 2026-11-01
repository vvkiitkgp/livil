import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { COLORS } from '../theme/colors';
import { relativeTime } from '../utils/commentTime';
import { displayTitle, type DraftSummary } from '../screens/studio/draftFormat';
import ConfirmActionModal from './ConfirmActionModal';
import { Button } from './Button';
import { Icon } from './Icon';
import { useToast } from '../contexts/ToastContext';

/** The note every drafts list carries — drafts are on this phone only (ADR-0036 §9). */
export const DRAFTS_ON_PHONE_NOTE =
  "Drafts are saved on this phone only. No one else can see them, and if you delete Livil or switch phones, they're gone.";

const clock = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

type Props = {
  drafts: DraftSummary[];
  onOpen: (id: string) => void;
  onDelete: (id: string) => Promise<void>;
  /** Show the on-this-phone note above the rows (default true). */
  showNote?: boolean;
};

/** Editor drafts as rows: Edit (or the row) to keep editing, the bin to delete (with a confirm). */
export function DraftsList({ drafts, onOpen, onDelete, showNote = true }: Props) {
  const { showToast } = useToast();
  const [confirm, setConfirm] = useState<DraftSummary | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <View style={styles.root}>
      {showNote && (
        <View style={styles.note}>
          <Icon name="lock" size={14} color={COLORS.textSecondary} />
          <Text style={styles.noteText}>{DRAFTS_ON_PHONE_NOTE}</Text>
        </View>
      )}
      {drafts.map(d => (
        <Pressable
          key={d.id}
          onPress={() => onOpen(d.id)}
          style={({ pressed }) => [styles.row, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={`Draft ${displayTitle(d.title)}. Open in the Editor.`}
        >
          <View style={styles.art}>
            <Icon name="mic" size={18} color={COLORS.purpleLight} />
          </View>
          <View style={styles.text}>
            <Text style={styles.title} numberOfLines={1}>{displayTitle(d.title)}</Text>
            <Text style={styles.meta} numberOfLines={1}>
              {[
                `${d.voiceCount} ${d.voiceCount === 1 ? 'voice' : 'voices'}`,
                d.instrumentCount > 0 && `${d.instrumentCount} ${d.instrumentCount === 1 ? 'instrument' : 'instruments'}`,
                clock(d.durationSec),
                `edited ${relativeTime(d.updatedAt)}`,
              ].filter(Boolean).join(' · ')}
            </Text>
          </View>
          <Button label="Edit" icon="edit" variant="secondary" size="sm" onPress={() => onOpen(d.id)} accessibilityLabel={`Edit draft ${displayTitle(d.title)}`} />
          <Pressable onPress={() => setConfirm(d)} hitSlop={10} accessibilityRole="button" accessibilityLabel={`Delete draft ${displayTitle(d.title)}`}>
            <Icon name="trash" size={18} color={COLORS.textMuted} />
          </Pressable>
        </Pressable>
      ))}

      <ConfirmActionModal
        visible={!!confirm}
        title="Delete this draft?"
        message="It's only on this phone, so it can't be brought back."
        icon="trash"
        confirmLabel="Delete draft"
        busy={busy}
        onConfirm={async () => {
          if (!confirm) return;
          setBusy(true);
          try {
            await onDelete(confirm.id);
          } catch {
            showToast("Couldn't delete that draft.", { kind: 'error' });
          } finally {
            setBusy(false);
            setConfirm(null);
          }
        }}
        onCancel={() => setConfirm(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 8 },
  note: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', paddingHorizontal: 2, paddingBottom: 4 },
  noteText: { flex: 1, color: COLORS.textSecondary, fontSize: 12, lineHeight: 17 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 14, backgroundColor: COLORS.surface },
  pressed: { opacity: 0.7 },
  art: { width: 40, height: 40, borderRadius: 10, backgroundColor: COLORS.purpleDim, alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, gap: 2 },
  title: { color: COLORS.white, fontSize: 14, fontWeight: '700' },
  meta: { color: COLORS.textSecondary, fontSize: 12 },
});
