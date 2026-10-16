/**
 * Icon — the single import surface for all UI icons in Livil.
 *
 * Call-sites use a Livil-semantic `name` and never import phosphor/lucide
 * directly, so swapping a glyph (or the whole library) is a one-file change.
 * Backed by Phosphor (`phosphor-react-native`) for everything, plus Lucide
 * (`lucide-react-native`) for the one `drum` icon Phosphor lacks, one glyph
 * composed from Phosphor's own paths (`compose`, see CHAT_CIRCLE_PLUS) and one drawn
 * on Phosphor's grid (`layoutList`, see FEED_SEAM). All are
 * pure-JS SVG renderers riding the already-installed `react-native-svg` — no
 * native module, no rebuild.
 *
 * Reaction emoji + the emoji picker (ConversationScreen) and in-copy 🎵/🎉 in
 * strings are intentionally NOT icons — leave them as text.
 */
import React from 'react';
import {
  ArrowBendUpLeft,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowSquareOut,
  ArrowUp,
  ArrowsClockwise,
  Clock,
  ArrowsInSimple,
  Bell,
  BellSlash,
  Broadcast,
  Camera,
  CaretDown,
  CaretLeft,
  CaretLineLeft,
  CaretLineRight,
  CaretRight,
  ChatCircle,
  ChatsCircle,
  Check,
  CheckCircle,
  Crown,
  Disc,
  DotsSixVertical,
  DotsThree,
  Envelope,
  Eye,
  EyeSlash,
  Faders,
  FileText,
  Flag,
  Gear,
  Gift,
  Globe,
  Guitar,
  Handshake,
  HandTap,
  HandWaving,
  Heart,
  House,
  IconProps as PhProps,
  IconWeight,
  Info,
  InstagramLogo,
  Lifebuoy,
  LinkSimple,
  Lock,
  MagnifyingGlass,
  MinusCircle,
  Microphone,
  MusicNote,
  MusicNotes,
  Note,
  PaperPlaneTilt,
  Pause,
  PencilSimple,
  PencilSimpleLine,
  PianoKeys,
  Play,
  Playlist as PhPlaylist,
  Plus,
  Prohibit,
  Queue,
  Repeat,
  RepeatOnce,
  ShieldCheck,
  Shuffle,
  SignOut,
  Seal,
  SkipBack,
  Sparkle,
  SkipForward,
  SquaresFour,
  Star,
  Trash,
  UploadSimple,
  User,
  UsersThree,
  Warning,
  WarningCircle,
  X,
  XCircle,
} from 'phosphor-react-native';
import { Drum as LucideDrum } from 'lucide-react-native';
import Svg, { Path } from 'react-native-svg';
import { COLORS } from '../theme/colors';

export type IconName =
  // playback & transport
  | 'play' | 'pause' | 'skipForward' | 'skipBack' | 'repeat' | 'repeatOnce' | 'shuffle' | 'queue'
  // engagement / social
  | 'heart' | 'comment' | 'repost' | 'overflow' | 'flag' | 'trash' | 'reply'
  | 'share' | 'externalLink' | 'link' | 'tombstone' | 'block' | 'crown'
  // navigation & chrome
  | 'back' | 'backArrow' | 'forward' | 'send' | 'messages' | 'arrowRight' | 'arrowUp' | 'arrowDown'
  | 'collapse' | 'close' | 'clear' | 'add' | 'compose' | 'edit' | 'dragHandle' | 'upload'
  | 'clipStart' | 'clipEnd' | 'minusCircle' | 'settings' | 'disclosure'
  // status & feedback
  | 'check' | 'checkCircle' | 'error' | 'info' | 'eye' | 'eyeOff' | 'email' | 'pending'
  | 'recent'
  // tab bar
  | 'home' | 'search' | 'library' | 'profile'
  // music notes & albums
  | 'musicNote' | 'musicNotes' | 'disc' | 'playlist'
  // visibility
  | 'public' | 'friends' | 'lock'
  // layout switches (profile Reposts / Uploads: list ↔ grid)
  | 'layoutList' | 'layoutGrid'
  // role icons
  | 'mic' | 'drum' | 'piano' | 'guitar' | 'faders' | 'pencilLine' | 'note'
  | 'star' | 'handshake' | 'handTap' | 'zoomOut' | 'wave' | 'ai' | 'seal'
  // settings
  | 'bell' | 'bellOff' | 'shield' | 'gift' | 'support' | 'instagram'
  | 'warningTriangle' | 'camera' | 'document' | 'broadcast' | 'signOut';

type PhComponent = React.ComponentType<PhProps>;

