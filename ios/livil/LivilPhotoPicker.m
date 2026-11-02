// Apple's own photo picker (PHPickerViewController) for every gallery pick on iPhone: chat
// photos (PROP-0011), profile photos, album covers, upload cover art / thumbnails, and upload
// videos.
//
// Why not react-native-image-crop-picker's gallery: on iOS it shows QBImagePicker, a
// third-party grid that looks unlike the Photos app and asks for access to the WHOLE library.
// PHPicker is the system sheet — the Photos app's look — and needs no permission at all: the
// app only ever receives the one item the person taps. (Square crops still use the
// image-crop-picker cropper, on the photo this returns — see src/native/photoPicker.ts.)
//
//   photo — downsampled straight from its file with ImageIO (never decoded at full size — a
//           48 MP photo would be ~190 MB as a bitmap), to at most `maxSide` px on the long
//           edge, orientation applied, re-encoded as JPEG WITHOUT its metadata (location,
//           camera).
//   video — the ORIGINAL file, copied untouched (no transcode: the upload must be what the
//           artist picked).
//
// Either lands in the temporary folder as `livil-pick-<uuid>.<ext>`; `remove` deletes only
// such files. The promise settles only once the picker has finished DISMISSING, so the caller
// can present the next screen (the cropper) at once — iOS refuses to present over a sheet that
// is still animating away.
//
// A plain legacy bridge module, like LivilStudioFiles.m (TurboModule interop under the New
// Architecture). iOS only; Android keeps the image-crop-picker gallery. JS side:
// src/native/photoPicker.ts.

#import <React/RCTBridgeModule.h>
#import <React/RCTUtils.h>
#import <PhotosUI/PhotosUI.h>
#import <ImageIO/ImageIO.h>
#import <UniformTypeIdentifiers/UniformTypeIdentifiers.h>

static NSString *const kPickPrefix = @"livil-pick-";

@interface LivilPhotoPicker : NSObject <RCTBridgeModule, PHPickerViewControllerDelegate, UIAdaptivePresentationControllerDelegate>
@property (nonatomic, copy) RCTPromiseResolveBlock pendingResolve;
@property (nonatomic, copy) RCTPromiseRejectBlock pendingReject;
@property (nonatomic, assign) BOOL wantsVideo;
@property (nonatomic, assign) NSInteger maxSide;
@property (nonatomic, assign) CGFloat quality;
// Both must be true before the promise settles: the item is ready, and the sheet is gone.
@property (nonatomic, assign) BOOL dismissed;
@property (nonatomic, assign) BOOL ready;
@property (nonatomic, strong) id readyResult;
@property (nonatomic, copy) NSString *readyError;
@end

@implementation LivilPhotoPicker

RCT_EXPORT_MODULE();

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

/** Presenting the picker is UI work. */
- (dispatch_queue_t)methodQueue
{
  return dispatch_get_main_queue();
}

/** Settles the pending promise once the item is ready AND the sheet has gone. Main queue. */
- (void)settleIfDone
{
  if (!self.ready || !self.dismissed) {
    return;
  }
  RCTPromiseResolveBlock resolve = self.pendingResolve;
  RCTPromiseRejectBlock reject = self.pendingReject;
  id result = self.readyResult;
  NSString *error = self.readyError;
  self.pendingResolve = nil;
  self.pendingReject = nil;
  self.readyResult = nil;
  self.readyError = nil;
  if (error && reject) {
    reject(@"E_PICK", error, nil);
  } else if (resolve) {
    resolve(result ?: [NSNull null]);
  }
}

- (void)markReady:(id)result error:(NSString *)error
{
  dispatch_async(dispatch_get_main_queue(), ^{
    self.readyResult = result;
    self.readyError = error;
    self.ready = YES;
    [self settleIfDone];
  });
}

