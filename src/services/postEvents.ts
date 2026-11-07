import { DeviceEventEmitter, type EmitterSubscription } from 'react-native';

const POST_DELETED_EVENT = 'livil:post-deleted';

/**
 * A post was deleted on its own page. The profile that opened that page is still mounted
 * underneath and only refetches on a pull, so without this the card stays in its list.
 */
export function emitPostDeleted(postId: string): void {
  DeviceEventEmitter.emit(POST_DELETED_EVENT, postId);
}

export function onPostDeleted(listener: (postId: string) => void): EmitterSubscription {
  return DeviceEventEmitter.addListener(POST_DELETED_EVENT, listener);
}
