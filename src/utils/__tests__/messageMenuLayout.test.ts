import {
  MENU_GAP,
  MENU_PILL_HEIGHT,
  menuCardHeight,
  messageMenuLayout,
} from '../messageMenuLayout';

const screen = { windowHeight: 900, topInset: 50, bottomInset: 30 };
const cardHeight = menuCardHeight(3);
const rowTop = (top: number) => top + MENU_PILL_HEIGHT + MENU_GAP;

describe('messageMenuLayout', () => {
  it('leaves the message where it was when everything fits', () => {
    const { top, slideFrom } = messageMenuLayout({ ...screen, cardHeight, anchor: { y: 300, height: 50 } });
    expect(rowTop(top)).toBe(300);
    expect(slideFrom).toBe(0);
  });

  it('moves a message near the bottom up just enough for its actions to fit', () => {
    const anchor = { y: 800, height: 50 };
    const { top, slideFrom } = messageMenuLayout({ ...screen, cardHeight, anchor });
    const bottomOfStack = rowTop(top) + anchor.height + MENU_GAP + cardHeight;
    expect(bottomOfStack).toBe(900 - 30 - 8);
    expect(rowTop(top)).toBeLessThan(800);
    // It starts where it was pressed, and lifts from there.
    expect(rowTop(top) + slideFrom).toBe(800);
  });

  it('moves a message near the top down, clear of the status bar', () => {
    const { top, slideFrom } = messageMenuLayout({ ...screen, cardHeight, anchor: { y: 60, height: 50 } });
    expect(top).toBe(50 + 8);
    expect(rowTop(top) + slideFrom).toBe(60);
  });

  it('cuts a message too tall to fit, keeping the reactions and actions on screen', () => {
    const { top, rowMaxHeight } = messageMenuLayout({ ...screen, cardHeight, anchor: { y: 100, height: 2000 } });
    expect(top).toBe(58);
    expect(rowTop(top) + rowMaxHeight + MENU_GAP + cardHeight).toBe(900 - 30 - 8);
  });

  it('still places the stack on screen when the bubble could not be measured', () => {
    const { top, slideFrom } = messageMenuLayout({ ...screen, cardHeight, anchor: null });
    expect(top).toBeGreaterThanOrEqual(58);
    expect(slideFrom).toBe(0);
  });

  it('a card is as tall as its rows', () => {
    expect(menuCardHeight(1)).toBeLessThan(menuCardHeight(3));
  });
});
