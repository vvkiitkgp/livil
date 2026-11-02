import { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { deleteDraft, draftsAvailable, listDrafts } from '../services/drafts';
import { getMyUserId } from '../services/session';
import type { DraftSummary } from '../screens/studio/draftFormat';

/**
 * The signed-in user's Editor drafts, from this phone. Re-read on every focus, so coming back
 * from the Editor after a save shows it. Developer builds only while the Editor is a
 * prototype (it's the only way to make a draft). Never throws: none → [].
 */
export function useMyDrafts() {
  const [drafts, setDrafts] = useState<DraftSummary[]>([]);
  const [userId, setUserId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!__DEV__ || !draftsAvailable()) { setDrafts([]); return; }
    const me = await getMyUserId().catch(() => null);
    setUserId(me);
    setDrafts(me ? await listDrafts(me) : []);
  }, []);

  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));

  const remove = useCallback(async (id: string) => {
    if (!userId) return;
    await deleteDraft(userId, id);
    setDrafts(d => d.filter(x => x.id !== id));
  }, [userId]);

  return { drafts, remove, refresh };
}
