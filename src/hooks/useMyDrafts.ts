import { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { deleteDraft, draftsAvailable, listDrafts } from '../services/drafts';
import { getMyUserId } from '../services/session';
import type { DraftSummary } from '../screens/studio/draftFormat';

/**
 * The signed-in user's drafts, from this phone. Re-read on every focus, so coming back from the
 * Editor or Upload after a save shows it. Upload drafts only in the store app, while the Editor
 * is a developer-only prototype. Never throws: none → [].
 */
export function useMyDrafts() {
  const [drafts, setDrafts] = useState<DraftSummary[]>([]);
  const [userId, setUserId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!draftsAvailable()) { setDrafts([]); return; }
    const me = await getMyUserId().catch(() => null);
    setUserId(me);
    const all = me ? await listDrafts(me) : [];
    setDrafts(__DEV__ ? all : all.filter(d => d.uploadKind));
  }, []);

  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));

  const remove = useCallback(async (id: string) => {
    if (!userId) return;
    await deleteDraft(userId, id);
    setDrafts(d => d.filter(x => x.id !== id));
  }, [userId]);

  return { drafts, remove, refresh };
}
