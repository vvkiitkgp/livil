import { isUploadedAvatar } from '../profileService';

jest.mock('../../../lib/supabase', () => ({ supabase: {}, SUPABASE_URL: 'https://example.supabase.co' }));
jest.mock('react-native-image-crop-picker', () => ({ openPicker: jest.fn(), openCamera: jest.fn() }));
jest.mock('../uploads', () => ({}));

describe('isUploadedAvatar', () => {
  it('is true only for a photo in our avatars bucket', () => {
    expect(isUploadedAvatar('https://fqz.supabase.co/storage/v1/object/public/avatars/u1/avatar_1.jpg')).toBe(true);
    // The Google photo handle_new_user copies at sign-up does not count: the step still asks.
    expect(isUploadedAvatar('https://lh3.googleusercontent.com/a/ACg8ocK=s96-c')).toBe(false);
    expect(isUploadedAvatar(null)).toBe(false);
    expect(isUploadedAvatar('')).toBe(false);
  });
});
