import { useEffect, useState } from 'react';

/**
 * Small square preview of a track's cover art.
 *
 * Artwork is now often chosen for the artist — matched from the folder by filename, or read
 * out of the file's own ID3 tag — so showing it is not decoration. It is the only way to
 * catch a wrong match before twelve tracks publish with the wrong picture.
 *
 * The object URL is created and revoked per file. Leaking one per row would pin a whole
 * decoded image in memory for the life of the page, which on a large folder is real.
 */
export function CoverThumb({
  file,
  onClick,
  disabled,
}: {
  file: File | null;
  onClick: () => void;
  disabled?: boolean;
}) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!file) {
      setUrl(null);
      return;
    }
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);

  return (
    <button
      type="button"
      className="thumb"
      onClick={onClick}
      disabled={disabled}
      title={file ? 'Change cover art' : 'Add cover art'}
      aria-label={file ? 'Change cover art' : 'Add cover art'}
    >
      {url ? <img src={url} alt="" /> : <span className="thumb__empty">Art</span>}
    </button>
  );
}
