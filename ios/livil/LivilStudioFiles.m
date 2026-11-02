// On-device storage for Editor drafts (ADR-0036 §9). Drafts never leave the phone.
//
// Everything lives under Documents/studio/, which is EXCLUDED FROM iCLOUD BACKUP, so
// "drafts are only on this phone, and uninstalling deletes them" is true. Callers pass paths
// RELATIVE to that root ("<userId>/<draftId>/project.json"); anything absolute, with "." or
// "..", or that resolves outside the root is rejected — a path read back from a draft's JSON
// can never reach another app file.
//
// Audio is written in base64 chunks (append) so a long take never crosses the bridge as one
// giant string; reading audio back goes through react-native-audio-api's decodeAudioData
// on the file path (`root()` + relative path), not through here.
//
// A plain legacy bridge module, like LivilPasteboard.m (TurboModule interop under the New
// Architecture). Android: StudioFilesModule.kt. JS side: src/services/studioFiles.ts.

#import <React/RCTBridgeModule.h>

@interface LivilStudioFiles : NSObject <RCTBridgeModule>
@end

@implementation LivilStudioFiles

RCT_EXPORT_MODULE();

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

- (dispatch_queue_t)methodQueue
{
  // File I/O, in order, off the main thread.
  static dispatch_queue_t queue;
  static dispatch_once_t once;
  dispatch_once(&once, ^{ queue = dispatch_queue_create("com.livil.studiofiles", DISPATCH_QUEUE_SERIAL); });
  return queue;
}

static NSString *StudioRoot(void)
{
  NSString *docs = NSSearchPathForDirectoriesInDomains(NSDocumentDirectory, NSUserDomainMask, YES).firstObject;
  return [docs stringByAppendingPathComponent:@"studio"];
}

static BOOL EnsureRoot(NSError **error)
{
  NSString *root = StudioRoot();
  if (![[NSFileManager defaultManager] createDirectoryAtPath:root withIntermediateDirectories:YES attributes:nil error:error]) {
    return NO;
  }
  NSURL *url = [NSURL fileURLWithPath:root isDirectory:YES];
  return [url setResourceValue:@YES forKey:NSURLIsExcludedFromBackupKey error:error];
}

/** The absolute path for `rel` inside the root, or nil when `rel` is not a safe relative path. */
static NSString *Resolve(NSString *rel)
{
  if (rel.length == 0 || [rel hasPrefix:@"/"]) return nil;
  for (NSString *part in [rel componentsSeparatedByString:@"/"]) {
    if (part.length == 0 || [part isEqualToString:@"."] || [part isEqualToString:@".."]) return nil;
  }
  NSString *root = [StudioRoot() stringByStandardizingPath];
  NSString *full = [[root stringByAppendingPathComponent:rel] stringByStandardizingPath];
  return [full hasPrefix:[root stringByAppendingString:@"/"]] ? full : nil;
}

#define RESOLVE_OR_REJECT(var, rel) \
  NSString *var = Resolve(rel); \
  if (!var) { reject(@"E_PATH", @"Not a path inside the drafts folder", nil); return; }

RCT_EXPORT_METHOD(root:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject)
{
  NSError *error = nil;
  if (!EnsureRoot(&error)) { reject(@"E_ROOT", error.localizedDescription, error); return; }
  resolve(StudioRoot());
}

