/**
 * iOS in-app sign-in sheet — JS side of `ios/livil/LivilAuthSession.m`.
 *
 * Opens `url` in ASWebAuthenticationSession (the system sheet that slides up over
 * the app) and resolves with the redirect URL once the page navigates to
 * `<callbackScheme>://…`. Nothing goes through `Linking`, so RootNavigator's
 * deep-link listener never sees these redirects; the caller owns the result.
 *
 * iOS only. Android keeps the browser + deep-link flow (see googleAuth.ts).
 */
import { NativeModules, Platform } from 'react-native';

type LivilAuthSessionModule = {
  start(url: string, callbackScheme: string): Promise<string>;
};

const native: LivilAuthSessionModule | undefined =
  Platform.OS === 'ios' ? NativeModules.LivilAuthSession : undefined;

/** Whether the in-app sheet can be used on this build. */
export function isAuthSessionAvailable(): boolean {
  return native != null;
}

export async function openAuthSession(url: string, callbackScheme: string): Promise<string> {
  if (!native) {
    throw new Error('In-app sign-in is not available on this device.');
  }
  return native.start(url, callbackScheme);
}

/** True when the user closed the sheet rather than something going wrong. */
export function isAuthSessionCancellation(e: unknown): boolean {
  return (e as { code?: string })?.code === 'cancelled';
}