/**
 * "New message": a speech bubble with a plus. Phosphor has no such icon, so it is Phosphor's
 * own ChatCircle (regular) with PlusCircle's (regular) plus set inside it — same 256 grid,
 * same stroke weight, so it sits beside the rest of the set (and the `messages` two-bubble
 * icon) unnoticed. Regular weight only. Owner's pick, 2026-10-15.
 */
const CHAT_CIRCLE_PLUS =
  'M128 24a104 104 0 0 0-91.82 152.88l-11.35 34.05a16 16 0 0 0 20.24 20.24l34.05-11.35A104 104 0 1 0 128 24' +
  'm0 192a87.87 87.87 0 0 1-44.06-11.81 8 8 0 0 0-6.54-.67L40 216l12.47-37.4a8 8 0 0 0-.66-6.54A88 88 0 1 1 128 216' +
  'M176 128a8 8 0 0 1-8 8h-32v32a8 8 0 0 1-16 0v-32H88a8 8 0 0 1 0-16h32V88a8 8 0 0 1 16 0v32h32a8 8 0 0 1 8 8';

/**
 * "List" on the profile's layout switch: the seam between two feed cards — the bottom of one
 * and the top of the next, like "] [" stood upright — so it reads as the scrolling feed the
 * list shows rather than as a bulleted list. Phosphor has no such glyph; drawn as strokes on
 * Phosphor's 256 grid at its regular line weight, so it sits beside `layoutGrid`.
 */
const FEED_SEAM =
  'M48 40V88a16 16 0 0 0 16 16H192a16 16 0 0 0 16-16V40' +
  'M48 216V168a16 16 0 0 1 16-16H192a16 16 0 0 1 16 16v48';

/**
 * name → [Phosphor component, default weight]. Handled separately: `drum` (Lucide),
 * `compose` (CHAT_CIRCLE_PLUS) and `layoutList` (FEED_SEAM).
 */