RCT_EXPORT_METHOD(writeBase64:(NSString *)rel
                  data:(NSString *)base64
                  append:(BOOL)append
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
{
  RESOLVE_OR_REJECT(path, rel);
  NSData *data = [[NSData alloc] initWithBase64EncodedString:base64 options:0];
  if (!data) { reject(@"E_DATA", @"Not base64", nil); return; }
  NSError *error = nil;
  if (!EnsureRoot(&error) ||
      ![[NSFileManager defaultManager] createDirectoryAtPath:[path stringByDeletingLastPathComponent]
                                 withIntermediateDirectories:YES attributes:nil error:&error]) {
    reject(@"E_WRITE", error.localizedDescription, error); return;
  }
  if (append && [[NSFileManager defaultManager] fileExistsAtPath:path]) {
    NSFileHandle *handle = [NSFileHandle fileHandleForWritingAtPath:path];
    if (!handle) { reject(@"E_WRITE", @"Cannot open the file", nil); return; }
    @try {
      [handle seekToEndOfFile];
      [handle writeData:data];
      [handle closeFile];
    } @catch (NSException *e) {
      reject(@"E_WRITE", e.reason, nil); return;
    }
  } else if (![data writeToFile:path options:NSDataWritingAtomic error:&error]) {
    reject(@"E_WRITE", error.localizedDescription, error); return;
  }
  resolve(@(YES));
}

RCT_EXPORT_METHOD(writeText:(NSString *)rel
                  text:(NSString *)text
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
{
  RESOLVE_OR_REJECT(path, rel);
  NSError *error = nil;
  if (!EnsureRoot(&error) ||
      ![[NSFileManager defaultManager] createDirectoryAtPath:[path stringByDeletingLastPathComponent]
                                 withIntermediateDirectories:YES attributes:nil error:&error] ||
      ![text writeToFile:path atomically:YES encoding:NSUTF8StringEncoding error:&error]) {
    reject(@"E_WRITE", error.localizedDescription, error); return;
  }
  resolve(@(YES));
}

RCT_EXPORT_METHOD(readText:(NSString *)rel
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
{
  RESOLVE_OR_REJECT(path, rel);
  NSError *error = nil;
  NSString *text = [NSString stringWithContentsOfFile:path encoding:NSUTF8StringEncoding error:&error];
  if (!text) { reject(@"E_READ", error.localizedDescription, error); return; }
  resolve(text);
}

RCT_EXPORT_METHOD(listDirs:(NSString *)rel
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
{
  RESOLVE_OR_REJECT(path, rel);
  NSFileManager *fm = [NSFileManager defaultManager];
  NSMutableArray<NSString *> *out = [NSMutableArray array];
  for (NSString *name in [fm contentsOfDirectoryAtPath:path error:nil] ?: @[]) {
    BOOL dir = NO;
    if ([fm fileExistsAtPath:[path stringByAppendingPathComponent:name] isDirectory:&dir] && dir) [out addObject:name];
  }
  resolve(out);
}

RCT_EXPORT_METHOD(move:(NSString *)fromRel
                  to:(NSString *)toRel
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
{
  RESOLVE_OR_REJECT(from, fromRel);
  RESOLVE_OR_REJECT(to, toRel);
  NSFileManager *fm = [NSFileManager defaultManager];
  NSError *error = nil;
  if ([fm fileExistsAtPath:to]) [fm removeItemAtPath:to error:nil];
  if (![fm moveItemAtPath:from toPath:to error:&error]) { reject(@"E_MOVE", error.localizedDescription, error); return; }
  resolve(@(YES));
}

RCT_EXPORT_METHOD(remove:(NSString *)rel
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
{
  RESOLVE_OR_REJECT(path, rel);
  NSFileManager *fm = [NSFileManager defaultManager];
  if (![fm fileExistsAtPath:path]) { resolve(@(NO)); return; }
  NSError *error = nil;
  if (![fm removeItemAtPath:path error:&error]) { reject(@"E_REMOVE", error.localizedDescription, error); return; }
  resolve(@(YES));
}

RCT_EXPORT_METHOD(freeBytes:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject)
{
  NSURL *docs = [NSURL fileURLWithPath:NSSearchPathForDirectoriesInDomains(NSDocumentDirectory, NSUserDomainMask, YES).firstObject];
  NSError *error = nil;
  NSDictionary *values = [docs resourceValuesForKeys:@[NSURLVolumeAvailableCapacityForImportantUsageKey] error:&error];
  NSNumber *free = values[NSURLVolumeAvailableCapacityForImportantUsageKey];
  if (!free) { reject(@"E_FREE", error.localizedDescription ?: @"Unknown", error); return; }
  resolve(free);
}

@end
