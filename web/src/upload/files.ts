/**
 * Collecting files from a drop, including whole folders.
 *
 * `DataTransfer.files` is flat and EMPTY for a dropped directory — dragging in an album
 * folder yields nothing without walking the entry tree, which is the one interaction this
 * client exists to make good. `webkitGetAsEntry` is the only way to do that, and is
 * supported everywhere this app runs.
 */

function readEntry(entry: FileSystemEntry): Promise<File[]> {
  if (entry.isFile) {
    const fileEntry = entry as FileSystemFileEntry;
    return new Promise(resolve => {
      fileEntry.file(
        f => resolve([f]),
        () => resolve([]),
      );
    });
  }
  if (!entry.isDirectory) return Promise.resolve([]);

  const reader = (entry as FileSystemDirectoryEntry).createReader();
  // readEntries returns at most 100 entries per call and signals the end with an empty
  // batch, so a single call silently truncates a large album folder.
  const readBatch = (): Promise<FileSystemEntry[]> =>
    new Promise(resolve => {
      reader.readEntries(
        entries => resolve(entries),
        () => resolve([]),
      );
    });

  return (async () => {
    const out: File[] = [];
    for (;;) {
      const batch = await readBatch();
      if (batch.length === 0) break;
      for (const child of batch) out.push(...(await readEntry(child)));
    }
    return out;
  })();
}

export async function filesFromDataTransfer(dt: DataTransfer): Promise<File[]> {
  const items = Array.from(dt.items ?? []);
  const entries = items
    .map(item => item.webkitGetAsEntry())
    .filter((e): e is FileSystemEntry => e !== null);

  if (entries.length === 0) return Array.from(dt.files ?? []);

  const nested = await Promise.all(entries.map(readEntry));
  return nested.flat();
}

const isMedia = (f: File) =>
  f.type.startsWith('audio/') || f.type.startsWith('video/') ||
  // Some browsers report an empty type for less common containers (AIFF is the usual
  // culprit). Fall back to the extension rather than silently dropping the artist's file.
  /\.(mp3|m4a|aac|wav|aiff?|flac|ogg|mp4|mov|mkv|webm)$/i.test(f.name);

const isImage = (f: File) => f.type.startsWith('image/') || /\.(jpe?g|png|webp|heic)$/i.test(f.name);

const stem = (name: string) => name.replace(/\.[^.]+$/, '').toLowerCase().trim();

export type PairedItem = {
  media: File;
  /** Matched by filename stem, else the single shared cover, else null. */
  image: File | null;
};

/**
 * Pair each media file with its artwork.
 *
 * Two conventions cover almost every real folder: per-track art named after the track
 * (`01 Intro.mp3` + `01 Intro.jpg`), or one album cover for everything (`cover.jpg`). Both
 * are handled, stem match first. Anything unmatched is left null for the artist to fill in
 * — guessing wrong is worse than asking, since cover art is required to publish.
 */
export function pairAssets(files: File[]): { items: PairedItem[]; sharedImage: File | null } {
  const media = files.filter(isMedia);
  const images = files.filter(isImage);
  const byStem = new Map(images.map(img => [stem(img.name), img]));

  const matched = new Set<File>();
  const items = media.map(m => {
    const hit = byStem.get(stem(m.name)) ?? null;
    if (hit) matched.add(hit);
    return { media: m, image: hit };
  });

  // A single leftover image is an album cover; several are ambiguous and left alone.
  const leftover = images.filter(img => !matched.has(img));
  const sharedImage = leftover.length === 1 ? leftover[0]! : null;

  return {
    items: items.map(it => ({ ...it, image: it.image ?? sharedImage })),
    sharedImage,
  };
}
