export const COLORS = {
  bg: '#0A0A0F',
  surface: '#12121C',
  card: '#1A1A2E',
  inputBg: '#1C1C30',
  // Purple ramp. `purple` is the bright primary — CTAs, play button, active
  // states, links, sent bubbles. The deeper stops are gradient material.
  purple: '#8B3DFF',
  purpleNeon: '#A855F7',   // glows, highlights, the "emitting light" feel
  purpleRoyal: '#6D28D9',  // gradient midpoint
  purpleDeep: '#4C1D95',   // gradient floor
  purpleDeepest: '#3A1180',
  purpleLight: '#C9B6FF',  // accent text on dark
  purpleDim: 'rgba(139, 61, 255, 0.15)',
  purpleGlow: 'rgba(139, 61, 255, 0.3)',
  // Badge gold. DISTINCT FROM `warning` (#F59E0B) on purpose: amber already means
  // "pending / unconfirmed" in this app — CollabAvatar draws a dashed amber ring
  // around an avatar for an unaccepted credit, which is the very surface the First
  // 100 badge sits on. A badge in the same tone would read as "not confirmed yet".
  // Champagne is cooler and less orange, and means exactly one thing: awarded.
  gold: '#E8B84B',
  goldLight: '#FFEDB0',  // bevel highlight, top of the seal gradient
  goldDeep: '#8A5E12',   // bevel floor and the seal's outline
  white: '#FFFFFF',
  // True black, distinct from `bg` (#0A0A0F). Exists for Apple's Sign in with
  // Apple button, whose appearance Apple specifies exactly: on the white
  // variant the mark and label must be pure black. Do not reach for this as a
  // general background - `bg` is the app's black.
  black: '#000000',
  textSecondary: '#8B90A7',
  textMuted: '#4B5268',
  border: '#252545',
  error: '#EF4444',
  errorBg: 'rgba(239, 68, 68, 0.1)',
  errorBorder: 'rgba(239, 68, 68, 0.3)',
  warning: '#F59E0B',
  warningBg: 'rgba(245, 158, 11, 0.12)',
  warningBorder: 'rgba(245, 158, 11, 0.35)',
  info: '#22D3EE',
  // Verified-badge ramp, mirroring the gold one. Cyan rather than purple: purple is the
  // primary accent and already surrounds the avatar as the story ring, so a purple badge
  // would vanish into it.
  infoLight: '#A5F3FC',
  infoDeep: '#0E7490',
  infoBg: 'rgba(34, 211, 238, 0.12)',
  infoBorder: 'rgba(34, 211, 238, 0.35)',
};
