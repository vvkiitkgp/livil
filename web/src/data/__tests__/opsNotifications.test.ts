/**
 * The ops editor for scheduled pushes.
 *
 * Worth pinning because a line saved here reaches every phone at the next send with no
 * review in between. A typo'd fill-in ("{name}") would go out verbatim, braces and all, so
 * the form must refuse what the table's CHECK refuses; and the preview must read the way the
 * digest will.
 */
import { fillInProblem, previewText, updateMessage, addMessage } from '../opsNotifications';

const mockUpdate = jest.fn();
const mockInsert = jest.fn();
const mockEq = jest.fn();
const mockFrom = jest.fn((_table: string) => ({
  update: (row: unknown) => { mockUpdate(row); return { eq: (c: string, v: string) => mockEq(c, v) }; },
  insert: (row: unknown) => mockInsert(row),
}));

jest.mock('../../supabase', () => ({
  supabase: { from: (table: string) => mockFrom(table) },
}));

beforeEach(() => {
  mockUpdate.mockReset();
  mockInsert.mockReset().mockResolvedValue({ error: null });
  mockEq.mockReset().mockResolvedValue({ error: null });
  mockFrom.mockClear();
});

it('accepts exactly the three digest fill-ins', () => {
  expect(fillInProblem('digest', '{names}')).toBeNull();
  expect(fillInProblem('digest', 'reposted {songs} {since} · check them out')).toBeNull();
  expect(fillInProblem('digest', '{name} reposted')).toMatch(/Only \{names\}/);
  expect(fillInProblem('digest', 'reposted {songs')).toMatch(/Only \{names\}/);
});

it('refuses any braces in a mood line, which has nothing to fill in', () => {
  expect(fillInProblem('mood_morning', 'Ssup, music buddy? 👀')).toBeNull();
  expect(fillInProblem('mood_evening', 'Hey {names}')).toMatch(/Mood lines/);
});

it('previews a digest the way a person reads it; mood lines as written', () => {
  expect(previewText('digest', '{names}')).toBe('Arjun, Kavya and 10 others');
  expect(previewText('digest', 'reposted {songs} {since} · check them out')).toBe(
    'reposted 18 songs since last night · check them out',
  );
  expect(previewText('mood_morning', 'What are you listening to?')).toBe('What are you listening to?');
});

it('edits a line by id and adds one at the given place, both in push_messages', async () => {
  await updateMessage('m-1', 'Ssup? 👀', 'What are you listening to?');
  expect(mockFrom).toHaveBeenCalledWith('push_messages');
  expect(mockUpdate).toHaveBeenCalledWith({ title: 'Ssup? 👀', body: 'What are you listening to?' });
  expect(mockEq).toHaveBeenCalledWith('id', 'm-1');

  await addMessage('mood_evening', 6, 'One song before bed? 🌙', 'Share the vibe.');
  expect(mockInsert).toHaveBeenCalledWith({
    pool: 'mood_evening', position: 6, title: 'One song before bed? 🌙', body: 'Share the vibe.',
  });
});

it('turns the database’s fill-in refusal into words', async () => {
  mockEq.mockResolvedValueOnce({ error: { message: 'new row violates check constraint "push_messages_fill_ins"' } });
  await expect(updateMessage('m-1', '{name}', 'x')).rejects.toThrow(/fill-in this kind of notification does not have/);
});

it('checks each New music pool against its own fill-ins', () => {
  // A new drop names one person and one song; the roundup counts like the digest.
  expect(fillInProblem('new_drop', '{name} dropped a new song 🎧')).toBeNull();
  expect(fillInProblem('new_drop', '“{song}” · be one of the first to listen')).toBeNull();
  expect(fillInProblem('new_drop', '{names} dropped')).toMatch(/Only \{name\} and \{song\}/);
  expect(fillInProblem('originals', '{songs} from {names} · have a listen')).toBeNull();
  expect(fillInProblem('originals', '{name} uploaded')).toMatch(/Only \{names\}, \{songs\} and \{since\}/);
});

it('previews the New music lines the way a person reads them', () => {
  expect(previewText('new_drop', '{name} dropped a new song 🎧')).toBe('Arjun dropped a new song 🎧');
  expect(previewText('originals', '{songs} from {names} · have a listen')).toBe(
    '5 songs from Arjun, Kavya and 3 others · have a listen',
  );
});
