/**
 * Shared geometry for profile badge marks.
 *
 * The seal outline is deliberately COMMON to every badge: shape says "this is a Livil
 * badge", colour and glyph say which one. Duplicating the path per badge would let them
 * drift apart silently, and a family that is only almost a family reads as a mistake.
 *
 * Coordinates are a 0-100 viewBox. A scalloped seal, not a hexagon: a hexagon around a
 * symbol is rank iconography (game tiers, XP chips), a seal is award iconography.
 */

export const SEAL_PATH =
  'M50.00,2.50 L54.11,4.38 L57.50,8.68 L60.36,12.46 L63.68,13.54 L68.22,12.16 L73.49,10.68 ' +
  'L77.92,11.57 L80.14,15.51 L80.36,20.98 L80.45,25.72 L82.50,28.54 L86.98,30.10 L92.12,32.00 ' +
  'L95.18,35.32 L94.66,39.81 L91.62,44.36 L88.91,48.25 L88.50,50.00 L90.03,53.60 L93.29,57.86 ' +
  'L95.36,62.52 L94.05,66.53 L89.64,69.09 L84.50,70.62 L81.15,72.63 L80.27,76.45 L80.41,81.80 ' +
  'L79.34,86.79 L75.92,89.27 L70.85,88.75 L65.80,86.96 L61.90,86.62 L58.94,89.19 L55.91,93.60 ' +
  'L52.11,97.01 L50.00,97.50 L45.89,95.62 L42.50,91.32 L39.64,87.54 L36.32,86.46 L31.78,87.84 ' +
  'L26.51,89.32 L22.08,88.43 L19.86,84.49 L19.64,79.02 L19.55,74.28 L17.50,71.46 L13.02,69.90 ' +
  'L7.88,68.00 L4.82,64.68 L5.34,60.19 L8.38,55.64 L11.09,51.75 L11.50,50.00 L9.97,46.40 ' +
  'L6.71,42.14 L4.64,37.48 L5.95,33.47 L10.36,30.91 L15.50,29.38 L18.85,27.37 L19.73,23.55 ' +
  'L19.59,18.20 L20.66,13.21 L24.08,10.73 L29.15,11.25 L34.20,13.04 L38.10,13.38 L41.06,10.81 ' +
  'L44.09,6.40 L47.89,2.99 Z';
