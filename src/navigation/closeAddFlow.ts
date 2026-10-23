/** Only what this needs, so every screen's own typed navigation prop fits. */
type StackNav = {
  getState: () => { routes: ReadonlyArray<{ name: string }> };
  pop: (count?: number) => void;
  goBack: () => void;
};

/**
 * Leave the "+ Post" flow after something was posted.
 *
 * The chooser (AddToLivil) opens Upload and "Repost a song" ON TOP of itself, and a Livil
 * pick there opens the clip editor on top again. They used to `replace` instead, and
 * swapping one modal for another plays on iOS as the sheet closing and a new one opening
 * (owner, 2026-10-22). Stacked, a plain goBack() after posting would land back on the
 * chooser or the search, so this pops past the chooser to wherever "+ Post" was tapped.
 *
 * Opened any other way (a post's Repost button, Search, a chat card) there is no chooser
 * below, and this is an ordinary goBack(). Cancel buttons keep plain goBack(): one step
 * back, to the screen that opened this one.
 */
export function closeAddFlow(navigation: StackNav): void {
  const routes = navigation.getState().routes;
  let chooser = -1;
  for (let i = routes.length - 1; i >= 0; i--) {
    if (routes[i].name === 'AddToLivil') { chooser = i; break; }
  }
  if (chooser >= 0) {
    navigation.pop(routes.length - chooser);
  } else {
    navigation.goBack();
  }
}
