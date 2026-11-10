import { readFileSync } from 'fs';
import { join } from 'path';
import { SHEET_ROUTES } from '../sheetRoutes';

/** Every `<Stack.Screen name="X" … options={{ presentation: … }}>` in RootNavigator. */
function sheetScreensInRootNavigator(): Set<string> {
  const src = readFileSync(join(__dirname, '..', 'RootNavigator.tsx'), 'utf8');
  const names = new Set<string>();
  for (const screen of src.split('<Stack.Screen').slice(1)) {
    const name = /name="([A-Za-z]+)"/.exec(screen)?.[1];
    const options = screen.split('/>')[0];
    if (name && /presentation:/.test(options)) { names.add(name); }
  }
  return names;
}

describe('SHEET_ROUTES', () => {
  it('names exactly the screens RootNavigator presents as sheets', () => {
    expect([...SHEET_ROUTES].sort()).toEqual([...sheetScreensInRootNavigator()].sort());
  });
});
