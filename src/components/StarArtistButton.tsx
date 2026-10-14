import React, { useState } from 'react';
import { Button } from './Button';
import { useRelationships } from '../contexts/RelationshipContext';
import { useToast } from '../contexts/ToastContext';

/**
 * "Star" beside the artist's name in the full-screen player: star the person whose song is
 * playing without leaving it. Starring is what puts their next upload in front of the
 * viewer — the New music push and a higher place in both Home feeds.
 *
 * Shown only when starring is the next step: nothing for yourself, a friend (friends are
 * already closer than a star), a pending request, a block, or an item with no real person
 * behind it (Jam items carry an empty authorId). Once starred it reads "Starred"; removing
 * a star stays on their profile, where it can be confirmed.
 */
export function StarArtistButton({ authorId, artistName }: { authorId: string; artistName: string }) {
  const { status, addStar, ready } = useRelationships();
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);

  // Until the viewer's relationships are loaded everyone reads as a stranger, and a Star on
  // a friend can only fail (add_star refuses friends).
  if (!authorId || !ready) { return null; }
  const current = status(authorId);
  if (current !== 'none' && current !== 'star') { return null; }

  if (current === 'star') {
    return (
      <Button
        label="Starred"
        icon="star"
        variant="selected"
        size="sm"
        onMedia
        accessibilityLabel={`You star ${artistName}`}
        onPress={() => showToast(`You'll hear when ${artistName} drops a new song.`, { kind: 'info' })}
      />
    );
  }

  return (
    <Button
      label="Star"
      icon="star"
      variant="secondary"
      size="sm"
      onMedia
      busy={busy}
      accessibilityLabel={`Star ${artistName}`}
      onPress={() => {
        setBusy(true);
        addStar(authorId)
          .then(() => showToast(`Starred. You'll hear when ${artistName} drops a new song.`, { kind: 'success' }))
          .catch((e: unknown) => {
            const friends = e instanceof Error && /already_friends/.test(e.message);
            showToast(
              friends
                ? `You and ${artistName} are friends — you'll hear about their songs anyway.`
                : `Couldn't star ${artistName}. Try again.`,
              { kind: friends ? 'info' : 'error' },
            );
          })
          .finally(() => setBusy(false));
      }}
    />
  );
}
