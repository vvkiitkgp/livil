/**
 * Compliance tests for the custom Sign in with Apple button.
 *
 * WHY THIS COMPONENT HAS TESTS
 *
 * kb/standards/testing.md says components are tested only where logic lives in them.
 * This one qualifies for a different reason than geometry: its appearance is a contract
 * with a third party. App Review rejected 2.1.1 (75) under guideline 4 because the
 * button's Apple logo was an icon-library redraw rather than Apple's own artwork, and
 * "App Review evaluates all custom Sign in with Apple buttons" (HIG). A restyle that
 * drifts from the rules costs a rejection and a day, and nothing in the app looks
 * broken when it happens.
 *
 * These pin the rules from the Human Interface Guidelines section "Creating a custom
 * Sign in with Apple button" as props on the rendered tree, not as a snapshot.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { createHash } from 'crypto';

jest.mock('../../services/appleAuth', () => ({
  isAppleSignInAvailable: () => true,
  signInWithApple: jest.fn(),
  isAppleSignInCancellation: () => false,
}));

import AppleSignInButton, {
  APPLE_BUTTON_DEFAULT_HEIGHT,
  APPLE_LOGO_CANVAS,
  APPLE_LOGO_PATH,
} from '../AppleSignInButton';

type Node = ReactTestRenderer.ReactTestInstance;

function render(props: Partial<React.ComponentProps<typeof AppleSignInButton>> = {}) {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(<AppleSignInButton onError={() => {}} {...props} />);
  });
  return tree;
}

const named = (tree: ReactTestRenderer.ReactTestRenderer, name: string): Node[] =>
  tree.root.findAll(
    n => typeof n.type !== 'string' && (n.type as { displayName?: string })?.displayName === name,
  );

/** The button's resolved style in its resting (not pressed) state. */
function buttonStyle(tree: ReactTestRenderer.ReactTestRenderer) {
  const host = tree.root.findAll(n => n.props?.accessibilityLabel === 'Continue with Apple')[0]!;
  const style = typeof host.props.style === 'function' ? host.props.style({ pressed: false }) : host.props.style;
  return StyleSheet.flatten(style);
}

function title(tree: ReactTestRenderer.ReactTestRenderer) {
  const node = tree.root.findAll(
    n => typeof n.type !== 'string' && n.props?.children === 'Continue with Apple',
  )[0]!;
  return { node, style: StyleSheet.flatten(node.props.style) };
}

describe('AppleSignInButton (HIG: custom Sign in with Apple button)', () => {
  it("draws Apple's own logo artwork, unmodified", () => {
    // SHA-256 of the path in "Logo - SIWA - Left-aligned - Black - Small.svg" from
    // Apple Design Resources. If this fails, someone edited, rounded or replaced the
    // artwork. Re-copy it from Apple's file; do not update the hash to match a redraw.
    expect(createHash('sha256').update(APPLE_LOGO_PATH).digest('hex')).toBe(
      'd1fc966b3f45b4b831ae22b089bc2a114b2c8b9e0b0b5957ed60838464ae943f',
    );
    const tree = render();
    const paths = named(tree, 'Path');
    expect(paths).toHaveLength(1);
    expect(paths[0]!.props.d).toBe(APPLE_LOGO_PATH);
  });

  it('scales the whole logo file to the button height without cropping it', () => {
    for (const height of [APPLE_BUTTON_DEFAULT_HEIGHT, 44, 60]) {
      const tree = render({ height });
      const svg = named(tree, 'Svg')[0]!;
      // "Match the height of the logo file to the height of the button."
      expect(svg.props.height).toBe(height);
      expect(buttonStyle(tree).height).toBe(height);
      // "Don't crop the logo file": the full 24x44 canvas, aspect ratio intact.
      expect(svg.props.viewBox).toBe('0 0 24 44');
      expect(svg.props.width).toBeCloseTo((height * APPLE_LOGO_CANVAS.width) / APPLE_LOGO_CANVAS.height, 6);
    }
  });

  it('adds no vertical padding and no gap between the logo file and the title', () => {
    const style = buttonStyle(render({ style: { paddingVertical: 17, gap: 8 } }));
    // "Don't add vertical padding." A call site's padding must lose.
    expect(style.paddingVertical).toBe(0);
    // The file's built-in trailing padding IS the logo-to-title spacing. `gap` in the first call is
    // whatever the call site passed; the component itself must not introduce one.
    expect(buttonStyle(render()).gap).toBeUndefined();
  });

  it('lets a call site choose the title font, and defaults to the system font', () => {
    // HIG: a custom button may change the "title font ... weight and size" to
    // coordinate with the app. Default matches the lg Button beside it.
    const plain = title(render()).style;
    expect(plain.fontSize).toBe(16);
    expect(plain.fontFamily).toBeUndefined();

    const mono = title(render({ labelStyle: { fontFamily: 'CourierPrime-Bold', fontSize: 15 } })).style;
    expect(mono.fontFamily).toBe('CourierPrime-Bold');
    expect(mono.fontSize).toBe(15);
  });

  it('never lets a call site recolour the title', () => {
    // "Logo and title colors ... must be either black or white; don't use custom colors."
    expect(title(render({ labelStyle: { color: '#A855F7' } })).style.color).toBe('#000000');
  });

  it('keeps logo and title pure black on a pure white fill, whatever the call site passes', () => {
    const tree = render({ style: { backgroundColor: '#8B3DFF' } });
    expect(buttonStyle(tree).backgroundColor).toBe('#FFFFFF');
    expect(named(tree, 'Path')[0]!.props.fill).toBe('#000000');
    expect(title(tree).style.color).toBe('#000000');
  });

  it("uses one of Apple's three permitted titles", () => {
    expect(title(render()).node.props.children).toBe('Continue with Apple');
  });

  it('reserves 8% of the button width on each side once measured', () => {
    const tree = render();
    const host = tree.root.findAll(n => typeof n.props?.onLayout === 'function')[0]!;
    ReactTestRenderer.act(() => {
      host.props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 342, height: 52 } } });
    });
    // "Ensure the margin measures at least 8% of the button's width."
    expect(buttonStyle(tree).paddingHorizontal).toBeGreaterThanOrEqual(342 * 0.08);
  });

  it('stays at or above the minimum size Apple allows', () => {
    const style = buttonStyle(render());
    expect(style.minWidth).toBeGreaterThanOrEqual(140);
    expect(style.height).toBeGreaterThanOrEqual(30);
  });

  it('still lets a call site choose the corner radius', () => {
    // Explicitly allowed by the HIG, and the onboarding screen relies on it.
    expect(buttonStyle(render({ style: { borderRadius: 12 } })).borderRadius).toBe(12);
  });
});