RCT_EXPORT_METHOD(pick:(NSDictionary *)options
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
{
  if (self.pendingResolve) {
    reject(@"E_BUSY", @"The photo picker is already open", nil);
    return;
  }
  NSNumber *maxSide = options[@"maxSide"];
  NSNumber *quality = options[@"quality"];
  self.wantsVideo = [options[@"mediaType"] isEqual:@"video"];
  self.maxSide = maxSide ? MAX(320, MIN(4096, maxSide.integerValue)) : 1600;
  self.quality = quality ? MAX(0.3, MIN(1.0, quality.doubleValue)) : 0.8;

  UIViewController *presenter = RCTPresentedViewController();
  if (!presenter) {
    reject(@"E_PRESENT", @"Nothing to present the photo picker from", nil);
    return;
  }

  PHPickerConfiguration *config = [[PHPickerConfiguration alloc] init];
  config.selectionLimit = 1;
  config.filter = self.wantsVideo ? [PHPickerFilter videosFilter] : [PHPickerFilter imagesFilter];
  // Hand over the item as it is stored — no transcode.
  config.preferredAssetRepresentationMode = PHPickerConfigurationAssetRepresentationModeCurrent;

  PHPickerViewController *picker = [[PHPickerViewController alloc] initWithConfiguration:config];
  picker.delegate = self;
  // A swipe down dismisses the sheet without a Cancel tap; hear about that too.
  picker.presentationController.delegate = self;
  self.pendingResolve = resolve;
  self.pendingReject = reject;
  self.dismissed = NO;
  self.ready = NO;
  [presenter presentViewController:picker animated:YES completion:nil];
}

/** Swiped away: nothing picked. (A Cancel tap arrives through didFinishPicking instead.) */
- (void)presentationControllerDidDismiss:(UIPresentationController *)presentationController
{
  self.dismissed = YES;
  if (!self.ready) {
    [self markReady:nil error:nil];
  } else {
    [self settleIfDone];
  }
}

- (void)picker:(PHPickerViewController *)picker didFinishPicking:(NSArray<PHPickerResult *> *)results
{
  [picker dismissViewControllerAnimated:YES completion:^{
    self.dismissed = YES;
    [self settleIfDone];
  }];
  PHPickerResult *result = results.firstObject;
  if (!result) {
    [self markReady:nil error:nil]; // cancelled
    return;
  }
  NSItemProvider *provider = result.itemProvider;
  NSString *type = self.wantsVideo ? UTTypeMovie.identifier : UTTypeImage.identifier;
  if (![provider hasItemConformingToTypeIdentifier:type]) {
    [self markReady:nil error:self.wantsVideo ? @"That item is not a video" : @"That item is not a photo"];
    return;
  }
  BOOL video = self.wantsVideo;
  NSInteger maxSide = self.maxSide;
  CGFloat quality = self.quality;
  // The file URL is valid only inside this callback (a background queue): finish here.
  [provider loadFileRepresentationForTypeIdentifier:type completionHandler:^(NSURL *url, NSError *loadError) {
    NSDictionary *picked = nil;
    NSString *error = nil;
    if (!url) {
      error = loadError.localizedDescription ?: @"Could not read that item";
    } else if (video) {
      picked = [LivilPhotoPicker copyVideo:url error:&error];
    } else {
      picked = [LivilPhotoPicker downsample:url maxSide:maxSide quality:quality error:&error];
    }
    [self markReady:picked error:picked ? nil : error];
  }];
}

+ (NSURL *)tempFileWithExtension:(NSString *)ext
{
  NSString *name = [NSString stringWithFormat:@"%@%@.%@", kPickPrefix, [NSUUID UUID].UUIDString, ext];
  return [NSURL fileURLWithPath:[NSTemporaryDirectory() stringByAppendingPathComponent:name]];
}

+ (NSNumber *)sizeOf:(NSURL *)url
{
  return [[NSFileManager defaultManager] attributesOfItemAtPath:url.path error:nil][NSFileSize] ?: @0;
}

/** ImageIO thumbnail of the file at `maxSide`, orientation applied, as a metadata-free JPEG. */
+ (NSDictionary *)downsample:(NSURL *)url maxSide:(NSInteger)maxSide quality:(CGFloat)quality error:(NSString **)error
{
  CGImageSourceRef source = CGImageSourceCreateWithURL((__bridge CFURLRef)url, NULL);
  if (!source) {
    *error = @"Could not open that photo";
    return nil;
  }
  NSDictionary *thumbOptions = @{
    (__bridge NSString *)kCGImageSourceCreateThumbnailFromImageAlways: @YES,
    (__bridge NSString *)kCGImageSourceCreateThumbnailWithTransform: @YES,
    (__bridge NSString *)kCGImageSourceThumbnailMaxPixelSize: @(maxSide),
    (__bridge NSString *)kCGImageSourceShouldCacheImmediately: @YES,
  };
  CGImageRef image = CGImageSourceCreateThumbnailAtIndex(source, 0, (__bridge CFDictionaryRef)thumbOptions);
  CFRelease(source);
  if (!image) {
    *error = @"Could not read that photo";
    return nil;
  }

  NSURL *out = [self tempFileWithExtension:@"jpg"];
  CGImageDestinationRef dest = CGImageDestinationCreateWithURL((__bridge CFURLRef)out, (__bridge CFStringRef)UTTypeJPEG.identifier, 1, NULL);
  if (!dest) {
    CGImageRelease(image);
    *error = @"Could not save that photo";
    return nil;
  }
  // Only the compression setting is written: no EXIF, no GPS, no camera details.
  NSDictionary *props = @{ (__bridge NSString *)kCGImageDestinationLossyCompressionQuality: @(quality) };
  CGImageDestinationAddImage(dest, image, (__bridge CFDictionaryRef)props);
  BOOL ok = CGImageDestinationFinalize(dest);
  CFRelease(dest);
  size_t width = CGImageGetWidth(image);
  size_t height = CGImageGetHeight(image);
  CGImageRelease(image);
  if (!ok) {
    *error = @"Could not save that photo";
    return nil;
  }
  return @{
    @"uri": out.absoluteString,
    @"name": out.lastPathComponent,
    @"mime": @"image/jpeg",
    @"width": @(width),
    @"height": @(height),
    @"bytes": [self sizeOf:out],
  };
}

/** The original video file, copied as-is (same container, no transcode). */
+ (NSDictionary *)copyVideo:(NSURL *)url error:(NSString **)error
{
  NSString *ext = url.pathExtension.length > 0 ? url.pathExtension.lowercaseString : @"mov";
  NSURL *out = [self tempFileWithExtension:ext];
  NSError *copyError = nil;
  if (![[NSFileManager defaultManager] copyItemAtURL:url toURL:out error:&copyError]) {
    *error = copyError.localizedDescription ?: @"Could not copy that video";
    return nil;
  }
  NSString *mime = [UTType typeWithFilenameExtension:ext].preferredMIMEType ?: @"video/quicktime";
  // The picker's own file name, for display; the copy keeps a private name.
  NSString *original = url.lastPathComponent.length > 0 ? url.lastPathComponent : out.lastPathComponent;
  return @{
    @"uri": out.absoluteString,
    @"name": original,
    @"mime": mime,
    @"width": @0,
    @"height": @0,
    @"bytes": [self sizeOf:out],
  };
}

/** Deletes a file this module wrote — and nothing else. */
RCT_EXPORT_METHOD(remove:(NSString *)uri
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
{
  NSURL *url = [NSURL URLWithString:uri];
  NSString *path = url.isFileURL ? url.path.stringByStandardizingPath : nil;
  NSString *tmp = NSTemporaryDirectory().stringByStandardizingPath;
  BOOL ours = path
    && [path.stringByDeletingLastPathComponent isEqualToString:tmp]
    && [path.lastPathComponent hasPrefix:kPickPrefix];
  if (!ours) {
    resolve(@NO);
    return;
  }
  resolve(@([[NSFileManager defaultManager] removeItemAtPath:path error:nil]));
}

@end
