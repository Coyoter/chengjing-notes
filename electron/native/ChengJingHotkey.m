#import <Cocoa/Cocoa.h>
#import <Carbon/Carbon.h>
#import <QuartzCore/QuartzCore.h>

static void CJEmit(NSString *line) {
  fprintf(stdout, "%s\n", line.UTF8String);
  fflush(stdout);
}

@class CJCaptureController;

@interface CJCapturePanel : NSPanel
@end

@implementation CJCapturePanel
- (BOOL)canBecomeKeyWindow { return YES; }
- (BOOL)canBecomeMainWindow { return NO; }
@end

@interface CJCaptureTextView : NSTextView
@property(nonatomic, weak) CJCaptureController *captureController;
@end

@interface CJCaptureController : NSObject <NSWindowDelegate, NSTextViewDelegate>
@property(nonatomic, strong) CJCapturePanel *panel;
@property(nonatomic, strong) NSView *surface;
@property(nonatomic, strong) CJCaptureTextView *textView;
@property(nonatomic, strong) NSTextField *placeholder;
@property(nonatomic, strong) NSTextField *eyebrow;
@property(nonatomic, strong) NSTextField *titleLabel;
@property(nonatomic, strong) NSTextField *hint;
@property(nonatomic, strong) NSButton *submitButton;
@property(nonatomic, assign) BOOL waitingForSave;
@property(nonatomic, copy) NSDictionary<NSString *, NSString *> *strings;
- (void)toggle;
- (void)show;
- (void)hide;
- (void)submit;
- (void)insertLineBreak;
- (void)didSave;
- (void)didFail;
@end

@implementation CJCaptureTextView
- (void)doCommandBySelector:(SEL)selector {
  if (selector == @selector(cancelOperation:)) {
    if (self.hasMarkedText) {
      [super doCommandBySelector:selector];
      return;
    }
    [self.captureController hide];
    return;
  }
  if (selector == @selector(insertNewline:)) {
    if (self.hasMarkedText) {
      [super doCommandBySelector:selector];
      return;
    }
    if ((NSApp.currentEvent.modifierFlags & NSEventModifierFlagOption) != 0) {
      [self.captureController insertLineBreak];
      return;
    }
    [self.captureController submit];
    return;
  }
  [super doCommandBySelector:selector];
}
@end

static NSTextField *CJLabel(NSString *text, CGFloat size, NSFontWeight weight) {
  NSTextField *label = [NSTextField labelWithString:text];
  label.font = [NSFont systemFontOfSize:size weight:weight];
  label.lineBreakMode = NSLineBreakByTruncatingTail;
  label.selectable = NO;
  return label;
}

static NSDictionary<NSString *, NSString *> *CJLocalizedCopy(void) {
  NSString *language = NSLocale.preferredLanguages.firstObject.lowercaseString ?: @"en";
  if ([language hasPrefix:@"zh-hant"] || [language hasPrefix:@"zh-tw"] || [language hasPrefix:@"zh-hk"] || [language hasPrefix:@"zh-mo"]) {
    return @{ @"eyebrow": @"隨手留下來", @"title": @"隻言片語", @"placeholder": @"此刻腦中閃過什麼？", @"hint": @"Enter 儲存 · ⌥ Enter 換行 · Esc 關閉", @"submit": @"留下來", @"saving": @"正在儲存…", @"saved": @"已儲存", @"failed": @"儲存失敗，請再試一次" };
  }
  if ([language hasPrefix:@"zh"]) {
    return @{ @"eyebrow": @"随手记下来", @"title": @"只言片语", @"placeholder": @"此刻脑中闪过什么？", @"hint": @"Enter 保存 · ⌥ Enter 换行 · Esc 关闭", @"submit": @"记下来", @"saving": @"正在保存…", @"saved": @"已保存", @"failed": @"保存失败，请再试一次" };
  }
  if ([language hasPrefix:@"ja"]) {
    return @{ @"eyebrow": @"ふと思ったことを", @"title": @"ひとこと", @"placeholder": @"今、何が頭に浮かんでいますか？", @"hint": @"Enter 保存 · ⌥ Enter 改行 · Esc 閉じる", @"submit": @"残す", @"saving": @"保存中…", @"saved": @"保存しました", @"failed": @"保存できませんでした" };
  }
  if ([language hasPrefix:@"ko"]) {
    return @{ @"eyebrow": @"스쳐 가기 전에", @"title": @"짧은 생각", @"placeholder": @"지금 머릿속에 무엇이 떠오르나요?", @"hint": @"Enter 저장 · ⌥ Enter 줄바꿈 · Esc 닫기", @"submit": @"남기기", @"saving": @"저장 중…", @"saved": @"저장됨", @"failed": @"저장하지 못했습니다" };
  }
  return @{ @"eyebrow": @"Capture the thought", @"title": @"Fragment", @"placeholder": @"What just crossed your mind?", @"hint": @"Enter to save · ⌥ Enter for a new line · Esc to close", @"submit": @"Save", @"saving": @"Saving…", @"saved": @"Saved", @"failed": @"Could not save. Try again." };
}

