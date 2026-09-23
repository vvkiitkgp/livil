// In-app browser sign-in for iOS (App Store Review guideline 4).
//
// Wraps ASWebAuthenticationSession: the system sign-in sheet that slides up over
// the app, runs the OAuth page in a Safari-backed browser the user can trust
// (real URL, real certificate), and closes itself the moment the page redirects
// to `<callbackScheme>://…`, handing that URL back instead of routing it through
// openURL. Review rejected 2.0.6 (72) because Google sign-in used
// Linking.openURL, which leaves the app for Safari.
//
// A plain legacy bridge module on purpose: it is one method, it needs no codegen
// spec, and RN 0.85's TurboModule interop layer loads RCT_EXPORT_MODULE modules
// under the New Architecture. It is compiled into the app target rather than
// shipped as a package so there is no third-party dependency to vet against
// RN 0.85 + Fabric.
//
// JS side: src/services/authSession.ts.

#import <AuthenticationServices/AuthenticationServices.h>
#import <React/RCTBridgeModule.h>
#import <React/RCTUtils.h>
#import <UIKit/UIKit.h>

@interface LivilAuthSession : NSObject <RCTBridgeModule, ASWebAuthenticationPresentationContextProviding>
@end

@implementation LivilAuthSession {
  // Held strongly for the life of the sheet: ASWebAuthenticationSession is torn
  // down (and the sheet dismissed) as soon as nothing retains it.
  ASWebAuthenticationSession *_session;
}

RCT_EXPORT_MODULE();

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

- (dispatch_queue_t)methodQueue
{
  // The session must be created and started on the main thread (it presents UI).
  return dispatch_get_main_queue();
}

RCT_EXPORT_METHOD(start:(NSString *)urlString
                  callbackScheme:(NSString *)callbackScheme
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
{
  NSURL *url = [NSURL URLWithString:urlString];
  if (url == nil) {
    reject(@"invalid_url", @"Sign-in URL could not be parsed.", nil);
    return;
  }
  if (_session != nil) {
    // A second tap while the sheet is up. Starting another session would orphan
    // the first promise, so refuse instead.
    reject(@"in_progress", @"A sign-in is already in progress.", nil);
    return;
  }

  __weak LivilAuthSession *weakSelf = self;
  ASWebAuthenticationSession *session = [[ASWebAuthenticationSession alloc]
      initWithURL:url
      callbackURLScheme:callbackScheme
      completionHandler:^(NSURL *_Nullable callbackURL, NSError *_Nullable error) {
        LivilAuthSession *strongSelf = weakSelf;
        if (strongSelf != nil) {
          strongSelf->_session = nil;
        }
        if (error != nil) {
          if ([error.domain isEqualToString:ASWebAuthenticationSessionErrorDomain] &&
              error.code == ASWebAuthenticationSessionErrorCodeCanceledLogin) {
            // The user closed the sheet (or declined the "wants to use … to sign
            // in" prompt). Distinct code so the caller can stay silent.
            reject(@"cancelled", @"Sign-in was cancelled.", error);
          } else {
            reject(@"failed", error.localizedDescription, error);
          }
          return;
        }
        if (callbackURL == nil) {
          reject(@"failed", @"Sign-in finished without a redirect.", nil);
          return;
        }
        resolve(callbackURL.absoluteString);
      }];

  session.presentationContextProvider = self;
  // Ephemeral: no Safari cookies shared, which is what suppresses iOS's
  // "“Livil” wants to use <project>.supabase.co to sign in" alert — an alert that
  // names our raw Supabase project host. The cost is that a Google account
  // already signed in to Safari is not remembered here; sign-in is rare (once
  // per device), so that is the better trade.
  session.prefersEphemeralWebBrowserSession = YES;

  _session = session;
  if (![session start]) {
    _session = nil;
    reject(@"failed", @"Could not open the sign-in sheet.", nil);
  }
}

- (ASPresentationAnchor)presentationAnchorForWebAuthenticationSession:(ASWebAuthenticationSession *)session
{
  UIWindow *window = RCTKeyWindow();
  return window != nil ? window : [[UIWindow alloc] init];
}

@end
