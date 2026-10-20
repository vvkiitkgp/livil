// The clipboard's copy counter for iOS (UIPasteboard.changeCount).
//
// iOS asks "Livil would like to paste from …" on every READ of another app's copy, so the
// copied-Spotify-link check (SpotifyClipboardPrompt) must not read the same copy twice —
// otherwise a non-Spotify link left on the clipboard asks again on every open (owner,
// 2026-10-20). changeCount goes up whenever anything new is copied, on any device signed
// in to the same Apple account (Universal Clipboard), and reading it never asks: it is
// metadata, not the copied content. The JS side remembers the last count it handled and
// only looks again once the count moves.
//
// A plain legacy bridge module, like LivilAuthSession.m: one method, no codegen spec, and
// RN 0.85's TurboModule interop layer loads RCT_EXPORT_MODULE modules under the New
// Architecture. @react-native-clipboard/clipboard has no changeCount, and patching it would
// mean changing its codegen spec and its Android module too.
//
// JS side: src/services/clipboard.ts.

#import <React/RCTBridgeModule.h>
#import <UIKit/UIKit.h>

@interface LivilPasteboard : NSObject <RCTBridgeModule>
@end

@implementation LivilPasteboard

RCT_EXPORT_MODULE();

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

- (dispatch_queue_t)methodQueue
{
  // UIKit object: read it on the main thread.
  return dispatch_get_main_queue();
}

RCT_EXPORT_METHOD(changeCount:(RCTPromiseResolveBlock)resolve
                  reject:(__unused RCTPromiseRejectBlock)reject)
{
  resolve(@([UIPasteboard generalPasteboard].changeCount));
}

@end