@implementation CJCaptureController

- (instancetype)init {
  self = [super init];
  if (!self) return nil;
  _strings = CJLocalizedCopy();
  [self buildPanel];
  return self;
}

- (void)buildPanel {
  const CGFloat width = 554.0;
  const CGFloat height = 164.0;
  NSWindowStyleMask style = NSWindowStyleMaskBorderless | NSWindowStyleMaskNonactivatingPanel | NSWindowStyleMaskFullSizeContentView;
  self.panel = [[CJCapturePanel alloc] initWithContentRect:NSMakeRect(0, 0, width, height) styleMask:style backing:NSBackingStoreBuffered defer:NO];
  self.panel.delegate = self;
  self.panel.opaque = NO;
  self.panel.backgroundColor = NSColor.clearColor;
  self.panel.hasShadow = YES;
  self.panel.level = NSFloatingWindowLevel;
  self.panel.hidesOnDeactivate = NO;
  self.panel.becomesKeyOnlyIfNeeded = NO;
  self.panel.releasedWhenClosed = NO;
  self.panel.movable = NO;
  self.panel.collectionBehavior = NSWindowCollectionBehaviorCanJoinAllSpaces | NSWindowCollectionBehaviorFullScreenAuxiliary | NSWindowCollectionBehaviorTransient | NSWindowCollectionBehaviorIgnoresCycle;

  self.surface = [[NSView alloc] initWithFrame:NSMakeRect(0, 0, width, height)];
  self.surface.wantsLayer = YES;
  self.surface.layer.cornerRadius = 16.0;
  self.surface.layer.masksToBounds = YES;
  self.panel.contentView = self.surface;

  NSImageView *icon = [[NSImageView alloc] initWithFrame:NSMakeRect(24, 127, 20, 20)];
  icon.image = [NSImage imageWithSystemSymbolName:@"quote.bubble.fill" accessibilityDescription:self.strings[@"eyebrow"]];
  icon.contentTintColor = [NSColor colorWithSRGBRed:0.29 green:0.84 blue:0.70 alpha:1.0];
  icon.imageScaling = NSImageScaleProportionallyUpOrDown;
  [self.surface addSubview:icon];

  self.eyebrow = CJLabel(self.strings[@"eyebrow"], 13.5, NSFontWeightSemibold);
  self.eyebrow.frame = NSMakeRect(52, 126, 270, 22);
  [self.surface addSubview:self.eyebrow];

  self.titleLabel = CJLabel(self.strings[@"title"], 12.5, NSFontWeightSemibold);
  self.titleLabel.alignment = NSTextAlignmentRight;
  self.titleLabel.frame = NSMakeRect(380, 126, 150, 22);
  [self.surface addSubview:self.titleLabel];

  self.textView = [[CJCaptureTextView alloc] initWithFrame:NSMakeRect(20, 58, 514, 58)];
  self.textView.captureController = self;
  self.textView.delegate = self;
  self.textView.drawsBackground = NO;
  self.textView.richText = NO;
  self.textView.importsGraphics = NO;
  self.textView.usesFindPanel = NO;
  self.textView.usesFontPanel = NO;
  self.textView.automaticQuoteSubstitutionEnabled = NO;
  self.textView.automaticDashSubstitutionEnabled = NO;
  self.textView.automaticTextReplacementEnabled = NO;
  self.textView.font = [NSFont systemFontOfSize:18.0 weight:NSFontWeightMedium];
  self.textView.textContainerInset = NSMakeSize(4, 5);
  self.textView.textContainer.lineFragmentPadding = 0;
  self.textView.textContainer.widthTracksTextView = YES;
  [self.surface addSubview:self.textView];

  self.placeholder = CJLabel(self.strings[@"placeholder"], 18.0, NSFontWeightMedium);
  self.placeholder.frame = NSMakeRect(24, 84, 500, 26);
  [self.surface addSubview:self.placeholder];

  self.hint = CJLabel(self.strings[@"hint"], 12.5, NSFontWeightRegular);
  self.hint.frame = NSMakeRect(24, 18, 390, 22);
  [self.surface addSubview:self.hint];

  self.submitButton = [NSButton buttonWithTitle:self.strings[@"submit"] target:self action:@selector(submit)];
  self.submitButton.frame = NSMakeRect(440, 12, 90, 34);
  self.submitButton.bordered = NO;
  self.submitButton.wantsLayer = YES;
  self.submitButton.layer.cornerRadius = 9.0;
  self.submitButton.font = [NSFont systemFontOfSize:13.0 weight:NSFontWeightSemibold];
  [self.surface addSubview:self.submitButton];
  [self applyAppearance];
}

