// Disappearing chat photos (PROP-0011): the photo view that screenshots and screen recordings
// cannot capture, and "Save to phone".
//
// LivilSecureImage (a view) — draws the photo inside the canvas of a secure UITextField: the
// layer iOS uses for password fields, which the system leaves OUT of screenshots, screen
// recordings and screen mirroring. Behind it sits a "Photo hidden" card, so a capture shows
// that card instead of the photo (on screen the photo covers it exactly — the view is sized
// to the photo's fitted frame). The canvas is found through UIKit's view hierarchy (the text
// field's first sublayer's delegate), which Apple does not document: if it is ever missing,
// the photo is drawn normally (unprotected) rather than not at all. RE-VERIFY ON EVERY iOS
// RELEASE. Android blocks capture for the whole window instead (FLAG_SECURE,
// ChatMediaModule.kt).
//
// LivilChatMedia (a module) — saveToPhotos(uri): adds a local photo file to the library with
// ADD-ONLY access (Livil can add, never read). NSPhotoLibraryAddUsageDescription in Info.plist.
//
// Plain legacy bridge module + view manager, like LivilStudioFiles.m (interop under the New
// Architecture). JS side: src/native/chatMediaKit.ts.

#import <React/RCTBridgeModule.h>
#import <React/RCTViewManager.h>
#import <React/RCTComponent.h>
#import <Photos/Photos.h>

// ── The protected photo view ──────────────────────────────────────────────────

@interface LivilSecureImageView : UIView
@property (nonatomic, copy) NSString *uri;
@property (nonatomic, copy) RCTDirectEventBlock onLoad;
@end

@implementation LivilSecureImageView {
  UIView *_placeholder;
  UITextField *_field;
  UIView *_container;
  UIImageView *_imageView;
  NSString *_loadedUri;
}

- (instancetype)initWithFrame:(CGRect)frame
{
  if ((self = [super initWithFrame:frame])) {
    self.clipsToBounds = YES;
    _placeholder = [LivilSecureImageView makePlaceholder];
    _placeholder.hidden = YES; // shown only once there is a photo it stands in for
    [self addSubview:_placeholder];

    _field = [[UITextField alloc] init];
    _field.secureTextEntry = YES;
    _field.userInteractionEnabled = NO;
    _field.backgroundColor = UIColor.clearColor;
    UIView *canvas = nil;
    id delegate = _field.layer.sublayers.firstObject.delegate;
    if ([delegate isKindOfClass:[UIView class]]) {
      canvas = (UIView *)delegate;
    }
    if (canvas) {
      for (UIView *sub in canvas.subviews) {
        [sub removeFromSuperview];
      }
      canvas.userInteractionEnabled = NO;
      [self addSubview:_field];
      _container = canvas;
    } else {
      // The secure canvas is not where it used to be: draw the photo unprotected.
      _container = [[UIView alloc] init];
      [self addSubview:_container];
    }

    _imageView = [[UIImageView alloc] init];
    _imageView.contentMode = UIViewContentModeScaleAspectFit;
    _imageView.clipsToBounds = YES;
    [_container addSubview:_imageView];
  }
  return self;
}

+ (UIView *)makePlaceholder
{
  UIView *card = [[UIView alloc] init];
  card.backgroundColor = [UIColor colorWithRed:0.031 green:0.031 blue:0.047 alpha:1]; // #08080C

  UIImageSymbolConfiguration *config = [UIImageSymbolConfiguration configurationWithPointSize:22 weight:UIImageSymbolWeightRegular];
  UIImageView *lock = [[UIImageView alloc] initWithImage:[UIImage systemImageNamed:@"lock" withConfiguration:config]];
  lock.tintColor = [UIColor colorWithRed:0.545 green:0.565 blue:0.655 alpha:1]; // #8B90A7
  lock.translatesAutoresizingMaskIntoConstraints = NO;

  UILabel *label = [[UILabel alloc] init];
  label.text = @"Photo hidden";
  label.font = [UIFont systemFontOfSize:15 weight:UIFontWeightSemibold];
  label.textColor = [UIColor colorWithRed:0.627 green:0.647 blue:0.737 alpha:1]; // #A0A5BC
  label.translatesAutoresizingMaskIntoConstraints = NO;

  [card addSubview:lock];
  [card addSubview:label];
  [NSLayoutConstraint activateConstraints:@[
    [lock.centerXAnchor constraintEqualToAnchor:card.centerXAnchor],
    [lock.bottomAnchor constraintEqualToAnchor:card.centerYAnchor constant:-6],
    [label.centerXAnchor constraintEqualToAnchor:card.centerXAnchor],
    [label.topAnchor constraintEqualToAnchor:card.centerYAnchor constant:6],
  ]];
  return card;
}

