/* eslint-disable no-bitwise -- ID3 encodes lengths as syncsafe integers (7 bits per byte)
   and packs flags into single bytes, so bit manipulation IS the format. Rewriting these as
   arithmetic would be less readable and no safer. */
/**
 * Pulling cover art out of the audio file itself.
 *
 * A mastered file almost always already carries its artwork, so asking the artist to
 * re-attach it — twelve times, for an album — is asking them to redo work. This reads the
 * embedded image and uses it as the default; they can still replace or crop it.
 *
 * The parser is pure and takes bytes, so the fiddly parts (syncsafe integers, the three
 * incompatible ID3 layouts, UTF-16 terminators) are testable without a browser.
 *
 * Supports ID3v2.2 / v2.3 / v2.4, which covers MP3 and anything else carrying an ID3 tag.
 * Returns null for everything else — M4A's `covr` atom and FLAC's picture block use
 * different container formats and are not handled yet.
 */

export type EmbeddedImage = { data: Uint8Array; mime: string };

/** ID3 sizes are "syncsafe": 7 bits per byte, high bit always clear. */
function syncsafe(b: Uint8Array, at: number): number {
  return (
    ((b[at]! & 0x7f) << 21) |
    ((b[at + 1]! & 0x7f) << 14) |
    ((b[at + 2]! & 0x7f) << 7) |
    (b[at + 3]! & 0x7f)
  );
}

function uint32be(b: Uint8Array, at: number): number {
  return (
    ((b[at]! << 24) >>> 0) + (b[at + 1]! << 16) + (b[at + 2]! << 8) + b[at + 3]!
  );
}

const uint24be = (b: Uint8Array, at: number): number =>
  (b[at]! << 16) + (b[at + 1]! << 8) + b[at + 2]!;

const ascii = (b: Uint8Array, at: number, len: number): string =>
  String.fromCharCode(...b.subarray(at, at + len));

/** Index just past a null terminator, honouring UTF-16's two-byte terminator. */
function skipTerminatedString(b: Uint8Array, from: number, end: number, encoding: number): number {
  const wide = encoding === 1 || encoding === 2;
  if (wide) {
    for (let i = from; i + 1 < end; i += 2) {
      if (b[i] === 0 && b[i + 1] === 0) return i + 2;
    }
    return end;
  }
  for (let i = from; i < end; i++) {
    if (b[i] === 0) return i + 1;
  }
  return end;
}

/** Read a null-terminated Latin-1 string, returning it and the index just past it. */
function readLatin1(b: Uint8Array, from: number, end: number): [string, number] {
  let i = from;
  while (i < end && b[i] !== 0) i++;
  return [ascii(b, from, i - from), Math.min(end, i + 1)];
}

/** How big the tag claims to be, or 0 if these bytes are not an ID3 tag. */
export function id3TagSize(header: Uint8Array): number {
  if (header.length < 10) return 0;
  if (ascii(header, 0, 3) !== 'ID3') return 0;
  const footer = (header[5]! & 0x10) !== 0 ? 10 : 0;
  return 10 + syncsafe(header, 6) + footer;
}

function parseApic(
  b: Uint8Array,
  start: number,
  end: number,
  version: number,
): EmbeddedImage | null {
  if (start >= end) return null;
  const encoding = b[start]!;
  let at = start + 1;
  let mime: string;

  if (version === 2) {
    // v2.2 stores a fixed three-character format code, not a MIME type.
    const code = ascii(b, at, 3).toUpperCase();
    at += 3;
    mime = code === 'PNG' ? 'image/png' : 'image/jpeg';
  } else {
    [mime, at] = readLatin1(b, at, end);
    if (!mime) mime = 'image/jpeg';
    // Some writers store a bare "JPG"/"PNG" here despite the spec.
    if (!mime.includes('/')) {
      mime = /png/i.test(mime) ? 'image/png' : 'image/jpeg';
    }
  }

  at += 1; // picture type
  at = skipTerminatedString(b, at, end, encoding); // description
  if (at >= end) return null;

  return { data: b.subarray(at, end), mime };
}

/**
 * Find the embedded cover in a complete ID3 tag.
 *
 * Prefers picture type 3 (front cover) when a tag carries several — files often also embed
 * an artist photo or a back cover, and picking the first would be a coin flip.
 */
export function extractId3Cover(tag: Uint8Array): EmbeddedImage | null {
  if (id3TagSize(tag) === 0) return null;

  const version = tag[3]!;
  const tagEnd = Math.min(tag.length, 10 + syncsafe(tag, 6));
  // An extended header sits between the tag header and the first frame.
  let at = 10;
  if ((tag[5]! & 0x40) !== 0 && version >= 3) {
    const extSize = version === 4 ? syncsafe(tag, 10) : uint32be(tag, 10);
    at += version === 4 ? extSize : extSize + 4;
  }

  const idLen = version === 2 ? 3 : 4;
  const headerLen = version === 2 ? 6 : 10;
  const wanted = version === 2 ? 'PIC' : 'APIC';

  let fallback: EmbeddedImage | null = null;

  while (at + headerLen <= tagEnd) {
    const id = ascii(tag, at, idLen);
    // Padding: the rest of the tag is zeroes.
    if (id.charCodeAt(0) === 0) break;

    const size =
      version === 2
        ? uint24be(tag, at + 3)
        : version === 4
          ? syncsafe(tag, at + 4)
          : uint32be(tag, at + 4);

    if (size <= 0 || at + headerLen + size > tagEnd) break;

    if (id === wanted) {
      const body = at + headerLen;
      const image = parseApic(tag, body, body + size, version);
      if (image && image.data.length > 0) {
        // Picture type byte sits just after the MIME/format field.
        const isFront = version === 2 ? tag[body + 4] === 3 : true;
        if (isFront) return image;
        fallback ??= image;
      }
    }

    at += headerLen + size;
  }

  return fallback;
}

const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

/**
 * Read a file's embedded cover, or null.
 *
 * Only the tag is read, not the whole file — the header names its own length, so a 2 GB
 * file costs two small slices. Never throws: missing artwork is a prompt, not an error.
 */
export async function embeddedCoverFrom(file: File): Promise<File | null> {
  try {
    const header = new Uint8Array(await file.slice(0, 10).arrayBuffer());
    const size = id3TagSize(header);
    if (size === 0 || size > file.size) return null;

    const tag = new Uint8Array(await file.slice(0, size).arrayBuffer());
    const image = extractId3Cover(tag);
    if (!image) return null;

    const ext = EXT_BY_MIME[image.mime] ?? 'jpg';
    const base = file.name.replace(/\.[^.]+$/, '');
    // `slice()` copies out of the tag buffer so the whole tag can be collected.
    return new File([image.data.slice()], `${base}-cover.${ext}`, { type: image.mime });
  } catch {
    return null;
  }
}