- (BOOL)isDarkAppearance {
  NSAppearanceName match = [self.panel.effectiveAppearance bestMatchFromAppearancesWithNames:@[NSAppearanceNameAqua, NSAppearanceNameDarkAqua]];
  return [match isEqualToString:NSAppearanceNameDarkAqua];
}

- (void)applyAppearance {
  BOOL dark = [self isDarkAppearance];
  NSColor *surface = dark ? [NSColor colorWithSRGBRed:0.075 green:0.120 blue:0.102 alpha:0.985] : [NSColor colorWithSRGBRed:0.965 green:0.955 blue:0.925 alpha:0.985];
  NSColor *primary = dark ? [NSColor colorWithSRGBRed:0.89 green:0.90 blue:0.86 alpha:1.0] : [NSColor colorWithSRGBRed:0.10 green:0.14 blue:0.12 alpha:1.0];
  NSColor *muted = dark ? [NSColor colorWithSRGBRed:0.63 green:0.66 blue:0.62 alpha:1.0] : [NSColor colorWithSRGBRed:0.37 green:0.40 blue:0.37 alpha:1.0];
  NSColor *accent = [NSColor colorWithSRGBRed:0.29 green:0.84 blue:0.70 alpha:1.0];
  self.surface.layer.backgroundColor = surface.CGColor;
  self.eyebrow.textColor = accent;
  self.titleLabel.textColor = muted;
  self.textView.textColor = primary;
  self.textView.insertionPointColor = accent;
  self.placeholder.textColor = [muted colorWithAlphaComponent:0.72];
  self.hint.textColor = muted;
  self.submitButton.layer.backgroundColor = (dark ? [NSColor colorWithSRGBRed:0.09 green:0.29 blue:0.24 alpha:1.0] : [NSColor colorWithSRGBRed:0.78 green:0.91 blue:0.85 alpha:1.0]).CGColor;
  self.submitButton.contentTintColor = dark ? [NSColor colorWithSRGBRed:0.70 green:0.91 blue:0.83 alpha:1.0] : [NSColor colorWithSRGBRed:0.05 green:0.30 blue:0.23 alpha:1.0];
}

- (NSScreen *)targetScreen {
  NSPoint point = NSEvent.mouseLocation;
  for (NSScreen *screen in NSScreen.screens) {
    if (NSPointInRect(point, screen.frame)) return screen;
  }
  return NSScreen.mainScreen ?: NSScreen.screens.firstObject;
}

- (void)positionPanel {
  NSScreen *screen = [self targetScreen];
  NSRect visible = screen.visibleFrame;
  NSRect frame = self.panel.frame;
  frame.origin.x = NSMidX(visible) - NSWidth(frame) / 2.0;
  frame.origin.y = visible.origin.y + NSHeight(visible) * 0.38 - NSHeight(frame) / 2.0;
  [self.panel setFrame:frame display:NO];
}

- (void)toggle {
  if (self.panel.isVisible) [self hide];
  else [self show];
}

- (void)show {
  self.waitingForSave = NO;
  self.textView.editable = YES;
  self.submitButton.enabled = YES;
  self.hint.stringValue = self.strings[@"hint"];
  [self applyAppearance];
  [self positionPanel];
  [self.panel orderFrontRegardless];
  [self.panel makeKeyAndOrderFront:nil];
  [self.panel makeFirstResponder:self.textView];
  [self.textView setSelectedRange:NSMakeRange(self.textView.string.length, 0)];
  self.placeholder.hidden = self.textView.string.length > 0;
  CJEmit(@"shown");
}

- (void)hide {
  if (self.textView.hasMarkedText) [self.textView unmarkText];
  [self.panel orderOut:nil];
  self.waitingForSave = NO;
  self.textView.editable = YES;
  self.submitButton.enabled = YES;
  self.hint.stringValue = self.strings[@"hint"];
  CJEmit(@"hidden");
}

- (void)insertLineBreak {
  [self.textView insertText:@"\n" replacementRange:self.textView.selectedRange];
}

