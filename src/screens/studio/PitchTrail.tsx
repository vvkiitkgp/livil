import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import Svg, { Defs, Line, LinearGradient, Path, Stop, Text as SvgText } from 'react-native-svg';
import { COLORS } from '../../theme/colors';
import { NOTE_NAMES, scaleOf, type Key } from '../../utils/magicTune';

type Props = {
  sung: Float32Array | null;
  tuned: Float32Array | null;
  musicKey: Key | null;
  height?: number;
  /** 0–1 through the take; draws the playhead. */
  playhead?: number | null;
  /** Tap on the trail to jump there (0–1). */
  onSeek?: (fraction: number) => void;
};

const LABEL_W = 30;

/**
 * Builds an SVG path from a MIDI-per-frame array, breaking the line where it is unvoiced.
 * `steps` draws a note change as a straight vertical step instead of a slanted line.
 */
function pathOf(v: Float32Array, w: number, h: number, lo: number, hi: number, steps = false): string {
  const cols = Math.max(2, Math.floor(w / 2));
  const per = v.length / cols;
  let d = '';
  let pen = false;
  let lastY = 0;
  for (let c = 0; c < cols; c++) {
    const i = Math.floor(c * per);
    const m = v[i];
    if (!Number.isFinite(m)) { pen = false; continue; }
    const x = LABEL_W + (c / (cols - 1)) * (w - LABEL_W);
    const y = h - ((m - lo) / (hi - lo)) * h;
    if (steps && pen && Math.abs(y - lastY) > 0.5) d += `L${x.toFixed(1)} ${lastY.toFixed(1)} `;
    d += `${pen ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)} `;
    pen = true;
    lastY = y;
  }
  return d;
}

/** The pitch trail: your take in grey, the Magic Tuned line in the purple gradient. */
export function PitchTrail({ sung, tuned, musicKey, height = 170, playhead, onSeek }: Props) {
  const [w, setW] = useState(0);
  const range = useMemo(() => {
    let lo = Infinity, hi = -Infinity;
    for (const arr of [sung, tuned]) {
      if (!arr) continue;
      for (let i = 0; i < arr.length; i++) if (Number.isFinite(arr[i])) { lo = Math.min(lo, arr[i]); hi = Math.max(hi, arr[i]); }
    }
    if (!Number.isFinite(lo)) return { lo: 57, hi: 69 };
    return { lo: Math.floor(lo) - 1.5, hi: Math.ceil(hi) + 1.5 };
  }, [sung, tuned]);
  const lines = useMemo(() => {
    const scale = musicKey ? scaleOf(musicKey) : new Array(12).fill(true);
    const out: number[] = [];
    const span = range.hi - range.lo;
    for (let m = Math.ceil(range.lo); m <= range.hi; m++) {
      if (!scale[((m % 12) + 12) % 12]) continue;
      if (span > 16 && m % 2) continue;
      out.push(m);
    }
    return out;
  }, [range, musicKey]);
  const h = height;
  const y = (m: number) => h - ((m - range.lo) / (range.hi - range.lo)) * h;
  return (
    <Pressable
      style={[styles.root, { height }]}
      onLayout={e => setW(Math.floor(e.nativeEvent.layout.width))}
      onPress={e => onSeek && w > LABEL_W && onSeek(Math.min(1, Math.max(0, (e.nativeEvent.locationX - LABEL_W) / (w - LABEL_W))))}
      disabled={!onSeek}
      accessibilityLabel="Pitch trail. Tap to jump to that moment."
    >
      {w > 0 && (
        <Svg width={w} height={h}>
          <Defs>
            <LinearGradient id="trailGrad" x1="0" y1="0" x2="1" y2="0">
              <Stop offset="0" stopColor={COLORS.purpleRoyal} />
              <Stop offset="1" stopColor={COLORS.purpleNeon} />
            </LinearGradient>
          </Defs>
          {lines.map(m => (
            <React.Fragment key={m}>
              <Line x1={LABEL_W} x2={w} y1={y(m)} y2={y(m)} stroke={COLORS.border} strokeWidth={1} />
              <SvgText x={2} y={y(m) + 4} fill={COLORS.textMuted} fontSize={10}>
                {`${NOTE_NAMES[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`}
              </SvgText>
            </React.Fragment>
          ))}
          {sung && <Path d={pathOf(sung, w, h, range.lo, range.hi)} stroke={COLORS.textMuted} strokeWidth={2.5} fill="none" strokeLinecap="round" />}
          {tuned && <Path d={pathOf(tuned, w, h, range.lo, range.hi, true)} stroke="url(#trailGrad)" strokeWidth={3} fill="none" strokeLinecap="round" strokeLinejoin="round" />}
          {playhead != null && (
            <Line
              x1={LABEL_W + playhead * (w - LABEL_W)}
              x2={LABEL_W + playhead * (w - LABEL_W)}
              y1={0}
              y2={h}
              stroke={COLORS.white}
              strokeWidth={1.5}
            />
          )}
        </Svg>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({ root: { width: '100%' } });
