import { androidLikelyMic, micKind, toMics } from '../audioDevices';

describe('mics', () => {
  it('names iPhone inputs plainly', () => {
    const mics = toMics([
      { id: 'w', name: 'EarPods', category: 'MicrophoneWired' },
      { id: 'b', name: 'iPhone Microphone', category: 'MicrophoneBuiltIn' },
    ], true);
    expect(mics.map(m => [m.id, m.label, m.detail])).toEqual([['b', 'iPhone mic', null], ['w', 'Earphones mic', 'EarPods']]);
  });

  it('collapses Android built-in mics and hides internal inputs', () => {
    const mics = toMics([
      { id: '1', name: 'Pixel 8', type: 'Built-in Mic' },
      { id: '2', name: 'Pixel 8', type: 'Built-in Mic' },
      { id: '3', name: '', type: 'Other (18)' },
      { id: '4', name: 'USB-C earbuds', type: 'Other (22)' },
    ], false);
    expect(mics.map(m => m.label)).toEqual(['Phone mic', 'USB mic']);
    expect(androidLikelyMic(mics)?.id).toBe('4');
  });

  it('knows the OS type names', () => {
    expect(micKind('BluetoothHFP')).toBe('bluetooth');
    expect(micKind('Wired Headset')).toBe('wired');
    expect(micKind('USBAudio')).toBe('usb');
    expect(micKind(undefined)).toBe('other');
  });
});
