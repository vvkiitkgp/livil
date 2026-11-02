/**
 * Mics as the Record screen shows them. The audio library reports each input with the OS's
 * own type name — iOS port types ("MicrophoneBuiltIn", "MicrophoneWired", …) in `category`,
 * Android's in `type` ("Built-in Mic", "Wired Headset", …). Pure, so it unit-tests.
 */

export type MicKind = 'phone' | 'wired' | 'bluetooth' | 'usb' | 'other';
export type Mic = { id: string; kind: MicKind; label: string; detail: string | null };
export type RawDevice = { id: string; name?: string; category?: string; type?: string };

export function micKind(osType: string | undefined): MicKind {
  const t = osType ?? '';
  if (/MicrophoneBuiltIn|Built-in Mic/i.test(t)) return 'phone';
  if (/MicrophoneWired|HeadsetMic|Wired Headset/i.test(t)) return 'wired';
  if (/Bluetooth/i.test(t)) return 'bluetooth';
  // iOS "USBAudio"; Android USB device (11) / USB headset (22).
  if (/USB|Other \((11|22)\)/i.test(t)) return 'usb';
  return 'other';
}

const LABEL: Record<MicKind, (ios: boolean) => string> = {
  phone: ios => (ios ? 'iPhone mic' : 'Phone mic'),
  wired: () => 'Earphones mic',
  bluetooth: () => 'Bluetooth mic',
  usb: () => 'USB mic',
  other: () => 'Other mic',
};

/**
 * The mics worth offering, phone first. Android lists every built-in mic (bottom, back…) and
 * internal inputs like the call line; those collapse to one "Phone mic" or are left out.
 */
export function toMics(devices: RawDevice[], ios: boolean): Mic[] {
  const out: Mic[] = [];
  for (const d of devices) {
    const kind = micKind(d.category ?? d.type);
    if (kind === 'other' && !ios) continue;
    if (!ios && out.some(m => m.kind === kind)) continue;
    const label = LABEL[kind](ios);
    const name = (d.name ?? '').trim();
    // The device's own name when it says more ("EarPods", "Blue Yeti"), not "iPhone Microphone".
    const detail = name && kind !== 'phone' && name.toLowerCase() !== label.toLowerCase() ? name : null;
    out.push({ id: d.id, kind, label: kind === 'other' && name ? name : label, detail });
  }
  const order: MicKind[] = ['phone', 'wired', 'usb', 'bluetooth', 'other'];
  return out.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
}

/**
 * Android records from whatever it picks (the library can't choose there): a plugged-in
 * headset mic wins, then USB, else the phone's own.
 */
export function androidLikelyMic(mics: Mic[]): Mic | null {
  return mics.find(m => m.kind === 'wired') ?? mics.find(m => m.kind === 'usb') ?? mics.find(m => m.kind === 'phone') ?? null;
}