const REGISTRY: Record<Exclude<IconName, 'drum' | 'compose' | 'layoutList'>, [PhComponent, IconWeight]> = {
  // playback
  play: [Play, 'fill'],
  pause: [Pause, 'fill'],
  skipForward: [SkipForward, 'fill'],
  skipBack: [SkipBack, 'fill'],
  repeat: [Repeat, 'bold'],
  repeatOnce: [RepeatOnce, 'bold'],
  shuffle: [Shuffle, 'bold'],
  queue: [Queue, 'regular'],
  // layout
  layoutGrid: [SquaresFour, 'regular'],
  // engagement
  heart: [Heart, 'regular'],
  comment: [ChatCircle, 'regular'],
  repost: [ArrowsClockwise, 'bold'],
  overflow: [DotsThree, 'bold'],
  flag: [Flag, 'regular'],
  trash: [Trash, 'regular'],
  reply: [ArrowBendUpLeft, 'bold'],
  // PaperPlaneTilt, not ShareNetwork. The three-linked-dots glyph is Android's
  // convention but reads as "network"/"connections" out of context, and it was
  // genuinely missed on the feed card. The paper plane is what every social app uses
  // for this exact interaction — a sheet that leads with "send to a friend". Swap to
  // `Export` (the iOS box-with-up-arrow) by changing this one line; it is already a
  // phosphor export, and `share` has exactly one call site.
  share: [PaperPlaneTilt, 'regular'],
  externalLink: [ArrowSquareOut, 'regular'],
  // A profile link (livil-music.com/@you) shown in the Share profile sheet.
  link: [LinkSimple, 'bold'],
  tombstone: [Prohibit, 'regular'],
  // Same glyph as `tombstone`, deliberately a separate name: one marks removed
  // content, the other is the block action. They only happen to look alike.
  block: [Prohibit, 'bold'],
  crown: [Crown, 'fill'],
  // navigation
  back: [CaretLeft, 'bold'],
  backArrow: [ArrowLeft, 'bold'],
  forward: [CaretRight, 'bold'],
  send: [PaperPlaneTilt, 'fill'],
  // Home's "open your messages" button. Two bubbles — a conversation — not the paper plane,
  // which is already `share` on every post card, and not one bubble, which is `comment`.
  // Owner's pick, 2026-10-15.
  messages: [ChatsCircle, 'regular'],
  arrowRight: [ArrowRight, 'bold'],
  arrowUp: [ArrowUp, 'bold'],
  arrowDown: [ArrowDown, 'bold'],
  collapse: [CaretDown, 'bold'],
  close: [X, 'bold'],
  clear: [XCircle, 'fill'],
  add: [Plus, 'bold'],
  edit: [PencilSimple, 'fill'],
  dragHandle: [DotsSixVertical, 'fill'],
  clipStart: [CaretLineRight, 'bold'],
  clipEnd: [CaretLineLeft, 'bold'],
  minusCircle: [MinusCircle, 'regular'],
  settings: [Gear, 'regular'],
  // Same glyph as `forward`, kept separate: a list-row disclosure wants a
  // lighter weight and should be restyleable without touching nav arrows.
  disclosure: [CaretRight, 'regular'],
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
  library: [PhPlaylist, 'regular'],
  profile: [User, 'regular'],
  // music notes & albums
  musicNote: [MusicNote, 'fill'],
  musicNotes: [MusicNotes, 'fill'],
  disc: [Disc, 'fill'],
  playlist: [PhPlaylist, 'regular'],
  // visibility
  public: [Globe, 'bold'],
  friends: [UsersThree, 'fill'],
  lock: [Lock, 'fill'],
  // roles
  mic: [Microphone, 'fill'],
  piano: [PianoKeys, 'fill'],
  guitar: [Guitar, 'fill'],
  faders: [Faders, 'fill'],
  pencilLine: [PencilSimpleLine, 'fill'],
  note: [Note, 'fill'],
  star: [Star, 'fill'],
  // Generic "awarded" mark for the activity feed. NOT the badge artwork — the marks
  // themselves are gradient SVGs (FirstHundredBadge, VerifiedBadge) and would read as mud
  // in a 20px monochrome slot. This says "a badge", the bubble copy says which.
  seal: [Seal, 'fill'],
  handshake: [Handshake, 'fill'],
  handTap: [HandTap, 'regular'],
  zoomOut: [ArrowsInSimple, 'bold'],
  wave: [HandWaving, 'fill'],
  // A credit the named artist has not answered yet. `regular` — this sits next to a name
  // at 13px, where a filled clock reads as a dot.
  pending: [Clock, 'regular'],
  // Same glyph as `pending`, deliberately named separately: `pending` means "awaiting an
  // answer" (an unconfirmed credit), and a recent search is not waiting for anything. Sharing
  // the name would make a later change to the pending clock silently restyle search history.
  recent: [Clock, 'regular'],
  // Any of the AI_ROLES. One glyph for the whole group on purpose: the point of the mark
  // is "a tool did this", and six different machine icons would say less, not more.
  ai: [Sparkle, 'fill'],
  // settings — `regular` throughout: these sit inside a tinted tile in
  // SettingsRow, where a filled glyph reads as a solid blob at 20px.
  bell: [Bell, 'regular'],
  bellOff: [BellSlash, 'regular'],
  shield: [ShieldCheck, 'regular'],
  gift: [Gift, 'regular'],
  support: [Lifebuoy, 'regular'],
  instagram: [InstagramLogo, 'regular'],
  // NO `apple` ENTRY, ON PURPOSE. Phosphor's AppleLogo is a redraw, and App Review
  // rejected 2.1.1 (75) for it on the Sign in with Apple button (guideline 4). The
  // only Apple logo in this app is Apple's own file, inside AppleSignInButton.
  // Distinct from `error` (WarningCircle): the triangle is the danger-banner
  // glyph on DeleteAccountScreen, where it needs to read at 32px.
  warningTriangle: [Warning, 'regular'],
  camera: [Camera, 'fill'],
  document: [FileText, 'regular'],
  broadcast: [Broadcast, 'regular'],
  signOut: [SignOut, 'regular'],
  // "Upload a track" on the Add-to-Livil chooser (ADR-0027).
  upload: [UploadSimple, 'bold'],
};

export interface IconProps {
  name: IconName;
  /** px, square. Default 20. */
  size?: number;
  /** Default `COLORS.textSecondary`. */
  color?: string;
  /** Phosphor weight override; ignored by `drum`, `compose` and `layoutList`. Falls back to the per-icon default. */
  weight?: IconWeight;
}

export function Icon({ name, size = 20, color = COLORS.textSecondary, weight }: IconProps) {
  if (name === 'drum') {
    // Lucide: stroke icon, no weight concept — approximate "fill" with a heavier stroke.
    return <LucideDrum size={size} color={color} strokeWidth={weight === 'fill' || weight === 'bold' ? 2.5 : 2} />;
  }
  if (name === 'compose') {
    return (
      <Svg width={size} height={size} viewBox="0 0 256 256" fill={color}>
        <Path d={CHAT_CIRCLE_PLUS} />
      </Svg>
    );
  }
  if (name === 'layoutList') {
    return (
      <Svg width={size} height={size} viewBox="0 0 256 256" fill="none">
        <Path d={FEED_SEAM} stroke={color} strokeWidth={16} strokeLinecap="round" strokeLinejoin="round" />
      </Svg>
    );
  }
  const [Cmp, defaultWeight] = REGISTRY[name];
  return <Cmp size={size} color={color} weight={weight ?? defaultWeight} />;
}

export default Icon;
