import { DeviceEventEmitter, type EmitterSubscription } from 'react-native';
import type { PendingCollaborator } from '../constants/roles';

const COLLAB_PICKED_EVENT = 'livil:upload:collaborator-picked';

export function emitCollaboratorPicked(collaborator: PendingCollaborator): void {
  DeviceEventEmitter.emit(COLLAB_PICKED_EVENT, collaborator);
}

export function onCollaboratorPicked(
  listener: (collaborator: PendingCollaborator) => void,
): EmitterSubscription {
  return DeviceEventEmitter.addListener(COLLAB_PICKED_EVENT, listener);
}
