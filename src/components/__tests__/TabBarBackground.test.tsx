/**
 * Glass on iPhone, a plain dark bar on Android. The library's native side is left out of the
 * Android build (react-native.config.js), so Android must not even load its JavaScript.
 *
 * These read the elements each component returns rather than rendering them: every test needs a
 * fresh copy of the module, because the platform is decided when it loads.
 */

const mockLibraryLoaded = jest.fn();
const mockLiquidGlassView = () => null;
const mockBlurView = () => null;

jest.mock('@sbaiahmed1/react-native-blur', () => {
  mockLibraryLoaded();
  return { LiquidGlassView: mockLiquidGlassView, BlurView: mockBlurView };
});

type Returned = { type: unknown; props: Record<string, unknown> };

/** A fresh copy of the modules, on a phone of this platform and version. */
function loadOn(os: 'ios' | 'android', version: string | number) {
  let bar!: () => { props: { children: Returned[] } };
  let glass!: (props: { style: object }) => Returned;
  jest.isolateModules(() => {
    const { Platform } = require('react-native');
    Platform.OS = os;
    Object.defineProperty(Platform, 'Version', { value: version, configurable: true });
    bar = require('../TabBarBackground').default;
    if (os === 'ios') { glass = require('../GlassBackdrop').default; }
  });
  return { bar, glass };
}

beforeEach(() => { mockLibraryLoaded.mockClear(); });

describe('on Android', () => {
  it.each([31, 33, 35])('API %i draws a plain view and never loads the blur library', version => {
    const { bar } = loadOn('android', version);
    expect((bar().props.children[0].type as { name: string }).name).toBe('View');
    expect(mockLibraryLoaded).not.toHaveBeenCalled();
  });
});

describe('on iPhone', () => {
  it("iOS 26 uses Apple's glass, with a dark fallback for Reduce Transparency", () => {
    const element = loadOn('ios', '26.0').glass({ style: {} });
    expect(element.type).toBe(mockLiquidGlassView);
    expect(element.props.reducedTransparencyFallbackColor).not.toBe('#FFFFFF');
  });

  it('older iOS uses a dark blur, not the white-tinted fallback', () => {
    const element = loadOn('ios', '18.5').glass({ style: {} });
    expect(element.type).toBe(mockBlurView);
    expect(element.props.blurType).toBe('systemUltraThinMaterialDark');
  });
});
