import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
  type NativeSyntheticEvent,
  type StyleProp,
  type TextLayoutEventData,
  type TextStyle,
} from 'react-native';
import { COLORS } from '../theme/colors';
import { MENTION_TEXT_STYLE } from '../utils/mentions';
import {
  MEASURE_FIT,
  SEE_MORE_ELLIPSIS,
  SEE_MORE_LABEL,
  advanceFit,
  captionPieces,
  isCaptionExpanded,
  piecesUpTo,
  rememberCaptionExpanded,
  sameFit,
  type CaptionFit,
  type CaptionPiece,
} from '../utils/captionFit';
import { useOpenMention } from '../hooks/useOpenMention';

/**
 * A caption with its @usernames tappable (purple), opening that profile — as comments
 * already do. The rest of the text is untouched.
 *
 * With `numberOfLines`, a caption that runs longer shows "… See more" at the end of its last
 * line, and a tap anywhere on it opens the whole caption in place (owner, 2026-11-02 — the
 * feed cards used to stop at line 4 with no way to read the rest). Tags stay tappable either
 * way. Without `numberOfLines` the whole caption is shown.
 *
 * How it decides (pure steps in utils/captionFit.ts): the caption is laid out a second time,
 * invisibly and without a line limit, and `onTextLayout` reports its lines. Only if there are
 * more than `numberOfLines` is it cut — and the cut is laid out the same way to confirm
 * "… See more" really lands on the last line, whatever the phone's width or text size. Until
 * then the visible text is the plain line-limited caption, which is the same height, so the
 * feed never jumps when the "See more" arrives.
 *
 * `expandId` (the post id) remembers an opened caption for the app session, so a card the
 * list unmounts and mounts again comes back open.
 */
function MentionText({
  text,
  style,
  numberOfLines,
  expandId,
}: {
  text: string;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
  expandId?: string;
}) {
  const openMention = useOpenMention();
  const pieces = useMemo(() => captionPieces(text), [text]);
  const [openedHere, setOpenedHere] = useState(false);
  const open = openedHere || isCaptionExpanded(expandId);
  const maxLines = numberOfLines && numberOfLines > 0 ? numberOfLines : 0;
  const collapsible = maxLines > 0 && !open;

  // Text size or width changes re-measure (a fit is only good for the layout it was made in).
  const { width: windowWidth, fontScale } = useWindowDimensions();
  const fitKey = `${windowWidth}|${fontScale}|${maxLines}|${text}`;
  const [fitState, setFitState] = useState<{ key: string; fit: CaptionFit }>({ key: fitKey, fit: MEASURE_FIT });
  const fit = fitState.key === fitKey ? fitState.fit : MEASURE_FIT;
  const boxWidthRef = useRef(0);

  const onCaptionLayout = useCallback((e: LayoutChangeEvent) => {
    boxWidthRef.current = e.nativeEvent.layout.width;
  }, []);

  // `fit` is what the invisible copy was drawn for. A layout reported for anything else
  // (a late event from an earlier pass) is ignored.
  const onMeasured = useCallback((e: NativeSyntheticEvent<TextLayoutEventData>) => {
    const lines = e.nativeEvent.lines.map(l => ({ length: l.text.length, width: l.width }));
    setFitState(prev => {
      const current = prev.key === fitKey ? prev.fit : MEASURE_FIT;
      if (!sameFit(current, fit)) { return prev; }
      const next = advanceFit(current, text, lines, maxLines, boxWidthRef.current);
      return sameFit(next, current) && prev.key === fitKey ? prev : { key: fitKey, fit: next };
    });
  }, [fit, fitKey, maxLines, text]);

  const expand = useCallback(() => {
    rememberCaptionExpanded(expandId);
    setOpenedHere(true);
  }, [expandId]);

  const renderPieces = (list: CaptionPiece[], live: boolean) =>
    list.map((p, i) =>
      p.kind === 'text' ? (
        <Text key={i}>{p.text}</Text>
      ) : (
        <Text
          key={i}
          style={MENTION_TEXT_STYLE}
          onPress={live ? () => openMention(p.username) : undefined}
        >
          {p.text}
        </Text>
      ),
    );

  if (!maxLines) {
    return <Text style={style} testID="caption">{renderPieces(pieces, true)}</Text>;
  }

  // "…" in the caption's own colour, glued (no-break space) to "See more" in grey.
  const suffix = (
    <Text key="see-more">
      {SEE_MORE_ELLIPSIS}
      <Text style={styles.seeMore}>{SEE_MORE_LABEL}</Text>
    </Text>
  );
  const measuring = collapsible && (fit.phase === 'measure' || fit.phase === 'check');
  // Tappable while it might be cut — including before the measuring settles — so the rest of
  // a caption is never out of reach. A caption that fits takes no tap at all.
  const canExpand = collapsible && fit.phase !== 'whole';

  return (
    <View>
      {measuring ? (
        <View
          style={styles.measureBox}
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <Text style={style} onTextLayout={onMeasured} testID="caption-measure">
            {fit.phase === 'check'
              ? [...renderPieces(piecesUpTo(pieces, fit.cut), false), suffix]
              : renderPieces(pieces, false)}
          </Text>
        </View>
      ) : null}
      <Text
        style={style}
        numberOfLines={collapsible ? maxLines : undefined}
        onLayout={onCaptionLayout}
        onPress={canExpand ? expand : undefined}
        suppressHighlighting={canExpand}
        accessibilityHint={canExpand ? 'Shows the whole caption' : undefined}
        testID="caption"
      >
        {collapsible && fit.phase === 'cut'
          ? [...renderPieces(piecesUpTo(pieces, fit.cut), true), suffix]
          : renderPieces(pieces, true)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  // Same width as the visible caption (left/right 0), out of the layout (absolute), unseen and
  // untouchable. No height limit: a clamped box would clamp the very lines being counted.
  measureBox: { position: 'absolute', top: 0, left: 0, right: 0, opacity: 0 },
  seeMore: { color: COLORS.textSecondary, fontWeight: '600' },
});

// PostCard re-renders several times a second while its song plays (the seek bar); the
// caption's props do not change then, so it is skipped.
export default React.memo(MentionText);
