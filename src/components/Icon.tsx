/**
 * Icon — the single import surface for all UI icons in Livil.
 *
 * Call-sites use a Livil-semantic `name` and never import phosphor/lucide
 * directly, so swapping a glyph (or the whole library) is a one-file change.
 * Backed by Phosphor (`phosphor-react-native`) for everything, plus Lucide
 * (`lucide-react-native`) for the one `drum` icon Phosphor lacks. Both are
 * pure-JS SVG renderers riding the already-installed `react-native-svg` — no
 * native module, no rebuild.
 *
 * Reaction emoji + the emoji picker (ConversationScreen) and in-copy 🎵/🎉 in
 * strings are intentionally NOT icons — leave them as text.
 */
import React from 'react';
import {
  ArrowBendUpLeft,
  ArrowLeft,
  ArrowRight,
  ArrowSquareOut,
  ArrowUp,
  ArrowsClockwise,
  CaretDown,
  CaretLeft,
  CaretLineLeft,
  CaretLineRight,
  CaretRight,
  ChatCircle,
  Check,
  CheckCircle,
  Crown,
  DotsSixVertical,
  DotsThree,
  Envelope,
  Eye,
  EyeSlash,
  Faders,
  Flag,
  Guitar,
  Handshake,
  HandWaving,
  Heart,
  House,
  IconProps as PhProps,
  IconWeight,
  Info,
  MagnifyingGlass,
  Microphone,
  MusicNote,
  MusicNotes,
  Note,
  NotePencil,
  PaperPlaneTilt,
  Pause,
  PencilSimple,
  PencilSimpleLine,
  PianoKeys,
  Play,
  Playlist,
  Plus,
  Prohibit,
  Queue,
  Repeat,
  RepeatOnce,
  ShareNetwork,
  Shuffle,
  SkipForward,
  Star,
  Trash,
  User,
  WarningCircle,
  X,
  XCircle,
} from 'phosphor-react-native';
import { Drum as LucideDrum } from 'lucide-react-native';
import { COLORS } from '../theme/colors';

export type IconName =
  // playback & transport
  | 'play' | 'pause' | 'skipForward' | 'repeat' | 'repeatOnce' | 'shuffle' | 'queue'
  // engagement / social
  | 'heart' | 'comment' | 'repost' | 'overflow' | 'flag' | 'trash' | 'reply'
  | 'share' | 'externalLink' | 'tombstone' | 'crown'
  // navigation & chrome
  | 'back' | 'backArrow' | 'forward' | 'send' | 'arrowRight' | 'arrowUp'
  | 'collapse' | 'close' | 'clear' | 'add' | 'compose' | 'edit' | 'dragHandle'
  | 'clipStart' | 'clipEnd'
  // status & feedback
  | 'check' | 'checkCircle' | 'error' | 'info' | 'eye' | 'eyeOff' | 'email'
  // tab bar
  | 'home' | 'search' | 'library' | 'profile'
  // music notes
  | 'musicNote' | 'musicNotes'
  // role icons
  | 'mic' | 'drum' | 'piano' | 'guitar' | 'faders' | 'pencilLine' | 'note'
  | 'star' | 'handshake' | 'wave';

type PhComponent = React.ComponentType<PhProps>;

/** name → [Phosphor component, default weight]. `drum` is handled separately (Lucide). */
const REGISTRY: Record<Exclude<IconName, 'drum'>, [PhComponent, IconWeight]> = {
  // playback
  play: [Play, 'fill'],
  pause: [Pause, 'fill'],
  skipForward: [SkipForward, 'fill'],
  repeat: [Repeat, 'bold'],
  repeatOnce: [RepeatOnce, 'bold'],
  shuffle: [Shuffle, 'bold'],
  queue: [Queue, 'regular'],
  // engagement
  heart: [Heart, 'regular'],
  comment: [ChatCircle, 'regular'],
  repost: [ArrowsClockwise, 'bold'],
  overflow: [DotsThree, 'bold'],
  flag: [Flag, 'regular'],
  trash: [Trash, 'regular'],
  reply: [ArrowBendUpLeft, 'bold'],
  share: [ShareNetwork, 'regular'],
  externalLink: [ArrowSquareOut, 'regular'],
  tombstone: [Prohibit, 'regular'],
  crown: [Crown, 'fill'],
  // navigation
  back: [CaretLeft, 'bold'],
  backArrow: [ArrowLeft, 'bold'],
  forward: [CaretRight, 'bold'],
  send: [PaperPlaneTilt, 'fill'],
  arrowRight: [ArrowRight, 'bold'],
  arrowUp: [ArrowUp, 'bold'],
  collapse: [CaretDown, 'bold'],
  close: [X, 'bold'],
  clear: [XCircle, 'fill'],
  add: [Plus, 'bold'],
  compose: [NotePencil, 'regular'],
  edit: [PencilSimple, 'fill'],
  dragHandle: [DotsSixVertical, 'fill'],
  clipStart: [CaretLineRight, 'bold'],
  clipEnd: [CaretLineLeft, 'bold'],
  // status
  check: [Check, 'bold'],
  checkCircle: [CheckCircle, 'fill'],
  error: [WarningCircle, 'fill'],
  info: [Info, 'fill'],
  eye: [Eye, 'regular'],
  eyeOff: [EyeSlash, 'regular'],
  email: [Envelope, 'regular'],
  // tab bar
  home: [House, 'regular'],
  search: [MagnifyingGlass, 'regular'],
  library: [Playlist, 'regular'],
  profile: [User, 'regular'],
  // music notes
  musicNote: [MusicNote, 'fill'],
  musicNotes: [MusicNotes, 'fill'],
  // roles
  mic: [Microphone, 'fill'],
  piano: [PianoKeys, 'fill'],
  guitar: [Guitar, 'fill'],
  faders: [Faders, 'fill'],
  pencilLine: [PencilSimpleLine, 'fill'],
  note: [Note, 'fill'],
  star: [Star, 'fill'],
  handshake: [Handshake, 'fill'],
  wave: [HandWaving, 'fill'],
};

export interface IconProps {
  name: IconName;
  /** px, square. Default 20. */
  size?: number;
  /** Default `COLORS.textSecondary`. */
  color?: string;
  /** Phosphor weight override; ignored by `drum` (Lucide). Falls back to the per-icon default. */
  weight?: IconWeight;
}

export function Icon({ name, size = 20, color = COLORS.textSecondary, weight }: IconProps) {
  if (name === 'drum') {
    // Lucide: stroke icon, no weight concept — approximate "fill" with a heavier stroke.
    return <LucideDrum size={size} color={color} strokeWidth={weight === 'fill' || weight === 'bold' ? 2.5 : 2} />;
  }
  const [Cmp, defaultWeight] = REGISTRY[name];
  return <Cmp size={size} color={color} weight={weight ?? defaultWeight} />;
}

export default Icon;