- (void)submit {
  if (self.waitingForSave || self.textView.hasMarkedText) return;
  NSString *value = [self.textView.string stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
  if (value.length == 0) {
    NSBeep();
    return;
  }
  NSData *data = [value dataUsingEncoding:NSUTF8StringEncoding];
  NSString *encoded = [data base64EncodedStringWithOptions:0];
  self.waitingForSave = YES;
  self.textView.editable = NO;
  self.submitButton.enabled = NO;
  self.hint.stringValue = self.strings[@"saving"];
  CJEmit([@"submit:" stringByAppendingString:encoded]);
}

- (void)didSave {
  if (!self.waitingForSave) return;
  self.hint.stringValue = self.strings[@"saved"];
  self.textView.string = @"";
  self.placeholder.hidden = NO;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.28 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
    [self hide];
  });
}

- (void)didFail {
  self.waitingForSave = NO;
  self.textView.editable = YES;
  self.submitButton.enabled = YES;
  self.hint.stringValue = self.strings[@"failed"];
  [self.panel makeFirstResponder:self.textView];
}

- (void)textDidChange:(NSNotification *)notification {
  self.placeholder.hidden = self.textView.string.length > 0;
}

- (void)windowDidResignKey:(NSNotification *)notification {
  if (self.waitingForSave || self.textView.hasMarkedText) return;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.08 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
    if (self.panel.isVisible && !self.panel.isKeyWindow && !self.textView.hasMarkedText) [self hide];
  });
}
@end

static OSStatus CJHotKeyHandler(EventHandlerCallRef nextHandler, EventRef event, void *userData) {
  if (GetEventClass(event) != kEventClassKeyboard || GetEventKind(event) != kEventHotKeyPressed) return eventNotHandledErr;
  CJCaptureController *controller = (__bridge CJCaptureController *)userData;
  [controller toggle];
  CJEmit(@"trigger");
  return noErr;
}

static void CJHandleCommand(CJCaptureController *controller, NSString *command) {
  NSString *line = [command stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
  if ([line isEqualToString:@"show"]) [controller show];
  else if ([line isEqualToString:@"hide"]) [controller hide];
  else if ([line isEqualToString:@"saved"]) [controller didSave];
  else if ([line isEqualToString:@"error"]) [controller didFail];
  else if ([line isEqualToString:@"quit"]) [NSApp terminate:nil];
}

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    if (argc < 3 || argc > 4) {
      CJEmit(@"error:invalid-arguments");
      return 2;
    }
    UInt32 keyCode = (UInt32)strtoul(argv[1], NULL, 10);
    UInt32 modifiers = (UInt32)strtoul(argv[2], NULL, 10);

    [NSApplication sharedApplication];
    [NSApp setActivationPolicy:NSApplicationActivationPolicyAccessory];
    CJCaptureController *controller = [[CJCaptureController alloc] init];

    EventTypeSpec eventType = { kEventClassKeyboard, kEventHotKeyPressed };
    EventHandlerRef handler = NULL;
    OSStatus handlerStatus = InstallApplicationEventHandler(&CJHotKeyHandler, 1, &eventType, (__bridge void *)controller, &handler);
    if (handlerStatus != noErr) {
      CJEmit([NSString stringWithFormat:@"error:handler-%d", (int)handlerStatus]);
      return 3;
    }

    EventHotKeyRef hotkey = NULL;
    EventHotKeyID hotkeyID = { 0x434A484B, 1 };
    OSStatus status = RegisterEventHotKey(keyCode, modifiers, hotkeyID, GetApplicationEventTarget(), 0, &hotkey);
    if (status != noErr) {
      CJEmit([NSString stringWithFormat:@"error:register-%d", (int)status]);
      return 4;
    }

    __block NSMutableString *stdinBuffer = [NSMutableString string];
    NSFileHandle *stdinHandle = NSFileHandle.fileHandleWithStandardInput;
    stdinHandle.readabilityHandler = ^(NSFileHandle *handle) {
      NSData *data = handle.availableData;
      if (data.length == 0) return;
      NSString *chunk = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
      if (!chunk) return;
      @synchronized (stdinBuffer) {
        [stdinBuffer appendString:chunk];
        while (YES) {
          NSRange newline = [stdinBuffer rangeOfString:@"\n"];
          if (newline.location == NSNotFound) break;
          NSString *line = [stdinBuffer substringToIndex:newline.location];
          [stdinBuffer deleteCharactersInRange:NSMakeRange(0, NSMaxRange(newline))];
          dispatch_async(dispatch_get_main_queue(), ^{ CJHandleCommand(controller, line); });
        }
      }
    };

    CJEmit(@"ready");
    if (argc == 4 && strcmp(argv[3], "--self-test") == 0) {
      dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.05 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{ CJEmit(@"trigger"); });
    }
    [NSApp run];

    stdinHandle.readabilityHandler = nil;
    if (hotkey) UnregisterEventHotKey(hotkey);
    if (handler) RemoveEventHandler(handler);
  }
  return 0;
}
