/* eslint-disable no-bitwise -- ID3 encodes lengths as syncsafe integers (7 bits per byte)
   and packs flags into single bytes, so bit manipulation IS the format. Rewriting these as
   arithmetic would be less readable and no safer. */
/**
 * ID3 embedded-cover extraction.
 *
 * Binary parsing with three incompatible layouts, two integer encodings and an
 * encoding-dependent string terminator — every one of which fails silently by returning
 * the wrong byte range, i.e. a corrupt image rather than an error. Tests build real tags
 * byte by byte rather than mocking, because the bugs live in the byte offsets.
 */
import { extractId3Cover, id3TagSize } from '../embeddedArt';

const latin1 = (s: string) => Array.from(s, c => c.charCodeAt(0));

/** ID3 sizes above the frame level are 7 bits per byte. */
const syncsafeBytes = (n: number) => [
  (n >> 21) & 0x7f,
  (n >> 14) & 0x7f,
  (n >> 7) & 0x7f,
  n & 0x7f,
];

const uint32Bytes = (n: number) => [
  (n >>> 24) & 0xff,
  (n >>> 16) & 0xff,
  (n >>> 8) & 0xff,
  n & 0xff,
];

const PIXELS = [0xff, 0xd8, 0xff, 0xe0, 0x01, 0x02, 0x03];

type FrameOpts = {
  version?: 3 | 4;
  mime?: string;
  picType?: number;
  description?: number[];
  encoding?: number;
  data?: number[];
};

function buildTag({
  version = 3,
  mime = 'image/jpeg',
  picType = 3,
  description = [0x00],
  encoding = 0,
  data = PIXELS,
}: FrameOpts = {}): Uint8Array {
  const payload = [
    encoding,
    ...latin1(mime),
    0x00,
    picType,
    ...description,
    ...data,
  ];
  const frame = [
    ...latin1('APIC'),
    ...(version === 4 ? syncsafeBytes(payload.length) : uint32Bytes(payload.length)),
    0x00,
    0x00,
    ...payload,
  ];
  return Uint8Array.from([
    ...latin1('ID3'),
    version,
    0x00,
    0x00,
    ...syncsafeBytes(frame.length),
    ...frame,
  ]);
}

describe('id3TagSize', () => {
  it('reads the declared tag length', () => {
    const tag = buildTag();
    expect(id3TagSize(tag)).toBe(tag.length);
  });

  it('returns 0 when the bytes are not an ID3 tag', () => {
    expect(id3TagSize(Uint8Array.from(latin1('RIFF......')))).toBe(0);
  });

  it('returns 0 for a truncated header', () => {
    expect(id3TagSize(Uint8Array.from([0x49, 0x44, 0x33]))).toBe(0);
  });
});

describe('extractId3Cover', () => {
  it('extracts a v2.3 front cover', () => {
    const image = extractId3Cover(buildTag({ version: 3 }));
    expect(image).not.toBeNull();
    expect(image!.mime).toBe('image/jpeg');
    expect(Array.from(image!.data)).toEqual(PIXELS);
  });

  it('extracts a v2.4 cover, whose frame size is syncsafe', () => {
    // The v2.3/v2.4 frame-size difference is the classic ID3 bug: reading a syncsafe size
    // as a plain integer silently overshoots and returns garbage.
    const image = extractId3Cover(buildTag({ version: 4 }));
    expect(Array.from(image!.data)).toEqual(PIXELS);
  });

  it('honours the declared PNG mime type', () => {
    const image = extractId3Cover(buildTag({ mime: 'image/png' }));
    expect(image!.mime).toBe('image/png');
  });

  it('repairs a bare "PNG" written where a mime type belongs', () => {
    // Some taggers write the v2.2 format code into a v2.3 frame.
    expect(extractId3Cover(buildTag({ mime: 'PNG' }))!.mime).toBe('image/png');
  });

  it('skips a UTF-16 description with its two-byte terminator', () => {
    const image = extractId3Cover(
      buildTag({
        encoding: 1,
        // "Hi" in UTF-16LE with BOM, then the 00 00 terminator.
        description: [0xff, 0xfe, 0x48, 0x00, 0x69, 0x00, 0x00, 0x00],
      }),
    );
    expect(Array.from(image!.data)).toEqual(PIXELS);
  });

  it('skips a non-empty Latin-1 description', () => {
    const image = extractId3Cover(buildTag({ description: [...latin1('cover'), 0x00] }));
    expect(Array.from(image!.data)).toEqual(PIXELS);
  });

  it('returns null when there is no ID3 tag', () => {
    expect(extractId3Cover(Uint8Array.from(latin1('not a tag at all')))).toBeNull();
  });

  it('returns null for a tag with no picture frame', () => {
    const frame = [...latin1('TIT2'), ...uint32Bytes(4), 0, 0, 0x00, 0x41, 0x42, 0x43];
    const tag = Uint8Array.from([
      ...latin1('ID3'),
      3,
      0,
      0,
      ...syncsafeBytes(frame.length),
      ...frame,
    ]);
    expect(extractId3Cover(tag)).toBeNull();
  });

  it('returns null when the picture frame carries no bytes', () => {
    expect(extractId3Cover(buildTag({ data: [] }))).toBeNull();
  });

  it('stops at padding rather than reading past the frames', () => {
    const real = buildTag();
    const padded = new Uint8Array(real.length + 32);
    padded.set(real);
    // Trailing zeroes must not be parsed as a frame with a zero-length id.
    expect(Array.from(extractId3Cover(padded)!.data)).toEqual(PIXELS);
  });
});
