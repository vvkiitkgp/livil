/** Where a pressed message sat on screen, in window coordinates. */
export type MenuAnchor = { y: number; height: number };

export const MENU_PILL_HEIGHT = 60;
export const MENU_GAP = 8;
export const MENU_ROW_HEIGHT = 48;
export const MENU_HEADER_HEIGHT = 34;
export const MENU_CARD_PADDING = 8;
const SCREEN_EDGE = 8;

/** The card's height for `rows` actions, so the stack can be placed before it is drawn. */
export function menuCardHeight(rows: number): number {
  return MENU_HEADER_HEIGHT + rows * MENU_ROW_HEIGHT + MENU_CARD_PADDING * 2;
}

/**
 * Where the long-press stack goes: reactions, the message, then its actions. The message stays
 * where it was when all of it fits. Otherwise the stack moves just enough to fit between the
 * status bar and the home indicator, and a message too tall to fit is cut.
 *
 * `slideFrom` is how far below its resting place the stack starts, so the message visibly lifts
 * from where it was pressed.
 */
export function messageMenuLayout({
  anchor,
  cardHeight,
  windowHeight,
  topInset,
  bottomInset,
}: {
  anchor: MenuAnchor | null;
  cardHeight: number;
  windowHeight: number;
  topInset: number;
  bottomInset: number;
}): { top: number; rowMaxHeight: number; slideFrom: number } {
  const first = topInset + SCREEN_EDGE;
  const last = windowHeight - bottomInset - SCREEN_EDGE;
  const chrome = MENU_PILL_HEIGHT + MENU_GAP + MENU_GAP + cardHeight;
  const rowMaxHeight = Math.max(0, last - first - chrome);
  // Unmeasured: a typical bubble, with the stack near the middle of the screen.
  const rowY = anchor ? anchor.y : windowHeight * 0.35;
  const rowHeight = Math.min(anchor ? anchor.height : 60, rowMaxHeight);
  const total = chrome + rowHeight;
  const wanted = rowY - MENU_PILL_HEIGHT - MENU_GAP;
  const top = Math.max(first, Math.min(wanted, last - total));
  return { top, rowMaxHeight, slideFrom: anchor ? wanted - top : 0 };
}
