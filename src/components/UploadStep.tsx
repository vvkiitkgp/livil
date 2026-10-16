import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { COLORS } from '../theme/colors';
import { GradientBorder } from './GradientBorder';
import { Icon } from './Icon';

export type UploadStepState = 'done' | 'current' | 'todo';

const CIRCLE = 28;

/**
 * One row of the upload screen's vertical step list: a numbered circle on a rail, the step's
 * title, and either its open content (`current`) or a one-line summary.
 *
 *   done     solid purple circle with a tick, the summary, and "Change" — tap to reopen.
 *   current  purple gradient ring around the number; `children` render underneath.
 *   todo     grey ring and number; the hint says what the step asks for. Still tappable:
 *            the order is a guide, not a lock.
 *
 * The rail segment below a circle is purple once that step is done, so the line fills in as
 * the artist works down the list. The tick circle is a small indicator, exempt from the
 * no-solid-fill button rule (CLAUDE.md).
 */
export default function UploadStep({
  number,
  title,
  hint,
  summary,
  state,
  isLast = false,
  onOpen,
  disabled = false,
  leading,
  children,
}: {
  number: number;
  title: string;
  /** Shown under the title while the step is open or still to do. */
  hint: string;
  /** Shown under the title once the step is done and closed. */
  summary: string;
  state: UploadStepState;
  isLast?: boolean;
  /** Reopen this step. Ignored while it is already open. */
  onOpen: () => void;
  disabled?: boolean;
  /** A small picture beside a done step's summary (the chosen cover). */
  leading?: React.ReactNode;
  children?: React.ReactNode;
}) {
  const open = state === 'current';
  const done = state === 'done';
  return (
    <View style={styles.row}>
      <View style={styles.railCol}>
        {done ? (
          <View style={[styles.circle, styles.circleDone]}>
            <Icon name="check" size={16} color={COLORS.white} weight="bold" />
          </View>
        ) : open ? (
          <View style={styles.circle}>
            <GradientBorder borderRadius={CIRCLE / 2} />
            <Text style={styles.numberCurrent}>{number}</Text>
          </View>
        ) : (
          <View style={[styles.circle, styles.circleTodo]}>
            <Text style={styles.numberTodo}>{number}</Text>
          </View>
        )}
        {isLast ? null : <View style={[styles.rail, done && styles.railDone]} />}
      </View>

      <View style={[styles.body, open && styles.bodyOpen]}>
        <TouchableOpacity
          activeOpacity={open ? 1 : 0.7}
          disabled={open || disabled}
          onPress={onOpen}
          accessibilityRole="button"
          accessibilityState={{ expanded: open, disabled: open || disabled }}
          accessibilityLabel={`Step ${number}, ${title}${done ? ', done' : ''}`}
          style={styles.header}
        >
          {done && leading ? leading : null}
          <View style={styles.headerText}>
            <View style={styles.titleRow}>
              <Text style={[styles.title, state === 'todo' && styles.titleTodo]}>{title}</Text>
              {done ? <Text style={styles.change}>Change</Text> : null}
            </View>
            <Text
              style={[styles.sub, state === 'todo' && styles.subTodo]}
              numberOfLines={done ? 1 : 2}
            >
              {done ? summary : hint}
            </Text>
          </View>
        </TouchableOpacity>
        {open ? <View style={styles.content}>{children}</View> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 14 },
  railCol: { width: CIRCLE, alignItems: 'center' },
  circle: {
    width: CIRCLE,
    height: CIRCLE,
    borderRadius: CIRCLE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  circleDone: { backgroundColor: COLORS.purple },
  circleTodo: { borderWidth: 1.5, borderColor: COLORS.border },
  numberCurrent: { color: COLORS.purpleNeon, fontSize: 14, fontWeight: '800' },
  numberTodo: { color: COLORS.textMuted, fontSize: 14, fontWeight: '700' },
  rail: { flex: 1, width: 2, minHeight: 18, backgroundColor: COLORS.border },
  railDone: { backgroundColor: COLORS.purple },
  body: { flex: 1, paddingBottom: 20 },
  bodyOpen: { paddingBottom: 26 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: CIRCLE },
  headerText: { flex: 1 },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { color: COLORS.white, fontSize: 16, fontWeight: '700' },
  titleTodo: { color: COLORS.textSecondary },
  change: { color: COLORS.purpleLight, fontSize: 14, fontWeight: '600' },
  sub: { color: COLORS.textSecondary, fontSize: 13, marginTop: 3 },
  subTodo: { color: COLORS.textMuted },
  content: { marginTop: 16 },
});
