/**
 * The tag input — chips plus a field that turns typing into one of them.
 *
 * Deliberately not a plain comma-separated text box. The stored value is normalized
 * (`shared/constants/tags.ts` lowercases, joins words with underscores, drops the '#'), so a
 * raw text box would show the artist something different from what it saved, and the
 * difference only surfaces later when a search does not find the track. A chip commits the
 * normalized form the moment it is created: what you see on screen is the row.
 *
 * Committing on space as well as Enter is what makes "lofi latenight bedroom" behave the way
 * it does everywhere else hashtags exist. A tag can never contain a space, so nothing is lost.
 */
import { useState, type KeyboardEvent } from 'react';
import { MAX_TAGS_PER_TRACK, addTags, formatTag } from '@shared/constants/tags';

export function TagField({
  tags,
  onChange,
  disabled = false,
  placeholder = 'Add a tag',
  label,
}: {
  tags: string[];
  onChange: (tags: string[]) => void;
  disabled?: boolean;
  placeholder?: string;
  /** Names the field for screen readers, and captions it when it stands alone. */
  label: string;
}) {
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  const commit = (raw: string) => {
    const result = addTags(tags, raw);
    setError(result.error);
    if (result.tags.length !== tags.length) onChange(result.tags);
    // Cleared either way. Leaving rejected text in the field invites the artist to press
    // Enter again on input that will be rejected again, with no indication why not.
    setDraft('');
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' || event.key === ',' || event.key === ' ') {
      // Enter inside a form would submit it; the separators would otherwise be typed into
      // a tag that cannot contain them.
      event.preventDefault();
      commit(draft);
      return;
    }
    // Backspace on an empty field removes the last chip — the standard behaviour of every
    // chip input, and the only way to fix a typo without reaching for the mouse.
    if (event.key === 'Backspace' && draft === '' && tags.length > 0) {
      event.preventDefault();
      setError(null);
      onChange(tags.slice(0, -1));
    }
  };

  const full = tags.length >= MAX_TAGS_PER_TRACK;

  return (
    <div className="tags">
      <div className="tags__row">
        {tags.map(tag => (
          <span key={tag} className="tag">
            <span className="tag__text">{formatTag(tag)}</span>
            {!disabled && (
              <button
                type="button"
                className="credit__remove"
                aria-label={`Remove tag ${tag}`}
                onClick={() => {
                  setError(null);
                  onChange(tags.filter(t => t !== tag));
                }}
              >
                ×
              </button>
            )}
          </span>
        ))}
        {!disabled && !full && (
          <input
            className="tags__input"
            value={draft}
            aria-label={label}
            placeholder={tags.length === 0 ? placeholder : ''}
            onChange={e => {
              setDraft(e.target.value);
              if (error) setError(null);
            }}
            onKeyDown={onKeyDown}
            // Committing on blur saves the tag someone typed and then clicked away from,
            // which otherwise disappears silently at publish.
            onBlur={() => commit(draft)}
          />
        )}
      </div>
      {error && <span className="tags__error">{error}</span>}
    </div>
  );
}