- (void)layoutSubviews
{
  [super layoutSubviews];
  _placeholder.frame = self.bounds;
  _field.frame = self.bounds;
  [_field layoutIfNeeded];
  _container.frame = self.bounds;
  _imageView.frame = _container.bounds;
}

- (void)setUri:(NSString *)uri
{
  _uri = [uri copy];
  if (uri.length == 0 || [uri isEqualToString:_loadedUri]) {
    return;
  }
  NSURL *url = [NSURL URLWithString:uri];
  NSString *requested = [uri copy];
  __weak LivilSecureImageView *weakSelf = self;
  // Decode off the main thread; a local file only (the chat keeps copies as files).
  dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
    UIImage *image = url.isFileURL ? [UIImage imageWithContentsOfFile:url.path] : nil;
    UIImage *decoded = image ? [image imageByPreparingForDisplay] : nil;
    dispatch_async(dispatch_get_main_queue(), ^{
      LivilSecureImageView *view = weakSelf;
      if (!view || ![view.uri isEqualToString:requested]) {
        return;
      }
      [view showImage:decoded ?: image uri:requested];
    });
  });
}

- (void)showImage:(UIImage *)image uri:(NSString *)uri
{
  _loadedUri = uri;
  _imageView.image = image;
  _placeholder.hidden = image == nil;
  if (self.onLoad) {
    self.onLoad(@{ @"ok": @(image != nil) });
  }
}

@end

@interface LivilSecureImageManager : RCTViewManager
@end

@implementation LivilSecureImageManager

RCT_EXPORT_MODULE(LivilSecureImage)

- (UIView *)view
{
  return [[LivilSecureImageView alloc] init];
}

RCT_EXPORT_VIEW_PROPERTY(uri, NSString)
RCT_EXPORT_VIEW_PROPERTY(onLoad, RCTDirectEventBlock)

@end

// ── Save to phone ─────────────────────────────────────────────────────────────

@interface LivilChatMedia : NSObject <RCTBridgeModule>
@end

@implementation LivilChatMedia

RCT_EXPORT_MODULE();

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

static BOOL CanAdd(PHAuthorizationStatus status)
{
  return status == PHAuthorizationStatusAuthorized || status == PHAuthorizationStatusLimited;
}

RCT_EXPORT_METHOD(saveToPhotos:(NSString *)uri
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
{
  NSURL *url = [NSURL URLWithString:uri];
  if (!url.isFileURL || ![[NSFileManager defaultManager] fileExistsAtPath:url.path]) {
    reject(@"E_FILE", @"There is no photo file to save", nil);
    return;
  }
  void (^save)(void) = ^{
    [[PHPhotoLibrary sharedPhotoLibrary] performChanges:^{
      PHAssetCreationRequest *request = [PHAssetCreationRequest creationRequestForAsset];
      [request addResourceWithType:PHAssetResourceTypePhoto fileURL:url options:nil];
    } completionHandler:^(BOOL success, NSError *error) {
      if (success) {
        resolve(@YES);
      } else {
        reject(@"E_SAVE", error.localizedDescription ?: @"Could not save the photo", error);
      }
    }];
  };
  PHAuthorizationStatus status = [PHPhotoLibrary authorizationStatusForAccessLevel:PHAccessLevelAddOnly];
  if (CanAdd(status)) {
    save();
  } else if (status == PHAuthorizationStatusNotDetermined) {
    [PHPhotoLibrary requestAuthorizationForAccessLevel:PHAccessLevelAddOnly handler:^(PHAuthorizationStatus next) {
      if (CanAdd(next)) {
        save();
      } else {
        reject(@"E_DENIED", @"Livil is not allowed to add photos", nil);
      }
    }];
  } else {
    reject(@"E_DENIED", @"Livil is not allowed to add photos", nil);
  }
}

@end
